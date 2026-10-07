import type { SpindleFrontendContext, SpindleCharacterEditorTabHandle } from 'lumiverse-spindle-types';
import { DEFAULTS, GEMINI_VOICES, EMOTIONS, DELIVERIES, normalizeSettings, parseSegments, selectVoice, speakerCharacterId, plainText, stripCues, type Settings, type SpeechSegment, type SpeechModel, type MessageInfo, type VoiceAssignment } from './shared';
import { PassageMarker } from './highlight';

const STYLE = `
::highlight(lumiverse-readalong){background:rgba(245,190,80,.30);color:inherit;text-decoration:underline;text-decoration-color:#e7b24c;text-decoration-thickness:2px;}
.ra-marker-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483000;}
.ra{font:inherit;color:var(--lumiverse-text);padding:18px;max-width:760px;box-sizing:border-box;}
.ra *{box-sizing:border-box;}.ra h2{margin:0 0 5px;font-size:21px}.ra h3{margin:0 0 12px;font-size:16px}
.ra p{line-height:1.5;margin:8px 0}.ra .ra-muted{color:var(--lumiverse-text-muted,var(--lumiverse-text-dim));font-size:13px;}
.ra .ra-card{border:1px solid var(--lumiverse-border,#555);background:var(--lumiverse-fill-subtle,transparent);border-radius:12px;padding:16px;margin-top:16px;}
.ra .ra-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.ra .ra-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.ra label.ra-field{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;margin:10px 0;flex:1;min-width:140px;}
.ra input,.ra select,.ra textarea{font:inherit;color:var(--lumiverse-text);background:var(--lumiverse-fill,#202026);border:1px solid var(--lumiverse-border,#555);border-radius:7px;padding:9px;width:100%;min-width:0;}
.ra button,.ra-bubble button{cursor:pointer;border:1px solid var(--lumiverse-border,#555);border-radius:7px;padding:8px 12px;color:var(--lumiverse-text);background:var(--lumiverse-fill,#25252d);font:inherit;}
.ra button:hover,.ra-bubble button:hover{border-color:var(--lumiverse-primary,#c6a25a)}.ra button:disabled{opacity:.5;cursor:default}
.ra .ra-primary{background:var(--lumiverse-primary,#ac8b4f);color:var(--lumiverse-on-primary,#fff);border-color:transparent}
.ra .ra-toggle{display:flex;gap:9px;align-items:flex-start;font-size:13px;margin:12px 0}.ra .ra-toggle input{width:auto;margin:3px 0}
.ra .ra-status{font-size:13px;min-height:20px;line-height:1.45}.ra .ra-error{color:#e99087}.ra .ra-passage{margin:12px 0;padding:12px;border-left:3px solid #e7b24c;background:rgba(245,190,80,.08);line-height:1.6;font-size:15px;}
.ra progress{width:100%;height:5px;accent-color:#e7b24c}.ra .ra-voice-list{display:flex;gap:7px;flex-wrap:wrap;max-height:240px;overflow:auto;padding:4px 0;}
.ra .ra-voice-list button{padding:6px 10px;font-size:12px}.ra .ra-voice-list button[aria-pressed=true]{border-color:#e7b24c;background:rgba(245,190,80,.12)}
.ra-bubble{display:flex;gap:8px;align-items:center;padding:5px 0;font-size:12px}.ra-bubble button{padding:5px 9px;font-size:12px;}.ra details>summary{cursor:pointer;font-size:13px;margin:8px 0;}
`;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node }
function button(text: string, action: () => void | Promise<void>, primary = false) { const b = el('button',text,primary ? 'ra-primary' : ''); b.type = 'button'; b.onclick = () => { void action() }; return b }
function field(label: string, input: HTMLElement) { const l = el('label','', 'ra-field'); l.append(el('span',label), input); return l }
function select(options: {value:string;label:string}[], value: string, change: (v: string) => void) { const s = el('select'); for (const o of options) { const option = el('option',o.label); option.value = o.value; s.append(option) }; s.value = value; s.onchange = () => change(s.value); return s }
function textInput(value: string, onInput: (value: string) => void, type = 'text') { const i = el('input'); i.type = type; i.value = value; i.oninput = () => onInput(i.value); return i }
function toggle(label: string, value: boolean, change: (v: boolean) => void) { const row = el('label','', 'ra-toggle'), i = el('input'); i.type = 'checkbox'; i.checked = value; i.onchange = () => change(i.checked); row.append(i,el('span',label)); return row }

