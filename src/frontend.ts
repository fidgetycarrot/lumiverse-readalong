import type { SpindleFrontendContext, SpindleCharacterEditorTabHandle, SpindleFloatWidgetHandle } from 'lumiverse-spindle-types';
import { DEFAULTS, GEMINI_VOICES, EMOTIONS, DELIVERIES, needsPcm, normalizeSettings, parseSegments, speakerCharacterId, plainText, stripCues, speechRequest, type CharacterInfo, type Settings, type SpeechSegment, type SpeechModel, type MessageInfo, type VoiceAssignment } from './shared';
import { PassageMarker } from './highlight';
import { createNativeTtsClient, nativeSpeechRequest, type NativeConnection } from './native-tts';
import { planSpeech, prepareAll, estimatedSentenceIndex, type SpeechPassage, type VoiceContext } from './playback-plan';
import { PreparedPlayer, prepareClip, type PreparedClip } from './prepared-audio';
import { AudioCache, preparationHash } from './audio-cache';

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
.ra-mini{font:13px/1.4 system-ui,sans-serif;color:var(--lumiverse-text,#eee);padding:12px;background:var(--lumiverse-bg,#202026);height:100%;box-sizing:border-box;}
.ra-mini .ra-row{display:flex;gap:7px;align-items:center}.ra-mini .ra-caption{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:7px 0;color:var(--lumiverse-text-muted,#aaa);}
.ra-mini button{font:inherit;border:1px solid var(--lumiverse-border,#555);border-radius:7px;background:var(--lumiverse-fill,#292932);color:inherit;padding:6px 10px;cursor:pointer;}
.ra-mini button:disabled{opacity:.5;cursor:default}.ra-mini .ra-primary{background:var(--lumiverse-primary,#ac8b4f);color:var(--lumiverse-on-primary,#fff);}
.ra-mini .ra-widget-tools{margin-left:auto;gap:5px}.ra-mini .ra-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;flex-shrink:0;}
.ra-mini .ra-time{font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}.ra-mini progress{width:100%;height:4px;accent-color:#e7b24c;}
.ra-mini.ra-collapsed{position:relative;padding:8px;display:flex;align-items:center;gap:6px;}
.ra-collapsed .ra-compact-play{width:34px;height:34px;padding:0;flex-shrink:0;font-size:16px;}
.ra-collapsed .ra-compact-info{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25;}
.ra-collapsed .ra-compact-info strong{font-size:11px}.ra-collapsed .ra-compact-status{font-size:10px;color:var(--lumiverse-text-muted,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ra-collapsed .ra-power{font-size:11px;padding:4px;flex-shrink:0;}.ra-collapsed progress{position:absolute;bottom:3px;left:8px;width:calc(100% - 16px);height:3px;pointer-events:none;}
`;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node }
function button(text: string, action: () => void | Promise<void>, primary = false) { const b = el('button',text,primary ? 'ra-primary' : ''); b.type = 'button'; b.onclick = () => { void action() }; return b }
function field(label: string, input: HTMLElement) { const l = el('label','', 'ra-field'); l.append(el('span',label), input); return l }
function select(options: {value:string;label:string}[], value: string, change: (v: string) => void) { const s = el('select'); for (const o of options) { const option = el('option',o.label); option.value = o.value; s.append(option) }; s.value = value; s.onchange = () => change(s.value); return s }
function textInput(value: string, onInput: (value: string) => void, type = 'text') { const i = el('input'); i.type = type; i.value = value; i.oninput = () => onInput(i.value); return i }
function toggle(label: string, value: boolean, change: (v: boolean) => void) { const row = el('label','', 'ra-toggle'), i = el('input'); i.type = 'checkbox'; i.checked = value; i.onchange = () => change(i.checked); row.append(i,el('span',label)); return row }
function timeLabel(seconds:number){const value=Math.floor(seconds);return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}

export function setup(ctx: SpindleFrontendContext) {
  let settings = normalizeSettings(DEFAULTS), hasKey = false, ready = false, initialized = false, disposed = false;
  let canDiagnoseSpeech = false, diagnosing = false, diagnoseButton: HTMLButtonElement | null = null;
  let diagnoseHint: HTMLElement | null = null;
  let models: SpeechModel[] = [{ id:DEFAULTS.model, name:'Google: Gemini 3.8 Flash TTS', voices:GEMINI_VOICES }];
  const nativeTts=createNativeTtsClient(), nativeRequests=new Set<AbortController>();
  let nativeConnections:NativeConnection[]=[], catalogEpoch=0;
  let characters: CharacterInfo[] = [], permissions: string[] = [];
  let messages: MessageInfo[] = [], selectedId = '';
  let playbackId = 0, playing = false, paused = false, currentMessage: MessageInfo | null = null;
  let phase:'idle'|'preparing'|'ready'|'playing'|'paused'|'finished'='idle';
  let checkingSavedAudio=false;
  let utterance: SpeechSynthesisUtterance | null = null;
  const audioPlayer=new PreparedPlayer();
  const audioCache=new AudioCache();let cacheUserId='';
  const automaticPreparations=new Set<string>();
  let saveQueue:Promise<unknown>=Promise.resolve(),saveVersion=0;
  let currentPassages:SpeechPassage[]=[],preparedCount=0,currentPassage=0;
  let readingAbort:AbortController|null=null,clockTimer:ReturnType<typeof setInterval>|null=null;
  let browserQueueActive=false,browserResume:(()=>void)|null=null;
  let widget:SpindleFloatWidgetHandle|null=null;
  let widgetSize='';
  let widgetDragCleanup:(()=>void)|null=null;
  let widgetError='';
  const widgetPermissionHint='Enable the UI panels permission (ui_panels) in Readalong’s extension settings to use the floating player. You can play and pause here in the meantime.';
  let currentSegments: SpeechSegment[] = [], position = 0, markedPosition=-1;
  let playbackSettler: (() => void) | null = null;
  const pending = new Map<string,{resolve:(data:any)=>void;reject:(err:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const cleanups: (()=>void)[] = [], bubbleHandles = new Map<string,Element>();
  const primeAudio=()=>{try{audioPlayer.unlock();removePrimer()}catch{}};
  const removePrimer=()=>{document.removeEventListener('pointerdown',primeAudio,true);document.removeEventListener('keydown',primeAudio,true)};
  document.addEventListener('pointerdown',primeAudio,{capture:true,passive:true});document.addEventListener('keydown',primeAudio,true);cleanups.push(removePrimer);
  let editorTab: SpindleCharacterEditorTabHandle | null = null;
  const tab = ctx.ui.registerDrawerTab({ id:'readalong', title:'Readalong', shortName:'Read', description:'Listen to passages, assign character voices, and follow the spoken text', keywords:['tts','voice','speech','audio'] });
  const root = tab.root; root.classList.add('ra'); root.dataset.raUi = 'true';
  cleanups.push(ctx.dom.addStyle(STYLE));
  const heading = el('h2','Readalong'); const intro = el('p','Find your place at a glance. Give each character a voice.','ra-muted');
  const status = el('p','Loading…','ra-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const player = el('section','', 'ra-card'), config = el('section','', 'ra-card'), voicesCard = el('section','', 'ra-card'), assignmentsCard = el('section','', 'ra-card');
  root.append(heading,intro,status,player,config,voicesCard,assignmentsCard);
  function notice(text: string, error = false) { if (!disposed) { status.textContent = text; status.classList.toggle('ra-error',error);renderWidget() } }
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
    } else if (payload?.type === 'new_message' && payload.chatId === ctx.getActiveChat().chatId && payload.message && !payload.message.isUser) {
      messages=[...messages.filter(m=>m.id!==payload.message.id),payload.message];selectedId=payload.message.id;
      void safe(()=>autoPrepareMessage(payload.message));
    }
  }));
  const marker = new PassageMarker(()=>{});
  function voiceNames(): string[] {
    if (settings.provider === 'browser') return ('speechSynthesis' in window ? speechSynthesis.getVoices().map(v=>v.name) : []);
    if (settings.provider === 'local') return ['af_heart','af_bella','af_nicole','am_adam','am_michael','bf_emma','bm_george'];
    return models.find(m => m.id === settings.model)?.voices ?? [];
  }
  function voiceSelect(value: string, change: (value: string)=>void, inherited = false) {
    const names = [...voiceNames()]; if (value && !names.includes(value)) names.unshift(value);
    return select([...(inherited ? [{value:'',label:'Use default voice'}] : []), ...names.map(name=>({value:name,label:name}))],value,change);
  }
  function contentRoot(messageId: string) {
    const bubble = ctx.dom.findMessageElement(messageId);
    // Current host content anchor. If it changes, keep the passage visible in our player.
    return bubble?.querySelector('[data-component="MessageContent"]') ?? bubble;
  }
  function stopClock() { if(clockTimer)clearInterval(clockTimer);clockTimer=null }
  function stop(showStatus = true) {
    playbackId++; playing = false; paused = false; phase='idle';checkingSavedAudio=false;stopClock();
    readingAbort?.abort();readingAbort=null;
    for(const controller of nativeRequests)controller.abort();nativeRequests.clear();
    audioPlayer.clear();
    browserResume?.();browserResume=null;browserQueueActive=false;
    if (utterance) { speechSynthesis.cancel(); utterance = null }
    playbackSettler?.(); playbackSettler = null;
    marker.reset(); currentMessage = null; currentSegments = [];currentPassages=[];preparedCount=0;position=0;markedPosition=-1;currentPassage=0;
    void rpc('cancel').catch(()=>{}); renderPlayer();
    if (showStatus) notice('Stopped.');
  }
  function showWidget() {
    if(!permissions.includes('ui_panels'))return;
    try {
      if(!widget && typeof ctx.ui.createFloatWidget==='function') {
        const {width,height}=widgetDimensions();
        const viewport=widgetViewport(),saved=settings.widgetPosition;
        const initialPosition={x:Math.max(12,Math.min(saved?.x??viewport.width-width-24,viewport.width-width-12)),y:Math.max(12,Math.min(saved?.y??viewport.height-height-36,viewport.height-height-12))};
        widget=ctx.ui.createFloatWidget({width,height,initialPosition,snapToEdge:true,tooltip:'Readalong · drag to move'});
        widgetSize=`${width}:${height}`;
        widgetDragCleanup=widget.onDragEnd(pos=>{if(disposed)return;settings.widgetPosition={x:pos.x,y:pos.y};void safe(saveSettings)});
        widget.root.addEventListener('pointerdown',event=>{if((event.target as Element).closest('button,input,select,a'))event.stopPropagation()});
        widget.root.classList.add('ra-mini');widget.root.dataset.raUi='true';widget.root.setAttribute('aria-label','Readalong floating player');
      }
      widget?.setVisible(true);renderWidget();widgetError='';
    } catch(error) {
      // The host can revoke a grant after init; optional UI must never stop speech.
      widgetDragCleanup?.();widgetDragCleanup=null;
      try{widget?.destroy()}catch{}widget=null;widgetSize='';
      widgetError=error instanceof Error && /PERMISSION_DENIED.*ui_panels/.test(error.message)
        ? widgetPermissionHint : 'The floating player is unavailable. You can play and pause here in the Readalong drawer.';
    }
  }
  async function openWidget() {
    try{permissions=await ctx.permissions.getGranted()}catch{ /* Keep the last known grants; showWidget also catches host denials. */ }
    if(disposed)return;
    showWidget();renderPlayer();
  }
  function widgetViewport(){return ctx.ui.geometry?.layoutViewportSize()??{width:window.innerWidth,height:window.innerHeight}}
  function widgetDimensions(){const viewport=widgetViewport();return {width:Math.min(settings.widgetMinimized?240:320,Math.max(1,viewport.width-24)),height:Math.min(settings.widgetMinimized?56:184,Math.max(1,viewport.height-24))}}
  async function setWidgetMinimized(minimized:boolean){settings.widgetMinimized=minimized;renderWidget();await saveSettings()}
  function renderWidget() {
    if(!widget || disposed)return;
    const {width,height}=widgetDimensions(),size=`${width}:${height}`;
    // Resize the host container as well as our content, preserving its drag position.
    if(widgetSize!==size){widget.setSize(width,height);widgetSize=size}
    widget.root.classList.toggle('ra-collapsed',settings.widgetMinimized);
    const header=el('div','', 'ra-row');header.append(el('strong','Readalong'));
    if(audioPlayer.duration){const time=el('span',`${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`,'ra-time');header.append(time)}
    const close=button('×',()=>widget?.setVisible(false));close.className='ra-icon';close.setAttribute('aria-label','Hide floating player');close.title='Hide floating player';
    const resize=button(settings.widgetMinimized?'↗':'−',()=>safe(()=>setWidgetMinimized(!settings.widgetMinimized)));resize.className='ra-icon';resize.setAttribute('aria-label',settings.widgetMinimized?'Expand floating player':'Minimize floating player');resize.title=resize.getAttribute('aria-label')!;resize.setAttribute('aria-expanded',String(!settings.widgetMinimized));
    const caption=el('p',phase==='playing' || phase==='paused' ? `${currentSegments[position]?.speaker || 'Voice'} · ${currentPassages[currentPassage]?.voice || ''}` : status.textContent ?? 'Choose a message.','ra-caption');
    caption.title=plainText(currentSegments[position]?.text ?? caption.textContent ?? '');
    const controls=el('div','', 'ra-row');
    const playLabel=!settings.enabled?'Turn on':phase==='preparing'?(checkingSavedAudio?'Loading…':'Preparing…'):phase==='idle'?'Play latest':phase==='paused'?'Resume':phase==='playing'?'Pause':phase==='finished'?'Replay':'Play';
    const play=button(playLabel,()=>safe(settings.enabled?playOrPause:()=>setEnabled(true)),true);play.title=playLabel;
    play.disabled=!ready || settings.enabled && (phase==='preparing' || phase==='idle' && !selectedId);controls.append(play);
    const stopButton=button('Stop',()=>stop());stopButton.disabled=phase==='idle';controls.append(stopButton,button('Open player',()=>tab.activate()));
    const power=button(settings.enabled?'On':'Off',()=>safe(()=>setEnabled(!settings.enabled)));power.className='ra-power';power.setAttribute('aria-label',settings.enabled?'Turn Readalong off':'Turn Readalong on');power.title=power.getAttribute('aria-label')!;
    const progress=el('progress');progress.max=1;progress.value=phase==='preparing'?preparedCount/Math.max(1,currentPassages.length):phase==='finished'?1:phase==='ready'?0:audioPlayer.duration?audioPlayer.elapsed/audioPlayer.duration:position/Math.max(1,currentSegments.length);progress.setAttribute('aria-label',phase==='preparing'?'Speech preparation':'Playback progress');
    if(settings.widgetMinimized){
      play.textContent=phase==='preparing'?'…':phase==='playing'?'Ⅱ':phase==='finished'?'↻':'▶';play.setAttribute('aria-label',playLabel);play.classList.add('ra-compact-play');
      const info=el('div','', 'ra-compact-info');info.append(el('strong','Readalong'));
      const detail=el('span',!settings.enabled?'Off':audioPlayer.duration && ['playing','paused','ready','finished'].includes(phase)?`${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`:playLabel, audioPlayer.duration && settings.enabled && phase!=='preparing'?'ra-compact-status ra-time':'ra-compact-status');
      detail.title=status.textContent??'';info.append(detail);
      widget.root.replaceChildren(play,info,power,resize,close,progress);
    }else{
      const tools=el('div','', 'ra-row ra-widget-tools');tools.append(power,resize,close);header.append(tools);
      widget.root.replaceChildren(header,caption,controls,progress);
    }
  }
  function markSentence(passageIndex:number,sentenceIndex:number) {
    const next=currentPassages.slice(0,passageIndex).reduce((sum,p)=>sum+p.segments.length,0)+sentenceIndex;
    if(next===markedPosition && currentPassage===passageIndex)return;
    currentPassage=passageIndex;position=next;markedPosition=next;
    if(currentMessage){marker.mark(()=>contentRoot(currentMessage!.id),plainText(currentSegments[position].text));if(settings.follow)marker.follow()}
    renderPlayer();
  }
  function updateClock() {
    if(phase!=='playing')return;
    const at=audioPlayer.position,passage=currentPassages[at.index];
    if(passage)markSentence(at.index,estimatedSentenceIndex(passage,at.fraction));
    const progress=widget?.root.querySelector('progress');if(progress)progress.value=at.duration?at.elapsed/at.duration:0;
    const time=widget?.root.querySelector('.ra-time');if(time)time.textContent=`${timeLabel(at.elapsed)} / ${timeLabel(at.duration)}`;
  }
  function finished() {
    playing=false;paused=false;phase='finished';stopClock();
    if(currentPassages.length)markSentence(currentPassages.length-1,currentPassages.at(-1)!.segments.length-1);
    notice(currentPassages[0]?.settings.provider==='browser'?'Finished. Replay reads this passage again.':'Finished. Replay uses the prepared audio.');renderPlayer();
  }
  audioPlayer.onEnded=finished;
  audioPlayer.onError=error=>{paused=true;playing=false;phase='paused';stopClock();notice(error.message,true);renderPlayer()};
  async function playOrPause() {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to prepare audio.');
    if(phase==='preparing')return;
    if(phase==='idle'){if(!selectedId)throw new Error('No assistant message found.');await readId(selectedId);if((phase as string)!=='ready' || !settings.enabled)return;}
    if(phase==='playing') {
      if(browserQueueActive)speechSynthesis.pause();else{updateClock();audioPlayer.pause()}
      paused=true;playing=false;phase='paused';stopClock();notice('Paused. Your place is saved.');renderPlayer();return;
    }
    const token=playbackId;
    if(phase==='paused' && browserQueueActive){speechSynthesis.resume();paused=false;playing=true;phase='playing';browserResume?.();browserResume=null;notice('Reading…');renderPlayer();return}
    if(phase==='finished'){marker.reset();position=0;markedPosition=-1;currentPassage=0;audioPlayer.rewind()}
    paused=false;
    if(currentPassages[0]?.settings.provider==='browser') {
      playing=true;phase='playing';browserQueueActive=true;notice('Reading…');renderPlayer();
      try {
        for(let i=0;i<currentPassages.length && token===playbackId;i++) {
          if(paused)await new Promise<void>(resolve=>browserResume=resolve);
          if(token!==playbackId)return;
          markSentence(i,0);await browserSpeech(currentPassages[i],token,i);
        }
        if(token===playbackId){browserQueueActive=false;finished()}
      } catch(e){if(token===playbackId){stop(false);throw e}}
      return;
    }
    audioPlayer.unlock();
    const started=await audioPlayer.play();
    if(token!==playbackId || !started)return;
    playing=true;phase='playing';notice('Reading…');updateClock();renderPlayer();
    stopClock();clockTimer=setInterval(updateClock,100);
  }
  function browserSpeech(passage:SpeechPassage,token:number,passageIndex:number) {
    return new Promise<void>((resolve,reject) => {
      if (!('speechSynthesis' in window)) { reject(new Error('Browser voices are unavailable in this browser.')); return }
      const u = new SpeechSynthesisUtterance(passage.segment.text); utterance = u;
      u.voice = speechSynthesis.getVoices().find(v => v.name === passage.voice) ?? null;
      u.rate = settings.speed; u.volume = settings.volume;playbackSettler=resolve;
      u.onboundary=e=>{if(token!==playbackId || phase!=='playing')return;let end=0;for(let i=0;i<passage.segments.length;i++){end+=passage.segments[i].text.length+1;if(e.charIndex<end){markSentence(passageIndex,i);break}}};
      const finish=()=>{if(utterance===u){utterance=null;playbackSettler=null}};
      u.onend=()=>{finish();resolve()};
      u.onerror=e=>{finish();if(token===playbackId && e.error!=='canceled' && e.error!=='interrupted')reject(new Error(`Browser speech failed: ${e.error}`));else resolve()};
      speechSynthesis.speak(u);
    });
  }
  function activeNative(id=settings.connectionId) { return nativeConnections.find(c=>c.id===id) }
  async function prepareSpeech(segment:SpeechSegment, snapshot:Settings, signal?:AbortSignal) {
    signal?.throwIfAborted();
    if(snapshot.provider!=='lumiverse')return rpc('speech',{segment,previewSettings:snapshot});
    const connection=activeNative(snapshot.connectionId);
    if(!connection)throw new Error('Choose a saved Lumiverse TTS connection first. Add one in Lumiverse’s voice settings if the list is empty.');
    const controller=new AbortController();nativeRequests.add(controller);
    try{return await nativeTts.speech(connection,snapshot,segment,undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(300000),...(signal?[signal]:[])]))}
    finally{nativeRequests.delete(controller)}
  }
  async function autoPrepareMessage(message:MessageInfo,force=false,restoreOnly=false) {
    if(!initialized || !settings.enabled || disposed || message.isUser)return;
    const key=JSON.stringify([ctx.getActiveChat().chatId,message.id,message.content]);
    if(!force && (automaticPreparations.has(key) || currentMessage?.id===message.id && currentMessage.content===message.content))return;
    automaticPreparations.add(key);if(automaticPreparations.size>20)automaticPreparations.delete(automaticPreparations.values().next().value!);
    await startMessage(message,{automatic:true,restoreOnly});
  }
  async function prepareLatest(force=false,restoreOnly=false) {
    if(!settings.enabled || !initialized)return;
    const latest=messages.at(-1);if(latest)await autoPrepareMessage(latest,force,restoreOnly);
    else notice('Readalong is on. New assistant replies will prepare automatically.');
  }
  async function setEnabled(enabled:boolean) {
    settings.enabled=enabled;if(!enabled)stop(false);
    renderPlayer();renderVoices();renderAssignments();
    notice(enabled?'Readalong is on. Preparing the latest reply…':'Readalong is off. No speech requests will be started.');
    await saveSettings();
    if(enabled && settings.enabled){await refreshMessages();await prepareLatest(true)}
  }
  async function startMessage(message: MessageInfo,options:{automatic?:boolean;restoreOnly?:boolean}={}) {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to prepare audio.');
    stop(false);
    const token=playbackId;readingAbort=new AbortController();const signal=readingAbort.signal;
    currentMessage={...message,characterId:message.characterId ?? speakerCharacterId(message.name,characters,ctx.getActiveChat().characterId ?? undefined)};
    phase='preparing';checkingSavedAudio=true;preparedCount=0;showWidget();notice('Looking for saved audio. No speech requested yet.');renderPlayer();
    try {
      const snapshot=normalizeSettings(settings);
      const context:VoiceContext={characters,characterId:currentMessage.characterId,connections:nativeConnections};
      let rules;
      if(snapshot.provider==='lumiverse') {
        const results=await Promise.allSettled([nativeTts.preferences(),ctx.chats.getActive?.() ?? Promise.resolve(null)]);
        if(results[0].status==='fulfilled'){rules=results[0].value.rules;context.narrationVoice=results[0].value.narrationVoice}
        if(results[1].status==='fulfilled')context.overrides=results[1].value?.metadata?.voiceOverrides as VoiceContext['overrides'];
      }
      if(token!==playbackId)return;
      const parsed=parseSegments(message.content,message.name,rules);
      currentPassages=planSpeech(parsed,snapshot,context);currentSegments=currentPassages.flatMap(p=>p.segments);
      if(!currentSegments.length){stop(false);notice('There is no readable text in this message.');return}
      let restored=false,saved=true;
      if(snapshot.provider!=='browser') {
        const messageKey=await preparationHash([ctx.getActiveChat().chatId,message.id,message.content]);
        const requests=currentPassages.map(p=>{
          const connection=activeNative(p.settings.connectionId);
          return p.settings.provider==='lumiverse' && connection?nativeSpeechRequest(connection,p.settings,p.segment):[p.settings.provider,p.settings.localUrl,speechRequest(p.settings,p.segment)];
        });
        const audioKey=await preparationHash([messageKey,requests]);
        let clips:PreparedClip[]|undefined=undefined;
        try{clips=await audioCache.get(cacheUserId,audioKey)}catch{ /* A missing cache never authorizes an automatic retry. */ }
        if(token!==playbackId)return;
        if(clips?.length!==currentPassages.length)clips=undefined;
        if(clips){restored=true;preparedCount=currentPassages.length}
        else {
          if(options.restoreOnly){stop(false);notice('No saved audio for this message. Refresh did not request speech. New replies prepare automatically; Prepare message can generate this one.');return}
          const claim=await rpc('claim_preparation',{key:messageKey,manual:!options.automatic});
          if(token!==playbackId)return;
          if(!claim?.allowed){stop(false);notice('This message was already prepared or attempted. No speech was requested again. Choose Prepare message to retry; speech charges may apply.');return}
          checkingSavedAudio=false;notice('Preparing the whole message…');renderPlayer();
          clips=await prepareAll(currentPassages,async(p,_index,requestSignal)=>{
            const data=await prepareSpeech(p.segment,p.settings,requestSignal);requestSignal.throwIfAborted();
            const clip=await prepareClip(data,requestSignal);requestSignal.throwIfAborted();
            return clip;
          },signal,count=>{if(token===playbackId){preparedCount=count;notice(`Preparing the whole message · ${count} of ${currentPassages.length} passages ready…`);renderPlayer()}},snapshot.provider==='lumiverse'?3:2);
          if(token!==playbackId)return;
          try{saved=await audioCache.put(cacheUserId,audioKey,clips)}catch{saved=false}
        }
        if(token!==playbackId)return;
        audioPlayer.load(clips);audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);
      }
      if(token!==playbackId)return;
      phase='ready';checkingSavedAudio=false;notice(restored?'Saved audio restored. No speech request or new charge. Press Play.':saved?'The whole message is ready. Press Play.':'Audio is ready, but could not be saved for refresh. It will not regenerate automatically. Press Play.');renderPlayer();
    } catch(e) {if(token===playbackId){stop(false);throw e}}
  }
  async function preview(voice: string, assignment?: Partial<VoiceAssignment>) {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to test a voice.');
    stop(false);const token=playbackId;readingAbort=new AbortController();
    if(settings.provider!=='browser')audioPlayer.unlock();
    const segment={text:'The door was open. I took a breath, and stepped into the light.',speaker:'Preview',emotion:assignment?.emotion ?? 'neutral',delivery:assignment?.delivery ?? 'normal'};
    const snapshot=normalizeSettings({...settings,voice,narratorVoice:'',assignments:{},inheritVoices:false});
    currentPassages=planSpeech([segment],snapshot,{characters:[]});currentSegments=[segment];position=0;phase='preparing';showWidget();renderPlayer();notice(`Preparing ${voice}…`);
    try {
      if(snapshot.provider!=='browser') {
        const data=await prepareSpeech(currentPassages[0].segment,currentPassages[0].settings,readingAbort.signal);
        if(token!==playbackId)return;
        const clip=await prepareClip(data,readingAbort!.signal);if(token!==playbackId)return;
        audioPlayer.load([clip]);audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);
      }
      if(token!==playbackId)return;phase='ready';notice('Sample ready. Press Play.');renderPlayer();
      try{await playOrPause()}catch(e){notice(e instanceof Error?e.message:'Sample ready. Press Play.',true);renderPlayer()}
    } catch(e) {if(token===playbackId){stop(false);throw e}}
  }
  async function saveSettings() {
    const snapshot=normalizeSettings(settings),version=++saveVersion;
    const work=saveQueue.then(()=>rpc('save',{settings:snapshot}));saveQueue=work.catch(()=>{});
    const r=await work;if(disposed || version!==saveVersion)return;
    settings=normalizeSettings(r.settings);if(phase==='idle')notice(settings.enabled?'Readalong is on. New replies prepare automatically.':'Readalong is off. No speech requests will be started.');
  }
  function chooseNative(connection:NativeConnection, preserveModel=false) {
    settings.provider='lumiverse';settings.connectionId=connection.id;
    if(!preserveModel){settings.model=connection.model || DEFAULTS.model;settings.voice=connection.voice || DEFAULTS.voice}
  }
  async function refreshCatalog() {
    const epoch=++catalogEpoch, provider=settings.provider, connection=activeNative();
    let next:SpeechModel[];
    if(provider==='lumiverse') {
      if(!connection){models=[];renderConfig();renderVoices();renderAssignments();return}
      if(connection.provider==='openrouter_tts') {
        try{next=(await rpc('models')).models}
        catch{next=[{id:settings.model,name:settings.model,voices:/gemini-.*tts/i.test(settings.model)?GEMINI_VOICES:await nativeTts.voices(connection.id)}]}
      } else {
        const results=await Promise.all([nativeTts.models(connection.id),nativeTts.voices(connection.id)]);
        next=results[0].map(m=>({...m,voices:results[1]}));
        if(!next.length)next=[{id:connection.model,name:connection.model,voices:results[1]}];
      }
    } else if(provider==='openrouter') next=(await rpc('models')).models;
    else return;
    if(disposed || epoch!==catalogEpoch || provider!==settings.provider || provider==='lumiverse' && connection?.id!==settings.connectionId)return;
    models=next;if(!models.some(m=>m.id===settings.model))models.unshift({id:settings.model,name:settings.model,voices:[]});
    renderConfig();renderVoices();renderAssignments();
  }
  async function refreshNativeConnections() {
    const next=await nativeTts.connections();if(disposed)return;nativeConnections=next;
    if(settings.provider==='lumiverse' && !settings.connectionId && next.length)chooseNative(next.find(c=>c.provider==='openrouter_tts')??next[0]);
    renderConfig();await refreshCatalog();
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
    for(const handle of bubbleHandles.values()){const read=handle.querySelector('button');if(read)read.disabled=!settings.enabled}
    player.replaceChildren(el('h3',phase==='preparing'?(checkingSavedAudio?'Looking for saved audio':'Preparing the whole message'):phase==='ready'?'Ready to play':phase==='playing' || phase==='paused'?'Now reading':'Listen to a passage'));
    player.append(toggle('Readalong on · prepare replies automatically',settings.enabled,v=>{void safe(()=>setEnabled(v))}),el('p','When on, new replies prepare automatically and may incur speech charges. Refresh restores saved audio without generating speech. Turning on prepares the latest reply once. Audio waits for Play. Turn off to stop new requests.','ra-muted'));
    const row = el('div','', 'ra-row');
    if (phase !== 'idle') {
      const play=button(phase==='paused'?'Resume':phase==='playing'?'Pause':phase==='finished'?'Replay':'Play',()=>safe(playOrPause),true);play.disabled=phase==='preparing';
      row.append(play,button('Stop',()=>stop()));
    } else {
      const read = button('Prepare message',()=>safe(async()=>{ if (selectedId) await readId(selectedId); else { await refreshMessages(); if (selectedId) await readId(selectedId); else throw new Error('No assistant message found.') } }),true);
      read.disabled = !ready || !settings.enabled; row.append(read,button('Refresh messages',()=>safe(refreshMessages)));
    }
    if(typeof ctx.ui.createFloatWidget==='function')row.append(button('Floating player',()=>safe(openWidget)));
    if (currentMessage) row.append(button('Return to passage',()=>marker.follow()));
    player.append(row);
    if(ready && typeof ctx.ui.createFloatWidget==='function' && (widgetError || !permissions.includes('ui_panels')))player.append(el('p',widgetError || widgetPermissionHint,'ra-muted'));
    if (phase==='idle' && messages.length) player.append(field('Assistant message',select([...messages].reverse().map(m=>({value:m.id,label:`${m.name || 'Assistant'} · ${plainText(stripCues(m.content)).slice(0,70)}`})), selectedId,v=>{selectedId=v})));
    if (currentSegments.length) {
      const segment = currentSegments[position], progress = el('progress');progress.max=phase==='preparing'?currentPassages.length:currentSegments.length;progress.value=phase==='preparing'?preparedCount:phase==='ready'?0:position+1;
      player.append(el('p',`${segment?.speaker || 'Voice'} · ${currentPassages[currentPassage]?.voice || ''} · Sentence ${position+1} of ${currentSegments.length}`,'ra-muted'),progress,el('p',plainText(segment?.text ?? ''), 'ra-passage'));
      if (currentMessage) player.append(el('p','The sentence marker estimates your place within continuous audio. Pausing keeps it in place.','ra-muted'));
    } else player.append(el('p',settings.enabled?'Prepare message reuses matching saved audio. If none is available, it generates speech and charges may apply.':'Readalong is off. Turn it on when you want prepared speech.','ra-muted'));
    player.append(toggle('Follow the spoken passage as it moves down the page',settings.follow,v=>{settings.follow=v;void safe(saveSettings)}));
    const slider = el('input'); slider.type='range'; slider.min='.5'; slider.max='2'; slider.step='.1'; slider.value=String(settings.speed);
    slider.oninput=()=>{settings.speed=Number(slider.value);speedLabel.textContent=`Playback speed · ${settings.speed.toFixed(1)}×`;audioPlayer.setSpeed(settings.speed)};
    slider.onchange=()=>{void safe(saveSettings)}; const speedLabel = el('span',`Playback speed · ${settings.speed.toFixed(1)}×`), speedField = el('label','', 'ra-field');speedField.append(speedLabel,slider);
    const volume = el('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value=String(settings.volume);volume.oninput=()=>{settings.volume=Number(volume.value);audioPlayer.setVolume(settings.volume)};volume.onchange=()=>{void safe(saveSettings)};
    const controls = el('div','', 'ra-grid');controls.append(speedField,field('Volume',volume));player.append(controls);renderWidget();
  }
  function renderConfig() {
    config.replaceChildren(el('h3','Speech connection'));
    config.append(field('Provider',select([{value:'lumiverse',label:'Lumiverse connection · recommended'},{value:'openrouter',label:'OpenRouter · direct'},{value:'browser',label:'Browser voices · free'},{value:'local',label:'Local / OpenAI-compatible'}],settings.provider,v=>{
      stop(false); settings.provider=v as Settings['provider'];
      if(v==='lumiverse'){const connection=activeNative()??nativeConnections.find(c=>c.provider==='openrouter_tts')??nativeConnections[0];if(connection)chooseNative(connection)}
      else if(v==='browser')settings.voice=voiceNames()[0] ?? '';else if(v==='local'){settings.model='kokoro';settings.voice='af_heart'}else{settings.model=DEFAULTS.model;settings.voice='Kore'};
      renderConfig();renderVoices();renderAssignments();void safe(async()=>{await saveSettings();await refreshCatalog()});
    })));
    if(settings.provider==='lumiverse') {
      config.append(field('Saved TTS connection',select([{value:'',label:'Choose a connection'},...nativeConnections.map(c=>({value:c.id,label:`${c.name} · ${c.provider.replace(/_tts$/,'')}`}))],settings.connectionId,v=>{
        stop(false);const connection=nativeConnections.find(c=>c.id===v);if(connection)chooseNative(connection);else settings.connectionId='';
        renderConfig();renderVoices();renderAssignments();void safe(async()=>{await saveSettings();await refreshCatalog()});
      })));
      config.append(button('Refresh connections and voices',()=>safe(refreshNativeConnections)));
      if(models.length && activeNative())config.append(field('Speech model',select(models.map(m=>({value:m.id,label:m.name})),settings.model,v=>{stop(false);settings.model=v;settings.voice=voiceNames()[0]??'';renderConfig();renderVoices();renderAssignments();void safe(saveSettings)})));
      config.append(el('p','Uses your saved Lumiverse TTS connection and key. No separate key or helper app is needed. Add or edit connections in Lumiverse’s voice settings.','ra-muted'));
      config.append(button('Check connection',()=>safe(async()=>{if(!activeNative())throw new Error('Choose a saved TTS connection first.');notice('Checking connection…');notice(await nativeTts.check(settings.connectionId))})));
      if(/gemini-3\.8.*tts/i.test(settings.model))config.append(el('p','Gemini 3.8 supports your preset’s inline vocal sounds and pauses. Separate Readalong emotion directions are not yet supported through this connection.','ra-muted'));
      diagnoseButton=null;diagnoseHint=null;
    }
    if(settings.provider==='openrouter') {
      config.append(field('Speech model',select(models.map(m=>({value:m.id,label:m.name})),settings.model,v=>{stop(false);settings.model=v;settings.voice=voiceNames()[0]??'';renderConfig();renderVoices();renderAssignments();void safe(saveSettings)})));
      config.append(button('Refresh models and voices',()=>safe(async()=>{const r=await rpc('models');models=r.models;if(!models.some(m=>m.id===settings.model))models.unshift({id:settings.model,name:settings.model,voices:[]});renderConfig();renderVoices();renderAssignments();notice('Voice lists updated from OpenRouter.')})));

    }
    if(settings.provider==='local')config.append(field('API base URL',textInput(settings.localUrl,v=>settings.localUrl=v)),field('Model ID',textInput(settings.model,v=>settings.model=v)));
    if(settings.provider!=='browser' && settings.provider!=='lumiverse') {
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
    config.append(toggle('Ask the existing chat model for occasional emotion and speaker cues',settings.promptEmotions,v=>settings.promptEmotions=v),toggle('Use emotion cues when the speech model supports them',settings.useEmotions,v=>settings.useEmotions=v),button('Save settings',()=>safe(saveSettings),true));
    config.append(el('p','Emotion cues add a few tokens to normal chat replies. No second LLM is called. Hidden tags remain in the original message.','ra-muted'));
  }
  function renderVoices() {
    voicesCard.replaceChildren(el('h3','Choose a voice'));
    const row=el('div','', 'ra-row');
    const listen=button('Listen',()=>safe(()=>preview(settings.voice)));listen.disabled=!settings.enabled;
    row.append(field('Default voice',voiceSelect(settings.voice,v=>{settings.voice=v;renderVoices();void safe(saveSettings)})),listen);voicesCard.append(row);
    if(settings.provider==='local')voicesCard.append(field('Other voice ID',textInput(settings.voice,v=>settings.voice=v)),el('p','The listed voices are common Kokoro defaults. Enter a voice ID for another local server.','ra-muted'));
    const names=voiceNames();const search=textInput('',v=>drawList(v));search.placeholder='Search voices';search.setAttribute('aria-label','Search voices');
    const list=el('div','', 'ra-voice-list');
    const count=el('p',`${names.length} voices${settings.provider==='openrouter'?' for this model':''}. Choose a voice, then listen to a short sample.`,'ra-muted');
    function drawList(query='') {list.replaceChildren();for(const name of names.filter(n=>n.toLowerCase().includes(query.toLowerCase()))) {const b=button(name,()=>{settings.voice=name;renderVoices();void safe(saveSettings)});b.setAttribute('aria-pressed',String(name===settings.voice));list.append(b)}}
    drawList();voicesCard.append(count,search,list);
    if(!names.length)voicesCard.append(el('p','This model has no voice list yet. Refresh models, or enter the voice ID below.','ra-muted'),field('Voice ID',textInput(settings.voice,v=>settings.voice=v)));
    voicesCard.append(field('Narrator voice',voiceSelect(settings.narratorVoice,v=>{settings.narratorVoice=v;void safe(saveSettings)},true)));
    if(settings.provider==='lumiverse')voicesCard.append(toggle('Use Lumiverse’s saved character and narrator voices when no Readalong voice is assigned',settings.inheritVoices,v=>{settings.inheritVoices=v;void safe(saveSettings)}));
    voicesCard.append(el('p','Quoted dialogue uses the speaking character; surrounding prose uses the narrator. A speaker cue inside a quote selects its character and ends at the closing quote. Choose different voices to hear the switch.','ra-muted'));
  }
  function assignmentForm(key: string, name: string, container: HTMLElement) {
    const assignment={...(settings.assignments[key]??{voice:'',emotion:'neutral',delivery:'normal'})};
    container.replaceChildren(el('h3',`Voice for ${name}`));
    const update=async()=>{settings.assignments[key]=assignment;await saveSettings()};
    container.append(field('Voice',voiceSelect(assignment.voice,v=>assignment.voice=v,true)));
    if(settings.provider==='local')container.append(field('Custom voice ID',textInput(assignment.voice,v=>assignment.voice=v)));
    const row=el('div','', 'ra-grid');row.append(field('Default emotion',select(EMOTIONS.map(v=>({value:v,label:v})),assignment.emotion,v=>assignment.emotion=v)),field('Default delivery',select(DELIVERIES.map(v=>({value:v,label:v})),assignment.delivery,v=>assignment.delivery=v)));container.append(row);
    const listen=button('Listen',()=>safe(()=>preview(assignment.voice||settings.voice,assignment)));listen.disabled=!settings.enabled;
    const actions=el('div','', 'ra-row');actions.append(listen,button('Save voice',()=>safe(update),true),button('Use defaults',()=>safe(async()=>{delete settings.assignments[key];await saveSettings();assignmentForm(key,name,container)})));container.append(actions);
  }
  function renderAssignments() {
    assignmentsCard.replaceChildren(el('h3','Character voices'),el('p','Readalong assignments use this speech connection and override inherited Lumiverse voices. Choose a voice again after changing provider or model.','ra-muted'));
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
      const read=button('Read aloud',()=>safe(()=>readId(messageId)));read.disabled=!settings.enabled;target.append(read);bubbleHandles.set(messageId,handle);
    }
  }
  function onEvent(name:string,fn:(payload:any)=>void) {cleanups.push(ctx.events.on(name,p=>fn(p)))}
  onEvent('CHAT_SWITCHED',()=>{
    stop(false); messages=[]; selectedId='';automaticPreparations.clear();
    for (const handle of bubbleHandles.values()) ctx.dom.uninject(handle);
    bubbleHandles.clear(); notice(settings.enabled?'Looking for saved audio…':'Readalong is off.'); void safe(async()=>{await refreshMessages();await prepareLatest(false,true)});
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
  const action=ctx.ui.registerInputBarAction({id:'readalong',label:'Readalong',subtitle:'Listen and find your place'});cleanups.push(action.onClick(()=>{tab.activate();void safe(openWidget)}));
  function installEditor() {
    if(editorTab || !permissions.includes('characters'))return;
    editorTab=ctx.ui.registerCharacterEditorTab({id:'readalong-voice',title:'Readalong voice'});editorTab.root.classList.add('ra');editorTab.root.dataset.raUi='true';
    const render=()=>{const state=ctx.ui.characterEditor.getState();if(state.open&&state.characterId)assignmentForm(`id:${state.characterId}`,characters.find(c=>c.id===state.characterId)?.name??'this character',editorTab!.root)};
    cleanups.push(ctx.ui.characterEditor.onChange(render),editorTab.onActivate(render));render();
  }
  if('speechSynthesis' in window){const refresh=()=>{if(settings.provider==='browser'){renderVoices();renderAssignments()}};speechSynthesis.addEventListener('voiceschanged',refresh);cleanups.push(()=>speechSynthesis.removeEventListener('voiceschanged',refresh))}
  renderPlayer();renderConfig();renderVoices();renderAssignments();ctx.ready();
  void safe(async()=>{
    const r=await rpc('init');if(disposed)return;settings=normalizeSettings(r.settings);cacheUserId=typeof r.userId==='string'?r.userId:'';hasKey=r.hasKey;permissions=r.permissions;ready=true;
    try {
      nativeConnections=await nativeTts.connections();if(disposed)return;
      const existing=nativeConnections.find(c=>c.provider==='openrouter_tts' && c.model===settings.model) ?? nativeConnections.find(c=>c.provider==='openrouter_tts');
      if(needsPcm(settings) && existing){chooseNative(existing,true);await saveSettings()}
      else if(settings.provider==='lumiverse' && !settings.connectionId && nativeConnections.length){chooseNative(existing??nativeConnections[0]);await saveSettings()}
    } catch { /* Direct/browser modes remain available if native TTS is absent. */ }
    renderPlayer();renderConfig();renderVoices();renderAssignments();installEditor();
    if(r.cueStatus)notice(r.cueStatus,true);else notice('Ready. Choose a voice and listen to a sample.');
    if(permissions.includes('characters')){try{const r=await rpc('characters');characters=r.characters;renderAssignments()}catch{}}
    initialized=true;
    if(settings.provider==='lumiverse' || permissions.includes('cors_proxy'))void refreshCatalog().catch(()=>{});
    if(permissions.includes('chat_mutation')){await refreshMessages();await prepareLatest(false,true)}
    if(!settings.enabled)notice('Readalong is off. No speech requests will be started.');
  });
  return()=>{
    stop(false);disposed=true;marker.dispose();audioPlayer.dispose();widgetDragCleanup?.();widget?.destroy();for(const fn of cleanups)fn();editorTab?.destroy();action.destroy();tab.destroy();
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Readalong unloaded.'))}pending.clear();ctx.dom.cleanup();
  };
}
