import type { SpindleAPI, ChatMessageDTO } from 'lumiverse-spindle-types';
import { DEFAULTS, CUE_PATTERN, HIDE_RULE_NAME, EMOTION_INSTRUCTION, needsPcm, normalizeSettings, speechRequest, readVoiceRef, type CharacterInfo, type Settings, type SpeechSegment, type SpeechModel } from './shared';
import { MAX_PASSAGE_CHARS } from './playback-plan';
import { isHiddenJsonError, providerError, redactSecrets } from './provider-errors';
import { PreparationLedger } from './preparation-ledger';
import {CompletionRegistry,type CompletionTicket} from './auto-preparation';
declare const spindle: SpindleAPI;
const preparationLedger=new PreparationLedger({
  read:async userId=>await spindle.userStorage.exists('preparations.json',userId)?spindle.userStorage.read('preparations.json',userId):undefined,
  write:(userId,value)=>spindle.userStorage.write('preparations.json',value,userId),
});
const settingsByUser = new Map<string, Settings>();
const loadingByUser = new Map<string, Promise<Settings>>();
const busy = new Map<string, number>();
const canceled = new Map<string, number>();
const saveChains = new Map<string, Promise<unknown>>();
const activeGenerations = new Map<string, { chatId:string;userId?:string;characterId?: string; characterName?: string }>();
const completions=new CompletionRegistry();
const failedSpeech = new Map<string,{ settings:Settings; segment:SpeechSegment; characterId?:string; at:number }>();
const DIAGNOSTIC_TTL = 10 * 60 * 1000;
const LOCAL_CREDENTIALS='local_credentials_v1';
async function keyStorage<T>(work:()=>Promise<T>):Promise<T>{try{return await work()}catch{throw new Error('Could not access encrypted key storage. Check Lumiverse’s credential settings. Existing keys were not intentionally removed.')}}
async function keyStatus(userId:string){return {openrouter:await keyStorage(()=>spindle.enclave.has('openrouter_key',userId)),local:await keyStorage(async()=>await spindle.enclave.has(LOCAL_CREDENTIALS,userId)||await spindle.enclave.has('local_key',userId))}}
function keyProvider(value:unknown):'openrouter'|'local'{if(value!=='openrouter' && value!=='local')throw new Error('Choose a direct speech provider first.');return value}
let models: SpeechModel[] = [];
function send(payload: unknown, userId: string, sessionId?: string) { spindle.sendToFrontend(payload, userId, sessionId ? { frontendSessionId: sessionId } : undefined) }
async function load(userId: string): Promise<Settings> {
  if (settingsByUser.has(userId)) return settingsByUser.get(userId)!;
  if (loadingByUser.has(userId)) return loadingByUser.get(userId)!;
  const promise = (async () => {
    let raw: unknown = DEFAULTS;
    if (await spindle.userStorage.exists('settings.json', userId)) raw = JSON.parse(await spindle.userStorage.read('settings.json', userId));
    const value = normalizeSettings(raw); settingsByUser.set(userId, value); return value;
  })();
  loadingByUser.set(userId, promise);
  try { return await promise } finally { loadingByUser.delete(userId) }
}
async function save(userId: string, raw: unknown) {
  const value = normalizeSettings(raw);
  const chain = (saveChains.get(userId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await spindle.userStorage.write('settings.json', JSON.stringify(value), userId);
    settingsByUser.set(userId, value);
  });
  saveChains.set(userId, chain);
  await chain;
  if (saveChains.get(userId) === chain) saveChains.delete(userId);
  return value;
}
const ruleLocks = new Map<string, Promise<void>>();
async function ensureHideRule(userId: string) {
  if (!spindle.permissions.has('regex_scripts')) throw new Error('Grant the regex_scripts permission to hide emotion cues.');
  if (ruleLocks.has(userId)) return ruleLocks.get(userId);
  const promise = (async () => {
    const { data } = await spindle.regex_scripts.list({ userId, limit: 200 });
    const prior = data.find(r => r.name === HIDE_RULE_NAME && r.can_mutate);
    const rule = { name: HIDE_RULE_NAME, find_regex: CUE_PATTERN, replace_string: '', flags: 'gi', placement: ['ai_output'] as ['ai_output'], target: 'display' as const, scope: 'global' as const, disabled: false, folder: 'Readalong', description: 'Hides emotion, delivery, and speaker cues only in display; original text remains available to speech.' };
    if (prior) await spindle.regex_scripts.update(prior.id, rule, userId);
    else await spindle.regex_scripts.create(rule, userId);
  })();
  ruleLocks.set(userId, promise);
  try { await promise } catch(e) { ruleLocks.delete(userId); throw e }
}
function messageInfo(m: ChatMessageDTO, characterId?: string) { return { id: m.id, content: m.content, name: m.name, isUser: m.is_user, characterId } }
async function ownMessages(chatId: string, userId: string) {
  // Message reads alone do not constrain an operator extension to the requesting user.
  const chat = await spindle.chats.get(chatId,userId);
  if (!chat) throw new Error('Chat not found for this user.');
  return spindle.chat.getMessages(chatId);
}
async function speechModels() {
  const r = await spindle.cors('https://openrouter.ai/api/v1/models?output_modalities=speech') as { status: number; body: string };
  if (r.status !== 200) throw new Error(`Could not load speech models (${r.status}).`);
  const body = JSON.parse(r.body);
  models = (body.data ?? []).filter((m: any) => m.architecture?.output_modalities?.includes('speech')).map((m: any) => ({ id: m.id, name: m.name, voices: Array.isArray(m.supported_voices) ? m.supported_voices : [] }));
  return models;
}
function validLocalUrl(input: string,withKey=false) {
  const url = new URL(input);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) API base URL without credentials, query, or fragment.');
  if(withKey && url.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('A remote server with an API key must use HTTPS. HTTP is allowed only for a loopback speech server.');
  return url.href.replace(/\/$/, '');
}
async function speechConnection(settings: Settings, userId: string) {
  if(settings.provider==='lumiverse' || settings.provider==='browser')throw new Error('This voice connection is played through the Lumiverse frontend.');
  const openrouter = settings.provider === 'openrouter';
  const base = openrouter ? 'https://openrouter.ai/api/v1' : validLocalUrl(settings.localUrl);
  let key:string|null=null;
  if(openrouter)key=await keyStorage(()=>spindle.enclave.get('openrouter_key',userId));
  else {
    const raw=await keyStorage(()=>spindle.enclave.get(LOCAL_CREDENTIALS,userId));
    if(raw){
      let saved:any;try{saved=JSON.parse(raw)}catch{throw new Error('Saved local credentials could not be read. Save the local key again.');}
      if(typeof saved.key!=='string' || saved.base!==base)throw new Error('This local key belongs to another server address. Save a key for this address before making requests.');
      key=saved.key;validLocalUrl(base,true);
    }else if(await keyStorage(()=>spindle.enclave.has('local_key',userId)))throw new Error('Your existing local key is preserved. Save it again once to authorize this server address. No request was sent.');
  }
  if (openrouter && !key) throw new Error('Add your OpenRouter API key in Readalong settings.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (openrouter) headers['X-Title'] = 'Lumiverse Readalong';
  return { base, headers, key, label:openrouter ? 'OpenRouter' : 'Speech provider' };
}
async function credentialRequest(url:string,options:Parameters<SpindleAPI['cors']>[1],key:string|null){
  try{return await spindle.cors(url,options)}catch(e){throw new Error(redactSecrets(e instanceof Error?e.message:'Speech provider request failed.',key))}
}
async function checkConnection(settings: Settings, userId: string) {
  if (settings.provider === 'browser') throw new Error('Browser voices do not need an API connection check.');
  const {base,headers,key,label} = await speechConnection(settings,userId);
  const result = await credentialRequest(`${base}/${settings.provider === 'openrouter' ? 'key' : 'models'}`,{headers},key) as {status:number;body:string};
  if (result.status < 200 || result.status >= 300) throw new Error(providerError(label,result.status,result.body,key));
  if (settings.provider === 'openrouter') {
    const data = JSON.parse(result.body)?.data;
    if (!data || typeof data !== 'object') throw new Error('OpenRouter returned an unexpected key-check response.');
    if (typeof data.limit === 'number' && typeof data.limit_remaining === 'number' && data.limit_remaining <= 0) throw new Error('This OpenRouter key has reached its spending limit. Update the limit or save another key.');
    return { message:'OpenRouter accepts your saved key. Model/provider access and available credit can still affect speech requests. No speech was generated.' };
  }
  return { message:'The speech server accepted the model-list request. No speech was generated.' };
}
async function synthesize(segment: SpeechSegment, settings: Settings, userId: string, characterId?: string) {
  if (needsPcm(settings)) throw new Error('For Gemini voices, select Lumiverse connection in Readalong and choose your saved OpenRouter TTS connection. No speech request was sent.');
  const {base,headers,key,label} = await speechConnection(settings,userId);
  const result = await credentialRequest(`${base}/audio/speech`, {
    method: 'POST', headers,
    body: JSON.stringify(speechRequest(settings,segment,characterId)),
    responseType: 'arraybuffer', mediaType: 'audio',
  },key) as { status: number; headers: Record<string,string>; body: string; encoding?: string };
  if (result.status < 200 || result.status >= 300) throw new Error(providerError(label,result.status,result.encoding === 'base64' ? '' : result.body,key));
  if (result.encoding !== 'base64' || !result.body) throw new Error('The speech provider returned no playable audio.');
  return { audio: result.body, mime: result.headers['content-type'] || 'audio/mpeg' };
}
async function diagnoseSpeech(scope:string, userId:string) {
  const failed = failedSpeech.get(scope);
  // Each failed request can be inspected once, only from its originating session.
  failedSpeech.delete(scope);
  if (!failed || Date.now() - failed.at > DIAGNOSTIC_TTL) throw new Error('No recent failed speech request in this tab. Try a voice preview first.');
  const {base,headers,key,label} = await speechConnection(failed.settings,userId);
  const result = await credentialRequest(`${base}/audio/speech`,{
    method:'POST',headers,body:JSON.stringify(speechRequest(failed.settings,failed.segment,failed.characterId)),responseType:'text',
  },key) as {status:number;headers:Record<string,string>;body:string};
  const mime = result.headers?.['content-type']?.toLowerCase() ?? '';
  if (result.status < 200 || result.status >= 300 || mime.includes('json')) throw new Error(providerError(label,result.status,result.body,key));
  if (mime.startsWith('audio/')) return { message:'The provider returned audio on this diagnostic attempt. Click Listen to try playback again.' };
  throw new Error(`${label} returned an unexpected response (HTTP ${result.status}, ${mime || 'no content type'}).`);
}
spindle.onFrontendMessage(async (payload, userId, sessionId) => {
  if (!payload || typeof payload !== 'object') return;
  const p = payload as Record<string, any>;
  if (typeof p.requestId !== 'string' || p.requestId.length > 100) return;
  const frontendId=typeof p.frontendId==='string' && /^[a-z0-9-]{1,100}$/i.test(p.frontendId)?p.frontendId:undefined;
  const scope = `${userId}:${sessionId ?? frontendId ?? ''}`;
  const reply = (data: unknown) => send({ type: 'reply', requestId: p.requestId, data, canDiagnoseSpeech:failedSpeech.has(scope) }, userId, sessionId);
  try {
    const settings = await load(userId);
    if (p.type === 'init') {
      let cueStatus = '';
      try { await ensureHideRule(userId) } catch(e) { cueStatus = e instanceof Error ? e.message : 'Could not install the display rule.' }
      const hasKeys=await keyStatus(userId);
      reply({ settings, userId, hasKey:hasKeys.openrouter, hasKeys, cueStatus, permissions: await spindle.permissions.getGranted() });
    } else if(p.type==='latest_completion') {
      if(typeof p.chatId!=='string' || typeof p.since!=='number' || !Number.isFinite(p.since))throw new Error('Invalid completion lookup.');
      reply({completion:settings.enabled?completions.latest(userId,p.chatId,p.since)??null:null,
        generating:[...activeGenerations.values()].some(g=>g.userId===userId && g.chatId===p.chatId)});
    } else if (p.type === 'claim_preparation') {
      if(!settings.enabled)throw new Error('Readalong is off. Turn it on to request speech.');
      if(typeof p.key!=='string')throw new Error('Invalid preparation identity.');
      reply({allowed:await preparationLedger.claim(userId,p.key,p.manual===true)});
    } else if (p.type === 'save') {
      const saved = await save(userId,p.settings);
      for (const [id,failed] of failedSpeech) if (id.startsWith(`${userId}:`) && (saved.provider !== failed.settings.provider || saved.model !== failed.settings.model || saved.localUrl !== failed.settings.localUrl)) failedSpeech.delete(id);
      reply({ settings:saved });
    } else if (p.type === 'save_key') {
      if (typeof p.key !== 'string' || !p.key.trim() || p.key.length > 4000) throw new Error('Paste a nonempty API key. Saving an empty field never removes a key.');
      const provider=keyProvider(p.provider),key=p.key.trim();
      if(provider==='local'){
        const base=validLocalUrl(typeof p.localUrl==='string'?p.localUrl:settings.localUrl,true);
        await keyStorage(()=>spindle.enclave.put(LOCAL_CREDENTIALS,JSON.stringify({key,base}),userId));
      }else await keyStorage(()=>spindle.enclave.put('openrouter_key',key,userId));
      for (const id of failedSpeech.keys()) if (id.startsWith(`${userId}:`)) failedSpeech.delete(id);
      reply({ hasKey:true });
    } else if(p.type==='remove_key'){
      const provider=keyProvider(p.provider);if(p.confirmed!==true)throw new Error('Confirm key removal first.');
      for(const name of provider==='local'?[LOCAL_CREDENTIALS,'local_key']:['openrouter_key'])await keyStorage(()=>spindle.enclave.delete(name,userId));
      for (const id of failedSpeech.keys()) if (id.startsWith(`${userId}:`)) failedSpeech.delete(id);
      reply({hasKey:false});
    } else if (p.type === 'models') {
      reply({ models: await speechModels() });
    } else if (p.type === 'check_connection') {
      reply(await checkConnection(p.settings ? normalizeSettings(p.settings) : settings,userId));
    } else if (p.type === 'diagnose_speech') {
      if(!settings.enabled)throw new Error('Readalong is off. Turn it on to request speech.');
      if(!sessionId && !frontendId)throw new Error('Reload Readalong before using diagnostics. No request was sent.');
      reply(await diagnoseSpeech(scope,userId));
    } else if (p.type === 'characters') {
      const characters: CharacterInfo[] = [];
      for (let offset = 0; ; offset += 200) {
        const { data, total } = await spindle.characters.list({ limit: 200, offset, userId });
        characters.push(...data.map(c => ({ id: c.id, name: c.name, ttsVoice:readVoiceRef(c.extensions?.ttsVoice) })));
        if (data.length < 200 || characters.length >= total) break;
      }
      reply({ characters });
    } else if (p.type === 'messages') {
      if (typeof p.chatId !== 'string') throw new Error('Select a chat first.');
      const all = await ownMessages(p.chatId,userId);
      reply({ messages: all.filter(m => !m.is_user).slice(-100).map(m => messageInfo(m)) });
    } else if (p.type === 'message') {
      if (typeof p.chatId !== 'string' || typeof p.messageId !== 'string') throw new Error('No message selected.');
      const all = await ownMessages(p.chatId,userId);
      if(p.latestOnly===true && all.filter(m=>!m.is_user).at(-1)?.id!==p.messageId){reply({message:null});return}
      const m = all.find(m => m.id === p.messageId);
      if (!m) throw new Error('Message no longer exists.');
      reply({ message: messageInfo(m) });
    } else if (p.type === 'cancel') {
      canceled.set(scope, (canceled.get(scope) ?? 0) + 1); reply({});
    } else if (p.type === 'speech') {
      if(!settings.enabled)throw new Error('Readalong is off. Turn it on to request speech.');
      if ((busy.get(scope) ?? 0) >= 2) throw new Error('Speech is already being prepared. Try again shortly.');
      const s = p.segment;
      if (!s || typeof s.text !== 'string' || s.text.length > MAX_PASSAGE_CHARS || !s.text.trim()) throw new Error('Invalid speech passage.');
      const segment: SpeechSegment = { text: s.text, speaker: typeof s.speaker === 'string' ? s.speaker.slice(0,80) : '', emotion: typeof s.emotion === 'string' ? s.emotion : '', delivery: typeof s.delivery === 'string' ? s.delivery : '' };
      const version = canceled.get(scope) ?? 0;
      busy.set(scope, (busy.get(scope) ?? 0) + 1);
      const playbackSettings = p.previewSettings ? normalizeSettings(p.previewSettings) : settings;
      const characterId = typeof p.characterId === 'string' ? p.characterId : undefined;
      try {
        const audio = await synthesize(segment, playbackSettings, userId, characterId);
        if ((canceled.get(scope) ?? 0) !== version) throw new Error('Speech canceled.');
        failedSpeech.delete(scope);
        reply(audio);
      } catch(e) {
        if (isHiddenJsonError(e) && (canceled.get(scope) ?? 0) === version) {
          for (const [id,old] of failedSpeech) if (Date.now()-old.at > DIAGNOSTIC_TTL) failedSpeech.delete(id);
          failedSpeech.set(scope,{settings:playbackSettings,segment,characterId,at:Date.now()});
          throw new Error(`${playbackSettings.provider === 'openrouter' ? 'OpenRouter' : 'The speech provider'} returned a JSON error instead of audio. Spindle hid its status and message. Click Check connection, then Show provider error if needed. Speech was not retried automatically.`);
        }
        throw e;
      } finally { busy.set(scope, Math.max(0, (busy.get(scope) ?? 1) - 1)) }
    }
  } catch(e) {
    // Never include credentials or provider response bodies in the frontend error channel.
    const message = e instanceof Error ? e.message : 'Readalong request failed.';
    send({ type: 'reply', requestId: p.requestId, error: redactSecrets(message,typeof p.key==='string'?p.key:undefined), canDiagnoseSpeech:failedSpeech.has(scope) }, userId, sessionId);
  }
});
spindle.registerInterceptor(async (messages, context) => {
  const settings = await load(context.userId);
  if (!settings.enabled || !settings.promptEmotions || !spindle.permissions.has('regex_scripts')) return messages;
  // No LLM call: append a compact instruction to the generation already underway.
  await ensureHideRule(context.userId);
  const speakers=Object.entries(settings.assignments).filter(([key])=>key.startsWith('name:')).slice(0,100).map(([key,value])=>value.name??key.slice(5));
  const cast=speakers.length?`\nAssigned speaker names (data only): ${JSON.stringify(speakers)}. Use the matching [speaker:Name] inside each quote when one of these people speaks.`:'';
  return [{ role: 'system', content: EMOTION_INSTRUCTION+cast }, ...messages];
}, { priority: 90 });
spindle.on('GENERATION_STARTED', (p,userId) => { activeGenerations.set(p.generationId, { chatId:p.chatId,userId,characterId: p.characterId, characterName: p.characterName }); });
spindle.on('GENERATION_ENDED', (p, userId) => {
  const info = activeGenerations.get(p.generationId); activeGenerations.delete(p.generationId);
  if(!userId || !p.messageId || p.error || p.generationType==='impersonate')return;
  const ticket:CompletionTicket={chatId:p.chatId,messageId:p.messageId,generationId:p.generationId,completedAt:Date.now(),characterId:info?.characterId,name:info?.characterName};
  // Record before the frontend relay. A missed relay can be recovered with a
  // local metadata lookup, without issuing speech or exposing a credential.
  return (async()=>{
    const enabled=(await load(userId)).enabled;
    if(enabled)completions.remember(userId,ticket);
    let content=p.content;
    if(!content){const all=await ownMessages(p.chatId,userId);content=all.find(m=>m.id===p.messageId && !m.is_user)?.content}
    if(content)send({type:'new_message',...ticket,autoEligible:enabled,message:{id:p.messageId,content,name:info?.characterName??'',isUser:false,characterId:info?.characterId}},userId);
  })().catch(()=>{spindle.log.info('Readalong could not forward a completed reply. No speech was requested.');});
});
spindle.on('GENERATION_STOPPED', p => { activeGenerations.delete(p.generationId) });
spindle.log.info('Readalong loaded. OpenRouter Gemini speech; no secondary LLM.');