export function setup(ctx: SpindleFrontendContext) {
  let settings = normalizeSettings(DEFAULTS), hasKey = false, ready = false, disposed = false;
  let canDiagnoseSpeech = false, diagnosing = false, diagnoseButton: HTMLButtonElement | null = null;
  let diagnoseHint: HTMLElement | null = null;
  let models: SpeechModel[] = [{ id:DEFAULTS.model, name:'Google: Gemini 3.8 Flash TTS', voices:GEMINI_VOICES }];
  let characters: {id:string;name:string}[] = [], permissions: string[] = [];
  let messages: MessageInfo[] = [], selectedId = '';
  let playbackId = 0, playing = false, paused = false, currentMessage: MessageInfo | null = null;
  let audio: HTMLAudioElement | null = null, utterance: SpeechSynthesisUtterance | null = null, audioUrl = '';
  let currentSegments: SpeechSegment[] = [], position = 0, markerVisible = false;
  let playbackSettler: (() => void) | null = null;
  const pending = new Map<string,{resolve:(data:any)=>void;reject:(err:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const cleanups: (()=>void)[] = [], bubbleHandles = new Map<string,Element>();
  let editorTab: SpindleCharacterEditorTabHandle | null = null;
  const tab = ctx.ui.registerDrawerTab({ id:'readalong', title:'Readalong', shortName:'Read', description:'Listen to passages, assign character voices, and follow the spoken text', keywords:['tts','voice','speech','audio'] });
  const root = tab.root; root.classList.add('ra'); root.dataset.raUi = 'true';
  cleanups.push(ctx.dom.addStyle(STYLE));
  const heading = el('h2','Readalong'); const intro = el('p','Find your place at a glance. Give each character a voice.','ra-muted');
  const status = el('p','Loading…','ra-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const player = el('section','', 'ra-card'), config = el('section','', 'ra-card'), voicesCard = el('section','', 'ra-card'), assignmentsCard = el('section','', 'ra-card');
  root.append(heading,intro,status,player,config,voicesCard,assignmentsCard);
  function notice(text: string, error = false) { if (!disposed) { status.textContent = text; status.classList.toggle('ra-error',error) } }
  async function safe(work:()=>Promise<void>) { try { await work() } catch(e) { notice(e instanceof Error ? e.message : 'Readalong failed.',true) } }
  function showDiagnostics(available:boolean) {
    canDiagnoseSpeech = available;
    if (diagnoseButton) diagnoseButton.hidden = !available || diagnosing;
    if (diagnoseHint) diagnoseHint.hidden = !available || diagnosing;
  }
  function rpc(type: string, payload: Record<string,unknown> = {}): Promise<any> {
    if (disposed) return Promise.reject(new Error('Readalong was closed.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Readalong timed out. Check the extension permissions and connection.')) }, 70000);
      pending.set(requestId,{resolve,reject,timer}); ctx.sendToBackend({ type, requestId, ...payload });
    });
  }
  cleanups.push(ctx.onBackendMessage((payload: any) => {
    if (payload?.type === 'reply') {
      const p = pending.get(payload.requestId); if (!p) return; clearTimeout(p.timer); pending.delete(payload.requestId);
      if (typeof payload.canDiagnoseSpeech === 'boolean') showDiagnostics(payload.canDiagnoseSpeech);
      if (payload.error) p.reject(new Error(payload.error)); else p.resolve(payload.data);
    } else if (payload?.type === 'new_message' && ready && settings.autoPlay && payload.chatId === ctx.getActiveChat().chatId && !playing) {
      void safe(async () => { await startMessage(payload.message) });
    }
  }));
  const marker = new PassageMarker(v => { markerVisible = v });
  function voiceNames(): string[] {
    if (settings.provider === 'browser') return ('speechSynthesis' in window ? speechSynthesis.getVoices().map(v=>v.name) : []);
    if (settings.provider === 'local') return ['af_heart','af_bella','af_nicole','am_adam','am_michael','bf_emma','bm_george'];
    return models.find(m => m.id === settings.model)?.voices ?? [];
  }
  function voiceSelect(value: string, change: (value: string)=>void, inherited = false) {
    const names = voiceNames(); if (value && !names.includes(value)) names.unshift(value);
    return select([...(inherited ? [{value:'',label:'Use default voice'}] : []), ...names.map(name=>({value:name,label:name}))],value,change);
  }
  function contentRoot(messageId: string) {
    const bubble = ctx.dom.findMessageElement(messageId);
    // Current host content anchor. If it changes, keep the passage visible in our player.
    return bubble?.querySelector('[data-component="MessageContent"]') ?? bubble;
  }
  function stop(showStatus = true) {
    playbackId++; playing = false; paused = false;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null }
    if (utterance) { speechSynthesis.cancel(); utterance = null }
    playbackSettler?.(); playbackSettler = null;
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = '' }
    marker.reset(); currentMessage = null; currentSegments = []; position = 0;
    void rpc('cancel').catch(()=>{}); renderPlayer();
    if (showStatus) notice('Stopped.');
  }
  function pause() {
    if (!playing) return;
    paused = !paused;
    if (paused) { audio?.pause(); if (utterance) speechSynthesis.pause() }
    else { if (audio) void audio.play().catch(()=>notice('Press Play to allow audio.',true)); if (utterance) speechSynthesis.resume() }
    renderPlayer();
  }
  function browserSpeech(segment: SpeechSegment, characterId?: string, previewVoice?: string) {
    return new Promise<void>((resolve,reject) => {
      if (!('speechSynthesis' in window)) { reject(new Error('Browser voices are unavailable in this browser.')); return }
      const u = new SpeechSynthesisUtterance(segment.text); utterance = u;
      const voice = previewVoice ?? selectVoice(settings,segment,characterId).voice;
      u.voice = speechSynthesis.getVoices().find(v => v.name === voice) ?? null;
      u.rate = settings.speed; u.volume = settings.volume;
      playbackSettler = resolve;
      u.onend = () => { utterance = null; playbackSettler = null; resolve() };
      u.onerror = e => { utterance = null; playbackSettler = null; e.error === 'canceled' || e.error === 'interrupted' ? resolve() : reject(new Error(`Browser speech failed: ${e.error}`)) };
      speechSynthesis.speak(u);
    });
  }
  function audioSpeech(data: {audio:string;mime:string}, token: number) {
    if (token !== playbackId) return Promise.resolve();
    const bytes = Uint8Array.from(atob(data.audio), c=>c.charCodeAt(0));
    audioUrl = URL.createObjectURL(new Blob([bytes],{ type:data.mime }));
    audio = new Audio(audioUrl); audio.playbackRate = settings.speed; audio.volume = settings.volume;
    const a = audio;
    return new Promise<void>((resolve,reject) => {
      playbackSettler = resolve;
      const finish = () => { if (audio === a) audio = null; playbackSettler = null; a.onended = null; a.onerror = null; URL.revokeObjectURL(a.src); audioUrl = ''; resolve() };
      a.onended = finish;
      a.onerror = () => { finish(); reject(new Error('The speech provider returned audio this browser cannot play.')) };
      if (!paused) void a.play().catch(() => { finish(); reject(new Error('Audio was blocked. Press Read again to allow playback.')) });
    });
  }
  async function startMessage(message: MessageInfo) {
    stop(false);
    currentMessage = { ...message, characterId:message.characterId ?? speakerCharacterId(message.name,characters,ctx.getActiveChat().characterId ?? undefined) };
    currentSegments = parseSegments(message.content,message.name);
    if (!currentSegments.length) { notice('There is no readable text in this message.'); return }
    const token = playbackId; playing = true; paused = false; marker.reset();
    renderPlayer();
    try {
      const settingsSnapshot = normalizeSettings(settings);
      // Capture this reading's settings so a voice preview or form change cannot alter an in-flight request.
      const prepare = (i: number) => rpc('speech',{ segment:currentSegments[i], characterId:speakerCharacterId(currentSegments[i].speaker,characters,currentMessage?.characterId), previewSettings:settingsSnapshot });
      let prepared = settings.provider !== 'browser' ? prepare(0) : null;
      for (let i = 0; i < currentSegments.length && token === playbackId; i++) {
        position = i;
        const segment = currentSegments[i];
        notice(settings.provider === 'browser' ? 'Reading…' : 'Preparing speech…'); renderPlayer();
        const data = prepared ? await prepared : null;
        if (token !== playbackId) return;
        // One sentence ahead; never synthesize the entire message just because Play was pressed.
        prepared = settings.provider !== 'browser' && i + 1 < currentSegments.length ? prepare(i+1) : null;
        prepared?.catch(()=>{});
        marker.mark(()=>contentRoot(message.id),segment.text);
        if (settings.follow) marker.follow();
        notice('Reading…'); renderPlayer();
        if (data) await audioSpeech(data,token); else await browserSpeech(segment,speakerCharacterId(segment.speaker,characters,currentMessage?.characterId));
      }
      if (token === playbackId) { playing = false; paused = false; notice('Finished.'); renderPlayer(); }
    } catch(e) { if (token === playbackId) { stop(false); throw e } }
  }
  async function preview(voice: string, assignment?: Partial<VoiceAssignment>) {
    stop(false);
    const token = playbackId; playing = true;
    const segment = { text:'The door was open. I took a breath, and stepped into the light.', speaker:'Preview', emotion:assignment?.emotion ?? 'neutral', delivery:assignment?.delivery ?? 'normal' };
    currentSegments = [segment]; position = 0; renderPlayer(); notice(`Preparing ${voice}…`);
    try {
      if (settings.provider === 'browser') await browserSpeech(segment,undefined,voice);
      else {
        const previewSettings = { ...settings, voice, assignments:{} };
        const data = await rpc('speech',{segment,previewSettings});
        if (token !== playbackId) return;
        notice(`Listening to ${voice}…`); await audioSpeech(data,token);
      }
      if (token === playbackId) { playing = false; notice(`Preview finished: ${voice}.`); renderPlayer() }
    } catch(e) { if (token === playbackId) { stop(false); throw e } }
  }
  async function saveSettings() {
    const r = await rpc('save',{settings}); settings = r.settings; notice('Settings saved.');
  }
  async function refreshMessages() {
    const chatId = ctx.getActiveChat().chatId; if (!chatId) { messages = []; renderPlayer(); return }
    const r = await rpc('messages',{chatId}); if (ctx.getActiveChat().chatId !== chatId) return;
    messages = r.messages; selectedId = messages.some(m=>m.id === selectedId) ? selectedId : messages.at(-1)?.id ?? '';
    renderPlayer(); decorateMessages();
  }
  async function readId(id: string) {
    const chatId = ctx.getActiveChat().chatId; if (!chatId) throw new Error('Open a chat first.');
    const r = await rpc('message',{chatId,messageId:id});
    if (ctx.getActiveChat().chatId !== chatId) return;
    await startMessage(r.message);
  }
  function renderPlayer() {
    player.replaceChildren(el('h3',playing ? 'Now reading' : 'Listen to a passage'));
    const row = el('div','', 'ra-row');
    if (playing) {
      row.append(button(paused ? 'Resume' : 'Pause',pause,true),button('Stop',()=>stop()));
    } else {
      const read = button('Read message',()=>safe(async()=>{ if (selectedId) await readId(selectedId); else { await refreshMessages(); if (selectedId) await readId(selectedId); else throw new Error('No assistant message found.') } }),true);
      read.disabled = !ready; row.append(read,button('Refresh messages',()=>safe(refreshMessages)));
    }
    if (currentMessage) row.append(button('Return to passage',()=>marker.follow()));
    player.append(row);
    if (!playing && messages.length) player.append(field('Assistant message',select([...messages].reverse().map(m=>({value:m.id,label:`${m.name || 'Assistant'} · ${plainText(stripCues(m.content)).slice(0,70)}`})), selectedId,v=>{selectedId=v})));
    if (currentSegments.length) {
      const segment = currentSegments[position], progress = el('progress'); progress.max = currentSegments.length; progress.value = playing ? position : position+1;
      player.append(el('p',`${segment?.speaker || 'Voice'} · Sentence ${position+1} of ${currentSegments.length}`,'ra-muted'),progress,el('p',segment?.text ?? '', 'ra-passage'));
      if (currentMessage) player.append(el('p', markerVisible ? 'The current sentence is highlighted in the passage.' : 'Keep your place here when the message is offscreen or its formatting differs.','ra-muted'));
    } else player.append(el('p','The current sentence is highlighted while audio plays. Pausing keeps your place.','ra-muted'));
    player.append(toggle('Follow the spoken passage as it moves down the page',settings.follow,v=>{settings.follow=v;void safe(saveSettings)}));
    const slider = el('input'); slider.type='range'; slider.min='.5'; slider.max='2'; slider.step='.1'; slider.value=String(settings.speed);
    slider.oninput=()=>{settings.speed=Number(slider.value);speedLabel.textContent=`Playback speed · ${settings.speed.toFixed(1)}×`;if(audio)audio.playbackRate=settings.speed};
    slider.onchange=()=>{void safe(saveSettings)}; const speedLabel = el('span',`Playback speed · ${settings.speed.toFixed(1)}×`), speedField = el('label','', 'ra-field');speedField.append(speedLabel,slider);
    const volume = el('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value=String(settings.volume);volume.oninput=()=>{settings.volume=Number(volume.value);if(audio)audio.volume=settings.volume};volume.onchange=()=>{void safe(saveSettings)};
    const controls = el('div','', 'ra-grid');controls.append(speedField,field('Volume',volume));player.append(controls);
  }
  function renderConfig() {
    config.replaceChildren(el('h3','Speech connection'));
    config.append(field('Provider',select([{value:'openrouter',label:'OpenRouter'},{value:'browser',label:'Browser voices · free'},{value:'local',label:'Local / OpenAI-compatible'}],settings.provider,v=>{
      stop(false); settings.provider=v as Settings['provider'];
      if(v==='browser')settings.voice=voiceNames()[0] ?? '';else if(v==='local'){settings.model='kokoro';settings.voice='af_heart'}else{settings.model=DEFAULTS.model;settings.voice='Kore'};
      renderConfig();renderVoices();renderAssignments();void safe(saveSettings);
    })));
    if(settings.provider==='openrouter') {
      config.append(field('Speech model',select(models.map(m=>({value:m.id,label:m.name})),settings.model,v=>{stop(false);settings.model=v;settings.voice=voiceNames()[0]??'';renderVoices();renderAssignments();void safe(saveSettings)})));
      config.append(button('Refresh models and voices',()=>safe(async()=>{const r=await rpc('models');models=r.models;if(!models.some(m=>m.id===settings.model))models.unshift({id:settings.model,name:settings.model,voices:[]});renderConfig();renderVoices();renderAssignments();notice('Voice lists updated from OpenRouter.')})));
    }
    if(settings.provider==='local')config.append(field('API base URL',textInput(settings.localUrl,v=>settings.localUrl=v)),field('Model ID',textInput(settings.model,v=>settings.model=v)));
    if(settings.provider!=='browser') {
      const key=textInput('',()=>{},'password');key.autocomplete='off';key.placeholder=settings.provider==='openrouter' && hasKey?'Key saved · leave blank to keep it':'Paste your API key';
      config.append(field('API key',key),button('Save key',()=>safe(async()=>{if(!key.value.trim())throw new Error('Paste a key first.');const r=await rpc('save_key',{key:key.value,provider:settings.provider});hasKey=r.hasKey;key.value='';key.placeholder='Key saved';notice('API key saved securely.');})),button('Remove saved key',()=>safe(async()=>{await rpc('save_key',{key:'',provider:settings.provider});hasKey=false;key.placeholder='Paste your API key';notice('Saved key removed.');})));
      config.append(el('p','Your key stays in encrypted extension storage. Each preview or reading makes a speech request to this connection.','ra-muted'));
      config.append(button('Check connection',()=>safe(async()=>{
        notice('Checking connection…');const r=await rpc('check_connection',{settings});notice(r.message);
      })));
      diagnoseButton=button('Show provider error',()=>safe(async()=>{
        if(diagnosing)return;diagnosing=true;stop(false);showDiagnostics(false);notice('Reading the provider response…');
        try {const r=await rpc('diagnose_speech');notice(r.message)}finally{diagnosing=false;showDiagnostics(canDiagnoseSpeech)}
      }));
      diagnoseHint=el('p','Show provider error repeats the last failed speech request once to read its status and message. If that request succeeds, the provider may charge for speech.','ra-muted');
      config.append(diagnoseButton,diagnoseHint);showDiagnostics(canDiagnoseSpeech);
    } else {
      diagnoseButton=null;diagnoseHint=null;
    }
    config.append(toggle('Automatically read new replies after they finish',settings.autoPlay,v=>settings.autoPlay=v),toggle('Ask the existing chat model for occasional emotion and speaker cues',settings.promptEmotions,v=>settings.promptEmotions=v),toggle('Use emotion cues when the speech model supports them',settings.useEmotions,v=>settings.useEmotions=v),button('Save settings',()=>safe(saveSettings),true));
    config.append(el('p','Emotion cues add a few tokens to normal chat replies. No second LLM is called. Hidden tags remain in the original message.','ra-muted'));
  }
  function renderVoices() {
    voicesCard.replaceChildren(el('h3','Choose a voice'));
    const row=el('div','', 'ra-row');
    row.append(field('Default voice',voiceSelect(settings.voice,v=>{settings.voice=v;renderVoices();void safe(saveSettings)})),button('Listen',()=>safe(()=>preview(settings.voice))));voicesCard.append(row);
    if(settings.provider==='local')voicesCard.append(field('Other voice ID',textInput(settings.voice,v=>settings.voice=v)),el('p','The listed voices are common Kokoro defaults. Enter a voice ID for another local server.','ra-muted'));
    const names=voiceNames();const search=textInput('',v=>drawList(v));search.placeholder='Search voices';search.setAttribute('aria-label','Search voices');
    const list=el('div','', 'ra-voice-list');
    const count=el('p',`${names.length} voices${settings.provider==='openrouter'?' for this model':''}. Choose a voice, then listen to a short sample.`,'ra-muted');
    function drawList(query='') {list.replaceChildren();for(const name of names.filter(n=>n.toLowerCase().includes(query.toLowerCase()))) {const b=button(name,()=>{settings.voice=name;renderVoices();void safe(saveSettings)});b.setAttribute('aria-pressed',String(name===settings.voice));list.append(b)}}
    drawList();voicesCard.append(count,search,list);
    if(!names.length)voicesCard.append(el('p','This model has no voice list yet. Refresh models, or enter the voice ID below.','ra-muted'),field('Voice ID',textInput(settings.voice,v=>settings.voice=v)));
    voicesCard.append(field('Narrator voice',voiceSelect(settings.narratorVoice,v=>{settings.narratorVoice=v;void safe(saveSettings)},true)));
  }
  function assignmentForm(key: string, name: string, container: HTMLElement) {
    const assignment={...(settings.assignments[key]??{voice:'',emotion:'neutral',delivery:'normal'})};
    container.replaceChildren(el('h3',`Voice for ${name}`));
    const update=async()=>{settings.assignments[key]=assignment;await saveSettings()};
    container.append(field('Voice',voiceSelect(assignment.voice,v=>assignment.voice=v,true)));
    if(settings.provider==='local')container.append(field('Custom voice ID',textInput(assignment.voice,v=>assignment.voice=v)));
    const row=el('div','', 'ra-grid');row.append(field('Default emotion',select(EMOTIONS.map(v=>({value:v,label:v})),assignment.emotion,v=>assignment.emotion=v)),field('Default delivery',select(DELIVERIES.map(v=>({value:v,label:v})),assignment.delivery,v=>assignment.delivery=v)));container.append(row);
    const actions=el('div','', 'ra-row');actions.append(button('Listen',()=>safe(()=>preview(assignment.voice||settings.voice,assignment))),button('Save voice',()=>safe(update),true),button('Use defaults',()=>safe(async()=>{delete settings.assignments[key];await saveSettings();assignmentForm(key,name,container)})));container.append(actions);
  }
  function renderAssignments() {
    assignmentsCard.replaceChildren(el('h3','Character voices'),el('p','Assignments use this speech connection. Choose a voice again after changing provider or model.','ra-muted'));
    const sub=el('div');let character: {id:string;name:string}|undefined=characters[0];
    if(characters.length)assignmentsCard.append(field('Character',select(characters.map(c=>({value:c.id,label:c.name})),character?.id??'',v=>{character=characters.find(c=>c.id===v);if(character)assignmentForm(`id:${character.id}`,character.name,sub)})));
    assignmentsCard.append(button('Refresh characters',()=>safe(async()=>{const r=await rpc('characters');characters=r.characters;renderAssignments();})),sub);
    if(character)assignmentForm(`id:${character.id}`,character.name,sub);
    const details=el('details');details.append(el('summary','Add a voice for a speaker mentioned in a passage'));
    let speaker='';const speakerInput=textInput('',v=>speaker=v);speakerInput.placeholder='Exact speaker name';const named=el('div');details.append(field('Speaker name',speakerInput),button('Choose voice',()=>{if(speaker.trim())assignmentForm(`name:${speaker.trim().toLowerCase()}`,speaker.trim(),named)}),named);assignmentsCard.append(details);
  }
  function decorateMessages() {
    for(const {messageId,element} of ctx.dom.listMessageElements()) {
      if(bubbleHandles.has(messageId))continue;
      const handle=ctx.dom.inject(element,'<div class="ra-bubble" data-ra-ui="true"></div>','beforeend');const target=handle.firstElementChild!;
      target.append(button('Read aloud',()=>safe(()=>readId(messageId))));bubbleHandles.set(messageId,handle);
    }
  }
  function onEvent(name:string,fn:(payload:any)=>void) {cleanups.push(ctx.events.on(name,p=>fn(p)))}
  onEvent('CHAT_SWITCHED',()=>{
    stop(false); messages=[]; selectedId='';
    for (const handle of bubbleHandles.values()) ctx.dom.uninject(handle);
    bubbleHandles.clear(); notice('Choose a message in this chat.'); void safe(refreshMessages);
  });
  for(const event of ['MESSAGE_EDITED','MESSAGE_SWIPED','SWIPE_EDITED','MESSAGE_DELETED'])onEvent(event,p=>{
    const id=p?.message?.id??p?.messageId;if(currentMessage?.id===id)stop();
    if(event==='MESSAGE_DELETED' && bubbleHandles.has(id)){ctx.dom.uninject(bubbleHandles.get(id)!);bubbleHandles.delete(id)}
    void safe(refreshMessages);
  });
  onEvent('GENERATION_STARTED',p=>{if(p?.chatId===ctx.getActiveChat().chatId && currentMessage)stop(false)});
  onEvent('GENERATION_STOPPED',p=>{if(p?.chatId===ctx.getActiveChat().chatId && currentMessage)stop()});
  onEvent('CHARACTER_MESSAGE_RENDERED',()=>decorateMessages());
  cleanups.push(tab.onActivate(()=>{void safe(refreshMessages)}));
  const action=ctx.ui.registerInputBarAction({id:'readalong',label:'Readalong',subtitle:'Listen and find your place'});cleanups.push(action.onClick(()=>tab.activate()));
  function installEditor() {
    if(editorTab || !permissions.includes('characters'))return;
    editorTab=ctx.ui.registerCharacterEditorTab({id:'readalong-voice',title:'Voice'});editorTab.root.classList.add('ra');editorTab.root.dataset.raUi='true';
    const render=()=>{const state=ctx.ui.characterEditor.getState();if(state.open&&state.characterId)assignmentForm(`id:${state.characterId}`,characters.find(c=>c.id===state.characterId)?.name??'this character',editorTab!.root)};
    cleanups.push(ctx.ui.characterEditor.onChange(render),editorTab.onActivate(render));render();
  }
  if('speechSynthesis' in window){const refresh=()=>{if(settings.provider==='browser'){renderVoices();renderAssignments()}};speechSynthesis.addEventListener('voiceschanged',refresh);cleanups.push(()=>speechSynthesis.removeEventListener('voiceschanged',refresh))}
  renderPlayer();renderConfig();renderVoices();renderAssignments();ctx.ready();
  void safe(async()=>{
    const r=await rpc('init');if(disposed)return;settings=r.settings;hasKey=r.hasKey;permissions=r.permissions;ready=true;
    renderPlayer();renderConfig();renderVoices();renderAssignments();installEditor();
    if(r.cueStatus)notice(r.cueStatus,true);else notice('Ready. Choose a voice and listen to a sample.');
    if(permissions.includes('characters')){try{const r=await rpc('characters');characters=r.characters;renderAssignments()}catch{}}
    if(permissions.includes('cors_proxy')){try{const r=await rpc('models');models=r.models;if(!models.some(m=>m.id===settings.model))models.unshift({id:settings.model,name:settings.model,voices:[]});renderConfig();renderVoices();renderAssignments()}catch{notice('Using the bundled Gemini voices. Refresh the list when the connection is available.')}}
    if(permissions.includes('chat_mutation'))await refreshMessages();
  });
  return()=>{
    stop(false);disposed=true;marker.dispose();for(const fn of cleanups)fn();editorTab?.destroy();action.destroy();tab.destroy();
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Readalong unloaded.'))}pending.clear();ctx.dom.cleanup();
  };
}
