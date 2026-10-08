import { pcmBlobToWav } from './prepared-audio';
import { selectVoice, speechInput, readVoiceRef, DEFAULT_SPEECH_RULES, type SpeechRules, type Settings, type SpeechSegment } from './shared';
import { providerError, redactSecrets } from './provider-errors';
export interface NativeConnection { id:string;name:string;provider:string;model:string;voice:string;outputFormat?:string }
const API = '/api/v1';
async function boundedBytes(response:Response, limit:number):Promise<Uint8Array> {
  if (Number(response.headers.get('content-length'))>limit) throw new Error('Lumiverse returned an oversized speech response.');
  if (!response.body) return new Uint8Array();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Lumiverse returned an oversized speech response.');chunks.push(value) } }
  finally {await reader.cancel().catch(()=>{})}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes;
}
function style(emotion:string, delivery:string) {
  const values:Record<string,string>={happy:'happy and cheerful',sad:'sad',angry:'angry',worried:'worried',curious:'curious',excited:'excited',sarcastic:'sarcastic',tender:'warm and tender',afraid:'afraid',whispers:'whispering',shouts:'shouting',softly:'soft-spoken',slowly:'slow and deliberate',laughs:'with a light laugh',sighs:'with a sigh'};
  return [values[emotion],values[delivery]].filter(Boolean).join(', ');
}
export function nativeSpeechRequest(connection:NativeConnection, settings:Settings, segment:SpeechSegment, characterId?:string) {
  const assignment=selectVoice(settings,segment,characterId), model=settings.model || connection.model;
  const openrouter=connection.provider==='openrouter_tts';
  const gemini=/gemini-.*tts/i.test(model);
  const legacyTags=gemini && /gemini-3\.1/i.test(model);
  const direction=style(assignment.emotion,assignment.delivery);
  // Sustained Gemini directions aren't exposed by this host adapter. Inline
  // vocal events are part of the transcript and pass through without metadata.
  const parameters:Record<string,unknown>={};
  if (openrouter && gemini) parameters.speed=1;
  if (/gpt-4o-mini-tts/i.test(model) && ['openrouter_tts','openai_tts'].includes(connection.provider) && direction) parameters.instructions=`Speak ${direction}.`;
  return {connectionId:connection.id,text:speechInput(segment,assignment,legacyTags,gemini && /gemini-3\.8/i.test(model)),voice:assignment.voice || connection.voice,model,parameters,
    outputFormat:openrouter && gemini ? 'pcm' : connection.outputFormat};
}
export function createNativeTtsClient(transport:typeof fetch = fetch) {
  async function request(path:string, options:RequestInit = {}) {
    return transport(`${API}${path}`,{...options,credentials:'include',redirect:'error',signal:options.signal ?? AbortSignal.timeout(70000)});
  }
  async function readJson(response:Response):Promise<any> {
    const text=new TextDecoder().decode(await boundedBytes(response,1024*1024));
    if (!response.ok) throw new Error(providerError('Lumiverse TTS',response.status,text));
    let data:any;try{data=JSON.parse(text)}catch{throw new Error('Lumiverse returned an unexpected TTS response.')}
    if (typeof data.error==='string')throw new Error(redactSecrets(data.error.slice(0,600)));return data;
  }
  return {
    async preferences() {
      const result=await readJson(await request('/settings/voiceSettings'));
      const value=result.value && typeof result.value==='object'?result.value:{};
      const raw=value.speechDetectionRules??{},rules={...DEFAULT_SPEECH_RULES};
      for(const key of ['quoted','asterisked','undecorated'] as const) {
        const allowed=key==='asterisked'?['thought','narration','skip']:['speech','narration','skip'];
        if(allowed.includes(raw[key]))(rules as Record<string,string>)[key]=raw[key];
      }
      return {rules:rules as SpeechRules,narrationVoice:readVoiceRef(value.narrationVoice)};
    },
    async connections():Promise<NativeConnection[]> {
      const all:NativeConnection[]=[];
      for(let offset=0;offset<2000;offset+=200) {
        const result=await readJson(await request(`/tts-connections?limit=200&offset=${offset}`));
        if (!Array.isArray(result.data))throw new Error('This Lumiverse build did not return its TTS connections.');
        for(const p of result.data)if(typeof p.id==='string' && typeof p.provider==='string')all.push({id:p.id,name:p.name || p.id,provider:p.provider,model:p.model || '',voice:p.voice || '',outputFormat:p.default_parameters?.output_format});
        if(result.data.length<200 || typeof result.total==='number' && offset+result.data.length>=result.total)break;
      }
      return all;
    },
    async models(id:string):Promise<{id:string;name:string;voices:string[]}[]> {
      const result=await readJson(await request(`/tts-connections/${encodeURIComponent(id)}/models`));
      return (Array.isArray(result.models)?result.models:[]).filter((m:any)=>typeof m.id==='string').map((m:any)=>({id:m.id,name:m.label || m.id,voices:[]}));
    },
    async voices(id:string):Promise<string[]> {
      const result=await readJson(await request(`/tts-connections/${encodeURIComponent(id)}/voices`));
      return (Array.isArray(result.voices)?result.voices:[]).map((v:any)=>typeof v==='string'?v:v.id).filter((v:any)=>typeof v==='string');
    },
    async check(id:string):Promise<string> {
      const result=await readJson(await request(`/tts-connections/${encodeURIComponent(id)}/test`,{method:'POST'}));
      if(result.success!==true)throw new Error(typeof result.message==='string'?redactSecrets(result.message.slice(0,600)):'Lumiverse could not connect to this TTS provider.');
      return 'Lumiverse accepts this saved TTS connection. Click Listen to test a voice. No speech was generated.';
    },
    async speech(connection:NativeConnection, settings:Settings, segment:SpeechSegment, characterId?:string, signal?:AbortSignal):Promise<{blob:Blob;mime:string}> {
      const body=nativeSpeechRequest(connection,settings,segment,characterId);
      const response=await request('/tts/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
      const mime=response.headers.get('content-type')?.toLowerCase() ?? '';
      if(!response.ok || mime.includes('json')) {
        const text=new TextDecoder().decode(await boundedBytes(response,64*1024));throw new Error(providerError('Lumiverse TTS',response.status,text));
      }
      if(!mime.startsWith('audio/') && !mime.startsWith('application/ogg'))throw new Error('Lumiverse returned an unsupported speech response.');
      const blob=await response.blob();signal?.throwIfAborted();
      if(!blob.size)throw new Error('Lumiverse returned no speech audio.');
      if(mime.startsWith('audio/pcm') || mime.startsWith('audio/x-pcm'))return {blob:await pcmBlobToWav(blob,mime),mime:'audio/wav'};
      return {blob,mime};
    },
  };
}
