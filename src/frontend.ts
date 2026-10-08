import type { SpindleFrontendContext, SpindleCharacterEditorTabHandle, SpindleFloatWidgetHandle } from 'lumiverse-spindle-types';
import { DEFAULTS, GEMINI_VOICES, EMOTIONS, DELIVERIES, needsPcm, normalizeSettings, parseSegments, speakerCharacterId, plainText, stripCues, speechRequest, type CharacterInfo, type Settings, type SpeechSegment, type SpeechModel, type MessageInfo, type VoiceAssignment } from './shared';
import { PassageMarker } from './highlight';
import { createNativeTtsClient, nativeSpeechRequest, type NativeConnection } from './native-tts';
import { planSpeech, prepareAll, estimatedSentenceIndex, type SpeechPassage, type VoiceContext } from './playback-plan';
import { PreparedPlayer, prepareClip, type PreparedClip } from './prepared-audio';
import { AudioCache, preparationHash } from './audio-cache';
import {widgetDimensions as resolveWidgetDimensions,widgetPosition} from './widget-layout';
import {patchPlaybackChildren} from './playback-ui';
import {earlyPlaybackPrefix} from './early-playback';
import {CompletionInbox,type CompletedReply} from './auto-preparation';
import {normalizePronunciations,pronunciationEntry,pronunciationSample,type Pronunciations,type PronunciationEntry} from './pronunciation';

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
.ra .ra-cast-entry{border:1px solid var(--lumiverse-border,#555);border-radius:9px;padding:10px 12px;margin:10px 0;}.ra .ra-cast-entry>summary{font-weight:600;overflow-wrap:anywhere;}.ra .ra-cast-entry .ra-cast-form{padding-top:5px;}
.ra-bubble{display:flex;gap:8px;align-items:center;padding:5px 0;font-size:12px}.ra-bubble button{padding:5px 9px;font-size:12px;}.ra details>summary{cursor:pointer;font-size:13px;margin:8px 0;}
.ra-mini{font:13px/1.4 system-ui,sans-serif;color:var(--lumiverse-text,#eee);padding:12px;background:var(--lumiverse-bg,#202026);height:100%;box-sizing:border-box;}
.ra-mini .ra-row{display:flex;gap:7px;align-items:center}.ra-mini .ra-caption{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:7px 0;color:var(--lumiverse-text-muted,#aaa);}
.ra-mini .ra-widget-heading{flex:1;min-width:0;display:flex;flex-direction:column;}.ra-mini .ra-widget-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.ra-mini .ra-controls{flex-wrap:wrap;}
.ra-mini button{font:inherit;border:1px solid var(--lumiverse-border,#555);border-radius:7px;background:var(--lumiverse-fill,#292932);color:inherit;padding:6px 10px;cursor:pointer;}
.ra-mini button:disabled{opacity:.5;cursor:default}.ra-mini .ra-primary{background:var(--lumiverse-primary,#ac8b4f);color:var(--lumiverse-on-primary,#fff);}
.ra-mini .ra-widget-tools{margin-left:auto;gap:5px}.ra-mini .ra-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;flex-shrink:0;}
.ra-mini .ra-time{font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}.ra-mini progress{width:100%;height:4px;accent-color:#e7b24c;}
.ra-mini.ra-collapsed{position:relative;padding:8px;display:flex;align-items:center;gap:6px;}
.ra-collapsed .ra-compact-play{width:34px;height:34px;padding:0;flex-shrink:0;font-size:16px;}
.ra-collapsed .ra-compact-info{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25;}
.ra-collapsed .ra-compact-info strong{font-size:11px}.ra-collapsed .ra-compact-status{font-size:10px;color:var(--lumiverse-text-muted,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ra-collapsed .ra-power{font-size:11px;padding:4px;flex-shrink:0;}.ra-collapsed progress{position:absolute;bottom:3px;left:8px;width:calc(100% - 16px);height:3px;pointer-events:none;}
.ra-mini.ra-touch button{min-width:44px;min-height:44px;touch-action:manipulation;}.ra-mini.ra-touch .ra-icon,.ra-mini.ra-touch .ra-compact-play{width:44px;height:44px;}
.ra-mini.ra-collapsed.ra-narrow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;}.ra-collapsed.ra-narrow .ra-compact-info{display:none;}.ra-mini.ra-collapsed.ra-narrow button{width:100%;min-width:0;min-height:44px;}
`;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node }
function button(text: string, action: () => void | Promise<void>, primary = false) { const b = el('button',text,primary ? 'ra-primary' : ''); b.type = 'button';b.dataset.raControl=text; b.onclick = () => { void action() }; return b }
function field(label: string, input: HTMLElement) { const l = el('label','', 'ra-field'); input.setAttribute('aria-label',label); l.append(el('span',label), input); return l }
function select(options: {value:string;label:string}[], value: string, change: (v: string) => void) { const s = el('select'); for (const o of options) { const option = el('option',o.label); option.value = o.value; s.append(option) }; s.value = value; s.onchange = e => change((e.currentTarget as HTMLSelectElement).value); return s }
function textInput(value: string, onInput: (value: string) => void, type = 'text') { const i = el('input'); i.type = type; i.value = value; i.oninput = () => onInput(i.value); return i }
function toggle(label: string, value: boolean, change: (v: boolean) => void) { const row = el('label','', 'ra-toggle'), i = el('input'); i.type = 'checkbox'; i.checked = value; i.onchange = e => change((e.currentTarget as HTMLInputElement).checked); row.append(i,el('span',label)); return row }
function timeLabel(seconds:number){const value=Math.floor(seconds);return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}

export function setup(ctx: SpindleFrontendContext) {
  let settings = normalizeSettings(DEFAULTS), ready = false, initialized = false, disposed = false;
  const hasKeys={openrouter:false,local:false},frontendId=crypto.randomUUID();
  const castDrafts=new Map<string,VoiceAssignment>(),openCast=new Set<string>();let castInitialized=false;
  let canDiagnoseSpeech = false, diagnosing = false, diagnoseButton: HTMLButtonElement | null = null;
  let diagnoseHint: HTMLElement | null = null;
  let models: SpeechModel[] = [{ id:DEFAULTS.model, name:'Google: Gemini 3.8 Flash TTS', voices:GEMINI_VOICES }];
  const nativeTts=createNativeTtsClient(), nativeRequests=new Set<AbortController>();
  let nativeConnections:NativeConnection[]=[], catalogEpoch=0;
  let characters: CharacterInfo[] = [], permissions: string[] = [];
  let messages: MessageInfo[] = [], selectedId = '';
  let pronunciationEntries:Pronunciations={},pronunciationChatId='',pronunciationEpoch=0;
  const openPronunciations=new Set<string>();
  let playbackId = 0, playing = false, paused = false, currentMessage: MessageInfo | null = null;
  let phase:'idle'|'preparing'|'ready'|'playing'|'paused'|'finished'='idle';
  let checkingSavedAudio=false;
  let preparingAudio=false,waitingForAudio=false;
  let playAttempt:object|null=null,messageLoad:object|null=null;
  let utterance: SpeechSynthesisUtterance | null = null;
  const audioPlayer=new PreparedPlayer();
  const audioCache=new AudioCache();let cacheUserId='';
  const automaticPreparations=new Set<string>();
  const completionInbox=new CompletionInbox(),knownCompletions=new Map<string,string>();
  const localGenerations=new Map<string,{chatId:string;name?:string;characterId?:string;eligible?:boolean}>();
  let completionRecovery:object|null=null;
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
  let editorTab: SpindleCharacterEditorTabHandle | null = null;
  const tab = ctx.ui.registerDrawerTab({ id:'readalong', title:'Readalong', shortName:'Read', description:'Listen to passages, assign character voices, and follow the spoken text', keywords:['tts','voice','speech','audio'] });
  const root = tab.root; root.classList.add('ra'); root.dataset.raUi = 'true';
  cleanups.push(ctx.dom.addStyle(STYLE));
  const heading = el('h2','Readalong'); const intro = el('p','Find your place at a glance. Give each character a voice.','ra-muted');
  const status = el('p','Loading…','ra-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const player = el('section','', 'ra-card'), config = el('section','', 'ra-card'), voicesCard = el('section','', 'ra-card'), assignmentsCard = el('section','', 'ra-card'),pronunciationsCard=el('section','','ra-card');
  root.append(heading,intro,status,player,config,voicesCard,assignmentsCard,pronunciationsCard);
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
      pending.set(requestId,{resolve,reject,timer}); ctx.sendToBackend({ type, requestId, frontendId, ...payload });
    });
  }
  cleanups.push(ctx.onBackendMessage((payload: any) => {
    if (payload?.type === 'reply') {
      const p = pending.get(payload.requestId); if (!p) return; clearTimeout(p.timer); pending.delete(payload.requestId);
      if (typeof payload.canDiagnoseSpeech === 'boolean') showDiagnostics(payload.canDiagnoseSpeech);
      if (payload.error) p.reject(new Error(payload.error)); else p.resolve(payload.data);
    } else if (payload?.type === 'new_message' && payload.chatId === ctx.getActiveChat().chatId && payload.message && !payload.message.isUser) {
      if(payload.autoEligible!==false)void safe(()=>receiveCompletion({chatId:payload.chatId,messageId:payload.message.id,generationId:payload.generationId??payload.message.id,completedAt:typeof payload.completedAt==='number'?payload.completedAt:Date.now(),message:payload.message}));
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
    playbackId++; playing = false; paused = false; phase='idle';checkingSavedAudio=false;preparingAudio=false;waitingForAudio=false;playAttempt=null;messageLoad=null;stopClock();
    if(showStatus)completionInbox.reset();
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
        const initialPosition=widgetPosition(widgetViewport(),{width,height},settings.widgetPosition);
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
  function widgetTouch(){return window.innerWidth<=600 || window.matchMedia('(pointer: coarse)').matches}
  function widgetDimensions(){return resolveWidgetDimensions(widgetViewport(),settings.widgetMinimized,widgetTouch())}
  function fitWidgetPosition(preferred=settings.widgetPosition??widget?.getPosition()){
    if(!widget)return;const position=widgetPosition(widgetViewport(),widgetDimensions(),preferred),current=widget.getPosition();
    if(current.x!==position.x || current.y!==position.y)widget.moveTo(position.x,position.y);
  }
  async function setWidgetMinimized(minimized:boolean){const preferred=settings.widgetPosition??widget?.getPosition();settings.widgetMinimized=minimized;renderWidget();fitWidgetPosition(preferred);await saveSettings()}
  const resizeWidget=()=>{if(disposed || !widget)return;const preferred=settings.widgetPosition??widget.getPosition();renderWidget();fitWidgetPosition(preferred)};
  window.addEventListener('resize',resizeWidget);cleanups.push(()=>window.removeEventListener('resize',resizeWidget));
  const pointerMedia=window.matchMedia('(pointer: coarse)');pointerMedia.addEventListener('change',resizeWidget);cleanups.push(()=>pointerMedia.removeEventListener('change',resizeWidget));
  function renderWidget() {
    if(!widget || disposed)return;
    const {width,height}=widgetDimensions(),size=`${width}:${height}`;
    // Resize the host container as well as our content, preserving its drag position.
    if(widgetSize!==size){widget.setSize(width,height);widgetSize=size}
    widget.root.classList.toggle('ra-collapsed',settings.widgetMinimized);
    widget.root.classList.toggle('ra-touch',widgetTouch());widget.root.classList.toggle('ra-narrow',widgetDimensions().narrow);
    const header=el('div','', 'ra-row'),title=el('div','', 'ra-widget-heading');title.append(el('strong','Readalong'));header.append(title);
    if(audioPlayer.duration){const time=el('span',`${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`,'ra-time');title.append(time)}
    const close=button('×',()=>widget?.setVisible(false));close.className='ra-icon';close.setAttribute('aria-label','Hide floating player');close.title='Hide floating player';
    const resize=button(settings.widgetMinimized?'↗':'−',()=>safe(()=>setWidgetMinimized(!settings.widgetMinimized)));resize.className='ra-icon';resize.setAttribute('aria-label',settings.widgetMinimized?'Expand floating player':'Minimize floating player');resize.title=resize.getAttribute('aria-label')!;resize.setAttribute('aria-expanded',String(!settings.widgetMinimized));
    const caption=el('p',phase==='playing' || phase==='paused' ? `${currentSegments[position]?.speaker || 'Voice'} · ${currentPassages[currentPassage]?.voice || ''}` : status.textContent ?? 'Choose a message.','ra-caption');
    caption.title=plainText(currentSegments[position]?.text ?? caption.textContent ?? '');
    const controls=el('div','', 'ra-row ra-controls');
    const playLabel=!settings.enabled?'Turn on':playAttempt?'Starting…':messageLoad?'Loading…':phase==='preparing'?(checkingSavedAudio?'Loading…':'Preparing…'):phase==='idle'?'Load saved':phase==='paused'?'Resume':phase==='playing'?'Pause':phase==='finished'?'Replay':'Play';
    const play=button(playLabel,()=>safe(settings.enabled?playOrPause:()=>setEnabled(true)),true);play.title=playLabel;
    play.dataset.raControl='play';play.disabled=!ready || !!playAttempt || !!messageLoad || settings.enabled && (phase==='preparing' || phase==='idle' && !selectedId);controls.append(play);
    const stopButton=button('Stop',()=>stop());stopButton.disabled=phase==='idle';controls.append(stopButton,button('Open player',()=>tab.activate()));
    const power=button(settings.enabled?'On':'Off',()=>safe(()=>setEnabled(!settings.enabled)));power.className='ra-power';power.setAttribute('aria-label',settings.enabled?'Turn Readalong off':'Turn Readalong on');power.title=power.getAttribute('aria-label')!;
    const progress=el('progress');progress.max=1;progress.value=preparingAudio?preparedCount/Math.max(1,currentPassages.length):phase==='finished'?1:phase==='ready'?0:audioPlayer.duration?audioPlayer.elapsed/audioPlayer.duration:position/Math.max(1,currentSegments.length);progress.setAttribute('aria-label',preparingAudio?'Speech preparation':'Playback progress');
    if(settings.widgetMinimized){
      play.textContent=phase==='preparing'?'…':phase==='playing'?'Ⅱ':phase==='finished'?'↻':'▶';play.setAttribute('aria-label',playLabel);play.classList.add('ra-compact-play');
      const info=el('div','', 'ra-compact-info');info.append(el('strong','Readalong'));
      const detail=el('span',!settings.enabled?'Off':audioPlayer.duration && ['playing','paused','ready','finished'].includes(phase)?`${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`:playLabel, audioPlayer.duration && settings.enabled && phase!=='preparing'?'ra-compact-status ra-time':'ra-compact-status');
      detail.title=status.textContent??'';info.append(detail);
      patchPlaybackChildren(widget.root,play,info,power,resize,close,progress);
    }else{
      const tools=el('div','', 'ra-row ra-widget-tools');tools.append(power,resize,close);header.append(tools);
      patchPlaybackChildren(widget.root,header,caption,controls,progress);
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
    const progress=widget?.root.querySelector('progress');if(progress && !preparingAudio)progress.value=at.duration?at.elapsed/at.duration:0;
    const time=widget?.root.querySelector('.ra-time');if(time)time.textContent=`${timeLabel(at.elapsed)} / ${timeLabel(at.duration)}`;
  }
  function finished() {
    playing=false;paused=false;phase='finished';stopClock();
    if(currentPassages.length)markSentence(currentPassages.length-1,currentPassages.at(-1)!.segments.length-1);
    notice(currentPassages[0]?.settings.provider==='browser'?'Finished. Replay reads this passage again.':'Finished. Replay uses the prepared audio.');renderPlayer();
  }
  audioPlayer.onEnded=finished;
  audioPlayer.onError=error=>{paused=true;playing=false;phase='paused';stopClock();notice(error.message,true);renderPlayer()};
  audioPlayer.onWaiting=waiting=>{waitingForAudio=waiting;if(phase==='playing')notice(waiting?'Waiting for the remaining audio. Preparation continues; no retry was sent.':'Reading…');renderPlayer()};
  async function playOrPause() {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to prepare audio.');
    if(playAttempt || messageLoad)return;
    if(phase==='preparing')return;
    // Loading saved audio is a separate action. Play never authorizes synthesis.
    if(phase==='idle'){if(!selectedId)throw new Error('No assistant message found.');await readId(selectedId,true);return;}
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
    const attempt={};playAttempt=attempt;
    try {
      // Call play synchronously inside the click, before any asynchronous work.
      const pending=audioPlayer.play();renderPlayer();
      const started=await pending;
      if(token!==playbackId || !started)return;
      playing=true;phase='playing';notice(waitingForAudio?'Waiting for the remaining audio. Preparation continues; no retry was sent.':preparingAudio?'Reading… Remaining audio is still preparing.':'Reading…');updateClock();
      stopClock();clockTimer=setInterval(updateClock,100);
    }finally{if(playAttempt===attempt){playAttempt=null;renderPlayer()}}
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
  async function flushCompletion(){
    if(!initialized || disposed || !settings.enabled)return;
    const chatId=ctx.getActiveChat().chatId;if(!chatId)return;
    const reply=completionInbox.take(chatId);if(reply)await autoPrepareMessage(reply.message);
  }
  async function receiveCompletion(reply:CompletedReply){
    if(disposed || reply.chatId!==ctx.getActiveChat().chatId || !completionInbox.receive(reply))return;
    knownCompletions.set(reply.chatId,reply.generationId);
    while(knownCompletions.size>20)knownCompletions.delete(knownCompletions.keys().next().value!);
    messages=[...messages.filter(m=>m.id!==reply.message.id),reply.message];selectedId=reply.message.id;
    await flushCompletion();
  }
  async function refreshPronunciations(chatId=ctx.getActiveChat().chatId,messageId?:string):Promise<Pronunciations>{
    if(!chatId)return {};
    const epoch=++pronunciationEpoch,r=await rpc('pronunciations',{chatId,...(messageId?{messageId}:{})}),entries=normalizePronunciations(r.entries);
    if(!disposed && epoch===pronunciationEpoch && ctx.getActiveChat().chatId===chatId){pronunciationChatId=chatId;pronunciationEntries=entries;renderPronunciations();renderAssignments()}
    return entries;
  }
  async function recoverCompletion(){
    if(!initialized || !settings.enabled || disposed || completionRecovery || !permissions.includes('chat_mutation') || !permissions.includes('generation'))return;
    const chatId=ctx.getActiveChat().chatId;if(!chatId)return;
    const operation={};completionRecovery=operation;const since=completionInbox.since;
    const current=()=>!disposed && settings.enabled && ctx.getActiveChat().chatId===chatId && completionInbox.since===since;
    try {
      const r=await rpc('latest_completion',{chatId,since});const ticket=r.completion;
      if(!current() || r.generating || !ticket || ticket.completedAt<since || knownCompletions.get(chatId)===ticket.generationId)return;
      // A missing end notification must not leave the frontend thinking a
      // completed generation is still running. The backend confirms it ended.
      for(const [id,g] of localGenerations)if(g.chatId===chatId)localGenerations.delete(id);
      const loaded=await rpc('message',{chatId,messageId:ticket.messageId,latestOnly:true});
      if(!current())return;
      if(!loaded.message){knownCompletions.set(chatId,ticket.generationId);return}
      await receiveCompletion({...ticket,message:{...loaded.message,name:ticket.name||loaded.message.name,characterId:ticket.characterId??loaded.message.characterId}});
    }finally{if(completionRecovery===operation)completionRecovery=null}
  }
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
    if(!restoreOnly){automaticPreparations.add(key);if(automaticPreparations.size>20)automaticPreparations.delete(automaticPreparations.values().next().value!)}
    await startMessage(message,{automatic:true,restoreOnly});
  }
  async function prepareLatest(force=false,restoreOnly=false) {
    if(!settings.enabled || !initialized)return;
    const latest=messages.at(-1);if(latest)await autoPrepareMessage(latest,force,restoreOnly);
    else notice('Readalong is on. New assistant replies will prepare automatically.');
  }
  async function setEnabled(enabled:boolean) {
    if(settings.enabled===enabled)return;
    completionInbox.setEnabled(enabled);knownCompletions.clear();localGenerations.clear();
    settings.enabled=enabled;if(!enabled)stop(false);
    renderPlayer();renderVoices();renderAssignments();renderPronunciations();
    notice(enabled?'Readalong is on. Preparing the latest reply…':'Readalong is off. No speech requests will be started.');
    await saveSettings();
    if(enabled && settings.enabled){await refreshMessages();await prepareLatest(true)}
  }
  async function startMessage(message: MessageInfo,options:{automatic?:boolean;restoreOnly?:boolean}={}) {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to prepare audio.');
    if(!options.restoreOnly){
      automaticPreparations.add(JSON.stringify([ctx.getActiveChat().chatId,message.id,message.content]));
      if(automaticPreparations.size>20)automaticPreparations.delete(automaticPreparations.values().next().value!);
    }
    stop(false);
    const token=playbackId;readingAbort=new AbortController();const signal=readingAbort.signal;
    currentMessage={...message,characterId:message.characterId ?? speakerCharacterId(message.name,characters,ctx.getActiveChat().characterId ?? undefined)};
    phase='preparing';preparingAudio=true;checkingSavedAudio=true;preparedCount=0;showWidget();notice('Looking for saved audio. No speech requested yet.');renderPlayer();
    try {
      const snapshot=normalizeSettings(settings);
      const chatId=ctx.getActiveChat().chatId;
      const context:VoiceContext={characters,characterId:currentMessage.characterId,connections:nativeConnections,
        pronunciations:await refreshPronunciations(chatId,options.restoreOnly?undefined:message.id)};
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
      let restored=false,saved=true,openingCount=0;
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
          if(options.restoreOnly){stop(false);notice('No saved audio for this message. No speech was requested. Choose Prepare message to generate it; charges may apply.');return}
          const claim=await rpc('claim_preparation',{key:messageKey,manual:!options.automatic});
          if(token!==playbackId)return;
          if(!claim?.allowed){stop(false);notice('This message was already prepared or attempted. No speech was requested again. Choose Prepare message to retry; speech charges may apply.');return}
          checkingSavedAudio=false;notice('Preparing the whole message…');renderPlayer();
          const partial:Array<PreparedClip|undefined>=new Array(currentPassages.length),texts=currentPassages.map(p=>plainText(p.segment.text));
          clips=await prepareAll(currentPassages,async(p,_index,requestSignal)=>{
            const data=await prepareSpeech(p.segment,p.settings,requestSignal);requestSignal.throwIfAborted();
            const clip=await prepareClip(data,requestSignal);requestSignal.throwIfAborted();
            partial[_index]=clip;return clip;
          },signal,count=>{
            if(token!==playbackId)return;preparedCount=count;
            if(settings.earlyPlayback && !openingCount && count<currentPassages.length){
              const prefix=earlyPlaybackPrefix(texts,partial);
              if(prefix){
                openingCount=prefix;audioPlayer.begin(partial.slice(0,prefix) as PreparedClip[]);audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);phase='ready';
              }
            }
            notice(phase==='playing'?`Reading… ${count} of ${currentPassages.length} passages ready; preparation continues.`:phase==='paused'?`Paused. ${count} of ${currentPassages.length} passages ready; preparation continues.`:openingCount?`Opening audio is ready. Press Play while the rest prepares · ${count} of ${currentPassages.length} passages ready.`:`Preparing the whole message · ${count} of ${currentPassages.length} passages ready…`);renderPlayer();
          },snapshot.provider==='lumiverse'?3:2);
          if(token!==playbackId)return;
          // Preserve an active/paused opening buffer. Otherwise join everything
          // into the usual single PCM file before the first Play click.
          if(openingCount && (audioPlayer.hasStarted || playAttempt))audioPlayer.append(clips.slice(openingCount),true);
          else audioPlayer.load(clips);
          preparingAudio=false;audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);
          if(phase==='preparing')phase='ready';
          notice((phase as string)==='playing'?'Reading… The whole message is ready.':(phase as string)==='paused'?'Paused. The whole message is ready.':'The whole message is ready. Press Play.');renderPlayer();
          try{saved=await audioCache.put(cacheUserId,audioKey,clips)}catch{saved=false}
        }
        if(token!==playbackId)return;
        if(restored){audioPlayer.load(clips);audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume)}
      }
      if(token!==playbackId)return;
      if(phase==='preparing')phase='ready';preparingAudio=false;checkingSavedAudio=false;
      notice(restored?'Saved audio restored. No speech request or new charge. Press Play.':!saved?'Audio could not be saved for refresh. It will not regenerate automatically.':(phase as string)==='playing'?'Reading… The whole message is ready.':(phase as string)==='paused'?'Paused. The whole message is ready.':(phase as string)==='finished'?'Finished. Replay uses the prepared audio.':'The whole message is ready. Press Play.');renderPlayer();
    } catch(e) {if(token===playbackId){stop(false);throw e}}
  }
  async function preview(voice: string, assignment?: Partial<VoiceAssignment>,sample?:{text:string;entries:Pronunciations}) {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to test a voice.');
    stop(false);const token=playbackId;readingAbort=new AbortController();
    if(settings.provider!=='browser')audioPlayer.unlock();
    const segment={text:sample?.text??'The door was open. I took a breath, and stepped into the light.',speaker:'Preview',emotion:assignment?.emotion ?? 'neutral',delivery:assignment?.delivery ?? 'normal'};
    const snapshot=normalizeSettings({...settings,voice,narratorVoice:'',assignments:{},inheritVoices:false});
    currentPassages=planSpeech([segment],snapshot,{characters:[],pronunciations:sample?.entries});currentSegments=[segment];position=0;phase='preparing';showWidget();renderPlayer();notice(`Preparing ${voice}…`);
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
  async function readId(id: string,restoreOnly=false) {
    if(messageLoad)return;
    const chatId = ctx.getActiveChat().chatId; if (!chatId) throw new Error('Open a chat first.');
    const operation={};messageLoad=operation;const token=playbackId;renderPlayer();
    try {
      const r = await rpc('message',{chatId,messageId:id});
      if (ctx.getActiveChat().chatId !== chatId || token!==playbackId || messageLoad!==operation)return;
      await startMessage(r.message,{restoreOnly});
    }finally{if(messageLoad===operation){messageLoad=null;renderPlayer()}}
  }
  function renderPlayer() {
    for(const handle of bubbleHandles.values()){const read=handle.querySelector('button');if(read)read.disabled=!settings.enabled}
    const playerContent=el('section');
    playerContent.append(el('h3',phase==='preparing'?(checkingSavedAudio?'Looking for saved audio':'Preparing the whole message'):phase==='ready'?'Ready to play':phase==='playing' || phase==='paused'?'Now reading':'Listen to a passage'));
    playerContent.append(toggle('Readalong on · prepare replies automatically',settings.enabled,v=>{void safe(()=>setEnabled(v))}),el('p','When on, new replies prepare automatically and may incur speech charges. Refresh restores saved audio without generating speech. Turning on prepares the latest reply once. Audio waits for Play. Turn off to stop new requests.','ra-muted'));
    const row = el('div','', 'ra-row');
    if (phase !== 'idle') {
      const play=button(playAttempt?'Starting…':phase==='paused'?'Resume':phase==='playing'?'Pause':phase==='finished'?'Replay':'Play',()=>safe(playOrPause),true);play.dataset.raControl='play';play.disabled=phase==='preparing' || !!playAttempt;
      row.append(play,button('Stop',()=>stop()));
    } else {
      const read = button('Prepare message',()=>safe(async()=>{ if (selectedId) await readId(selectedId); else { await refreshMessages(); if (selectedId) await readId(selectedId); else throw new Error('No assistant message found.') } }),true);
      read.disabled = !ready || !settings.enabled || !!messageLoad; row.append(read,button('Refresh messages',()=>safe(refreshMessages)));
    }
    if(typeof ctx.ui.createFloatWidget==='function')row.append(button('Floating player',()=>safe(openWidget)));
    if (currentMessage) row.append(button('Return to passage',()=>marker.follow()));
    playerContent.append(row);
    if(ready && typeof ctx.ui.createFloatWidget==='function' && (widgetError || !permissions.includes('ui_panels')))playerContent.append(el('p',widgetError || widgetPermissionHint,'ra-muted'));
    if (phase==='idle' && messages.length) playerContent.append(field('Assistant message',select([...messages].reverse().map(m=>({value:m.id,label:`${m.name || 'Assistant'} · ${plainText(stripCues(m.content)).slice(0,70)}`})), selectedId,v=>{selectedId=v})));
    if (currentSegments.length) {
      const segment = currentSegments[position], progress = el('progress');progress.max=preparingAudio?currentPassages.length:currentSegments.length;progress.value=preparingAudio?preparedCount:phase==='ready'?0:position+1;progress.setAttribute('aria-label',preparingAudio?'Speech preparation':'Playback progress');
      playerContent.append(el('p',`${segment?.speaker || 'Voice'} · ${currentPassages[currentPassage]?.voice || ''} · Sentence ${position+1} of ${currentSegments.length}`,'ra-muted'),progress,el('p',plainText(segment?.text ?? ''), 'ra-passage'));
      if (currentMessage) playerContent.append(el('p','The sentence marker estimates your place within continuous audio. Pausing keeps it in place.','ra-muted'));
    } else playerContent.append(el('p',settings.enabled?'Prepare message reuses matching saved audio. If none is available, it generates speech and charges may apply.':'Readalong is off. Turn it on when you want prepared speech.','ra-muted'));
    playerContent.append(toggle('Follow the spoken passage as it moves down the page',settings.follow,v=>{settings.follow=v;void safe(saveSettings)}));
    playerContent.append(toggle('Allow Play when about 75% of the message is ready',settings.earlyPlayback,v=>{settings.earlyPlayback=v;void safe(saveSettings)}),el('p','Needs at least 30 seconds ready in order. You still press Play. The rest prepares using the same requests; playback waits if it catches up. One-file messages become playable when that file finishes.','ra-muted'));
    const slider = el('input'); slider.type='range'; slider.min='.5'; slider.max='2'; slider.step='.1'; slider.value=String(settings.speed);
    slider.oninput=e=>{const input=e.currentTarget as HTMLInputElement;settings.speed=Number(input.value);const label=input.parentElement?.querySelector('span');if(label)label.textContent=`Playback speed · ${settings.speed.toFixed(1)}×`;audioPlayer.setSpeed(settings.speed)};
    slider.onchange=()=>{void safe(saveSettings)}; const speedLabel = el('span',`Playback speed · ${settings.speed.toFixed(1)}×`), speedField = el('label','', 'ra-field');speedField.append(speedLabel,slider);
    const volume = el('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value=String(settings.volume);volume.oninput=e=>{settings.volume=Number((e.currentTarget as HTMLInputElement).value);audioPlayer.setVolume(settings.volume)};volume.onchange=()=>{void safe(saveSettings)};
    const controls = el('div','', 'ra-grid');controls.append(speedField,field('Volume',volume));playerContent.append(controls);patchPlaybackChildren(player,...playerContent.childNodes);renderWidget();
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
      const provider=settings.provider;
      const key=textInput('',()=>{},'password');key.autocomplete='off';key.placeholder=hasKeys[provider]?'Key saved · leave blank to keep it':'Paste your API key';
      config.append(field('API key',key),button('Save key',()=>safe(async()=>{if(!key.value.trim())throw new Error('Paste a key first.');const r=await rpc('save_key',{key:key.value,provider,localUrl:settings.localUrl});hasKeys[provider]=r.hasKey;key.value='';key.placeholder='Key saved';notice('API key saved securely.');})),button('Remove saved key',()=>safe(async()=>{
        const result=await ctx.ui.showConfirm({title:'Remove saved key?',message:`Remove the Readalong ${provider==='local'?'local-provider':'OpenRouter'} key? Lumiverse’s saved TTS connections are unaffected.`,variant:'danger',confirmLabel:'Remove key'});
        if(!result.confirmed)return;
        await rpc('remove_key',{provider,confirmed:true});hasKeys[provider]=false;key.placeholder='Paste your API key';notice('Saved key removed.');
      })));
      if(provider==='local')config.append(el('p','A local key is bound to this exact server address. Changing the address requires saving a key for it again. Remote servers with keys must use HTTPS.','ra-muted'));
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
  function assignmentForm(key: string, name: string, container: HTMLElement,options?:{draft:VoiceAssignment;onSaved:()=>void;onRemove:()=>Promise<void>}) {
    const assignment=options?.draft??{...(settings.assignments[key]??{voice:'',emotion:'neutral',delivery:'normal'})};
    container.replaceChildren(el('h3',`Voice for ${name}`));
    const update=async()=>{settings.assignments[key]={...assignment};await saveSettings();if(options)options.onSaved();else{castDrafts.delete(key);renderAssignments()}notice(`Voice saved for ${name}.`)};
    container.append(field('Voice',voiceSelect(assignment.voice,v=>assignment.voice=v,true)));
    if(settings.provider==='local')container.append(field('Custom voice ID',textInput(assignment.voice,v=>assignment.voice=v)));
    const row=el('div','', 'ra-grid');row.append(field('Default emotion',select(EMOTIONS.map(v=>({value:v,label:v})),assignment.emotion,v=>assignment.emotion=v)),field('Default delivery',select(DELIVERIES.map(v=>({value:v,label:v})),assignment.delivery,v=>assignment.delivery=v)));container.append(row);
    const listen=button('Listen',()=>safe(()=>preview(assignment.voice||settings.voice,assignment)));listen.disabled=!settings.enabled;
    const actions=el('div','', 'ra-row');actions.append(listen,button('Save voice',()=>safe(update),true),button(options?'Remove cast voice':'Use defaults',()=>safe(options?.onRemove??(async()=>{delete settings.assignments[key];castDrafts.delete(key);openCast.delete(key);await saveSettings();assignmentForm(key,name,container);renderAssignments()}))));container.append(actions);
    const pronunciation=el('details');pronunciation.append(el('summary','Name pronunciation for this story'));
    pronunciationForm(pronunciation,name.split('||')[0].trim(),assignment.voice||settings.voice,assignment);container.append(pronunciation);
  }
  function pronunciationForm(container:HTMLElement,initialName:string,voice=settings.voice,assignment?:Partial<VoiceAssignment>,saved?:PronunciationEntry){
    const chatId=ctx.getActiveChat().chatId;
    const known=saved??Object.values(pronunciationEntries).find(e=>[e.name,...e.aliases].some(n=>n.toLowerCase()===initialName.toLowerCase()));
    let name=known?.name??initialName,spokenAs=known?.spokenAs??'',aliases=(known?.aliases??[]).join(', '),testSpelling='';
    const testChoices=el('select');testChoices.onchange=()=>testSpelling=testChoices.value;
    const testField=field('Name to test',testChoices);
    const refreshTestChoices=()=>{
      const names=[...new Set([name.trim(),...aliases.split(',').map(s=>s.trim())].filter(Boolean))];
      if(testSpelling && !names.includes(testSpelling))testSpelling='';
      testChoices.replaceChildren();
      for(const choice of [{value:'',label:'Main name and all alternatives'},...names.map((value,index)=>({value,label:`${value} (${index===0?'main name':'alternative'})`}))]){
        const option=el('option',choice.label);option.value=choice.value;testChoices.append(option);
      }
      testChoices.value=testSpelling;testField.hidden=names.length<2;testField.style.display=names.length<2?'none':'';
    };
    const nameInput=textInput(name,v=>{name=v;refreshTestChoices()});nameInput.maxLength=80;nameInput.readOnly=!!saved;
    const soundInput=textInput(spokenAs,v=>spokenAs=v);soundInput.maxLength=100;soundInput.placeholder='For example, Eleese';
    const aliasInput=textInput(aliases,v=>{aliases=v;refreshTestChoices()});aliasInput.maxLength=810;aliasInput.placeholder='For example, Elys-04';
    refreshTestChoices();
    container.append(field('Name in the story',nameInput),field('Pronounce as',soundInput),field('Other spellings or nicknames (comma separated)',aliasInput),testField);
    const candidate=()=>{
      const entry=pronunciationEntry({name,spokenAs,aliases:aliases.split(',').map(s=>s.trim()).filter(Boolean)},'manual');
      if(!entry)throw new Error('Enter a name and its spoken spelling first.');
      if(!chatId || ctx.getActiveChat().chatId!==chatId)throw new Error('Select this story again before saving its pronunciation.');
      return entry;
    };
    const test=button('Test pronunciation',()=>safe(async()=>{const entry=candidate();await preview(voice,assignment,{text:pronunciationSample(entry,testSpelling||undefined),entries:normalizePronunciations({[entry.name]:entry})})}));test.disabled=!settings.enabled || !chatId;
    const save=button('Save pronunciation',()=>safe(async()=>{
      const entry=candidate(),r=await rpc('save_pronunciation',{chatId,entry});
      if(disposed || ctx.getActiveChat().chatId!==chatId)return;
      pronunciationEntries=normalizePronunciations(r.entries);pronunciationChatId=chatId!;renderPronunciations();renderAssignments();notice(`Pronunciation saved for ${entry.name}. Existing audio was not regenerated.`);
    }),true);save.disabled=!chatId;
    const actions=el('div','','ra-row');actions.append(test,save);
    if(saved)actions.append(button('Remove pronunciation',()=>safe(async()=>{
      if(ctx.getActiveChat().chatId!==chatId)return;
      const r=await rpc('remove_pronunciation',{chatId,name:saved.name});
      if(disposed || ctx.getActiveChat().chatId!==chatId)return;
      pronunciationEntries=normalizePronunciations(r.entries);openPronunciations.delete(saved.name);renderPronunciations();renderAssignments();notice(`Pronunciation removed for ${saved.name}. Existing audio was not regenerated.`);
    })));
    container.append(actions,el('p','Alternatives use the same pronunciation. Choose one spelling or test them all in one preview. Saving changes future speech only. Test pronunciation uses one short speech request and may incur a provider charge.','ra-muted'));
  }
  function renderPronunciations(){
    pronunciationsCard.replaceChildren(el('h3','Story pronunciations'));
    pronunciationsCard.append(toggle('Automatically remember new character pronunciations',settings.promptPronunciations,v=>{settings.promptPronunciations=v;void safe(saveSettings)}),el('p','Readalong asks your existing chat model for a hidden cue when it introduces a new name. The first choice is saved for this chat; your corrections take priority. No preset edit or second LLM is needed. Names and reading markers keep their original spelling.','ra-muted'));
    if(!ctx.getActiveChat().chatId){pronunciationsCard.append(el('p','Open a story to manage its pronunciations.','ra-muted'));return}
    const entries=pronunciationChatId===ctx.getActiveChat().chatId?Object.values(pronunciationEntries):[];
    pronunciationsCard.append(el('p',`${entries.length} saved pronunciations for this story. Existing recordings change only if you explicitly prepare them again; speech charges may apply.`,'ra-muted'));
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      const row=el('details','','ra-cast-entry');row.open=openPronunciations.has(entry.name);row.dataset.pronunciationName=entry.name;
      row.append(el('summary',`${entry.name} → ${entry.spokenAs} · ${entry.source==='manual'?'Your correction':'Automatic'}`));
      row.addEventListener('toggle',()=>{if(row.isConnected){if(row.open)openPronunciations.add(entry.name);else openPronunciations.delete(entry.name)}});
      const names=[entry.name,...entry.aliases].map(n=>n.toLowerCase());
      const character=characters.find(c=>names.includes(c.name.split('||')[0].trim().toLowerCase())),assigned=names.map(n=>settings.assignments[`name:${n}`]).find(Boolean)??(character?settings.assignments[`id:${character.id}`]:undefined);
      pronunciationForm(row,entry.name,assigned?.voice||settings.voice,assigned,entry);pronunciationsCard.append(row);
    }
    const add=el('details');add.append(el('summary','Add or correct a name'));pronunciationForm(add,'');pronunciationsCard.append(add);
  }
  function renderAssignments() {
    assignmentsCard.replaceChildren(el('h3','Character voices'),el('p','Build a cast with a separate voice for each character or speaker. Readalong voices override inherited Lumiverse voices; choose compatible voices again after changing provider or model.','ra-muted'));
    const keys=new Set([...Object.keys(settings.assignments).filter(key=>/^(id|name):/.test(key)),...castDrafts.keys()]);
    if(!keys.size && !castInitialized){const id=ctx.getActiveChat().characterId??characters[0]?.id;if(id && characters.some(c=>c.id===id)){const key=`id:${id}`;castDrafts.set(key,{voice:'',emotion:'neutral',delivery:'normal'});keys.add(key)}}
    if(!castInitialized && keys.size){openCast.add([...keys][0]);castInitialized=true}
    assignmentsCard.append(el('p',`${Object.keys(settings.assignments).filter(key=>/^(id|name):/.test(key)).length} saved cast voices. Add more below. Each row opens independently.`,'ra-muted'));
    for(const key of keys){
      if(!castDrafts.has(key))castDrafts.set(key,{...settings.assignments[key]});
      const draft=castDrafts.get(key)!,name=key.startsWith('id:')?characters.find(c=>c.id===key.slice(3))?.name??`Character ${key.slice(3)}`:draft.name??key.slice(5);
      const entry=el('details','', 'ra-cast-entry');entry.open=openCast.has(key);entry.dataset.castKey=key;
      entry.append(el('summary',`${name} · ${settings.assignments[key]?.voice||'Uses defaults'}${!settings.assignments[key]?' · not saved':''}`));
      entry.addEventListener('toggle',()=>{if(entry.isConnected){if(entry.open)openCast.add(key);else openCast.delete(key)}});
      const form=el('div','', 'ra-cast-form');entry.append(form);assignmentsCard.append(entry);
      assignmentForm(key,name,form,{draft,onSaved:()=>{castDrafts.delete(key);renderAssignments()},onRemove:async()=>{delete settings.assignments[key];castDrafts.delete(key);openCast.delete(key);await saveSettings();renderAssignments()}});
    }
    function addMember(key:string,name?:string){
      if(!keys.has(key) && keys.size>=500){notice('The cast can contain up to 500 voice assignments.',true);return}
      if(!castDrafts.has(key))castDrafts.set(key,{...(settings.assignments[key]??{voice:'',emotion:'neutral',delivery:'normal'}),...(name?{name}:{})});
      openCast.add(key);castInitialized=true;renderAssignments();
    }
    const add=el('details');add.append(el('summary','Add cast member'));
    let characterId=characters.find(c=>c.id===ctx.getActiveChat().characterId)?.id??characters[0]?.id??'';
    if(characters.length)add.append(field('Character from your library',select(characters.map(c=>({value:c.id,label:c.name})),characterId,v=>characterId=v)),button('Add character voice',()=>{if(characterId)addMember(`id:${characterId}`)}));
    add.append(button('Refresh characters',()=>safe(async()=>{const r=await rpc('characters');characters=r.characters;renderAssignments();})));
    let speaker='';const speakerInput=textInput('',v=>speaker=v);speakerInput.placeholder='For example, Jason';speakerInput.maxLength=80;
    add.append(field('Speaker name in the story',speakerInput),button('Add speaker voice',()=>{
      const name=speaker.trim();if(!name || /[\[\]\r\n]/.test(name) || name.toLowerCase()==='narrator'){notice('Enter a speaker name of up to 80 characters. Narrator has its own voice setting.',true);return}
      addMember(`name:${name.toLowerCase()}`,name);
    }),el('p','Speakers do not need a character card. For several people in one reply, use cues such as [speaker:Jason] inside their quotes. The existing chat model can add these when voice cues are enabled; no extra LLM is called.','ra-muted'));
    assignmentsCard.append(add);renderPronunciations();
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
    completionInbox.reset();localGenerations.clear();completionRecovery=null;
    pronunciationEpoch++;pronunciationEntries={};pronunciationChatId='';openPronunciations.clear();renderPronunciations();renderAssignments();
    stop(false); messages=[]; selectedId='';automaticPreparations.clear();
    for (const handle of bubbleHandles.values()) ctx.dom.uninject(handle);
    bubbleHandles.clear(); notice(settings.enabled?'Looking for saved audio…':'Readalong is off.'); void safe(async()=>{await refreshPronunciations();await refreshMessages();await prepareLatest(false,true)});
  });
  for(const event of ['MESSAGE_EDITED','MESSAGE_SWIPED','SWIPE_EDITED','MESSAGE_DELETED'])onEvent(event,p=>{
    const id=p?.message?.id??p?.messageId;if(currentMessage?.id===id)stop();
    if(event==='MESSAGE_DELETED' && bubbleHandles.has(id)){ctx.dom.uninject(bubbleHandles.get(id)!);bubbleHandles.delete(id)}
    void safe(refreshMessages);
  });
  onEvent('GENERATION_STARTED',p=>{
    if(p?.chatId!==ctx.getActiveChat().chatId)return;
    if(typeof p.generationId==='string'){localGenerations.set(p.generationId,{chatId:p.chatId,name:p.characterName,characterId:p.characterId,eligible:initialized?settings.enabled:undefined});while(localGenerations.size>20)localGenerations.delete(localGenerations.keys().next().value!)}
    if(currentMessage)stop(false);
  });
  onEvent('GENERATION_ENDED',p=>{
    const info=localGenerations.get(p?.generationId);localGenerations.delete(p?.generationId);
    if(p?.chatId!==ctx.getActiveChat().chatId || !p.messageId || p.error || ['impersonate','quiet'].includes(p.generationType) || info?.eligible===false)return;
    void safe(async()=>{
      if(!info){await recoverCompletion();return}
      const since=completionInbox.since;
      const message=p.content?{id:p.messageId,content:p.content,name:info.name??'',characterId:info.characterId,isUser:false}:(await rpc('message',{chatId:p.chatId,messageId:p.messageId,latestOnly:true})).message;
      if(!message || completionInbox.since!==since)return;
      await receiveCompletion({chatId:p.chatId,messageId:p.messageId,generationId:p.generationId,completedAt:Date.now(),message});
    });
  });
  onEvent('GENERATION_STOPPED',p=>{localGenerations.delete(p?.generationId);if(p?.chatId===ctx.getActiveChat().chatId && currentMessage)stop()});
  onEvent('CONNECTED',()=>{void safe(recoverCompletion)});
  onEvent('CHARACTER_MESSAGE_RENDERED',()=>decorateMessages());
  cleanups.push(tab.onActivate(()=>{void safe(async()=>{await refreshPronunciations();await refreshMessages();await recoverCompletion()})}));
  const onReturn=()=>{if(document.visibilityState==='visible')void safe(recoverCompletion)};
  document.addEventListener('visibilitychange',onReturn);window.addEventListener('focus',onReturn);
  cleanups.push(()=>{document.removeEventListener('visibilitychange',onReturn);window.removeEventListener('focus',onReturn)});
  const recoveryTimer=setInterval(()=>{void safe(recoverCompletion)},15000);cleanups.push(()=>clearInterval(recoveryTimer));
  const action=ctx.ui.registerInputBarAction({id:'readalong',label:'Readalong',subtitle:'Listen and find your place'});cleanups.push(action.onClick(()=>{tab.activate();void safe(openWidget)}));
  function installEditor() {
    if(editorTab || !permissions.includes('characters'))return;
    editorTab=ctx.ui.registerCharacterEditorTab({id:'readalong-voice',title:'Readalong voice'});editorTab.root.classList.add('ra');editorTab.root.dataset.raUi='true';
    const render=()=>{const state=ctx.ui.characterEditor.getState();if(state.open&&state.characterId)assignmentForm(`id:${state.characterId}`,characters.find(c=>c.id===state.characterId)?.name??'this character',editorTab!.root)};
    cleanups.push(ctx.ui.characterEditor.onChange(render),editorTab.onActivate(render));render();
  }
  if('speechSynthesis' in window){const refresh=()=>{if(settings.provider==='browser'){renderVoices();renderAssignments()}};speechSynthesis.addEventListener('voiceschanged',refresh);cleanups.push(()=>speechSynthesis.removeEventListener('voiceschanged',refresh))}
  renderPlayer();renderConfig();renderVoices();renderAssignments();renderPronunciations();ctx.ready();
  void safe(async()=>{
    const r=await rpc('init');if(disposed)return;settings=normalizeSettings(r.settings);completionInbox.initialize(settings.enabled);cacheUserId=typeof r.userId==='string'?r.userId:'';Object.assign(hasKeys,r.hasKeys??{openrouter:r.hasKey,local:false});permissions=r.permissions;ready=true;
    try {
      nativeConnections=await nativeTts.connections();if(disposed)return;
      const existing=nativeConnections.find(c=>c.provider==='openrouter_tts' && c.model===settings.model) ?? nativeConnections.find(c=>c.provider==='openrouter_tts');
      if(needsPcm(settings) && existing){chooseNative(existing,true);await saveSettings()}
      else if(settings.provider==='lumiverse' && !settings.connectionId && nativeConnections.length){chooseNative(existing??nativeConnections[0]);await saveSettings()}
    } catch { /* Direct/browser modes remain available if native TTS is absent. */ }
    renderPlayer();renderConfig();renderVoices();renderAssignments();renderPronunciations();installEditor();
    if(r.cueStatus)notice(r.cueStatus,true);else notice('Ready. Choose a voice and listen to a sample.');
    if(permissions.includes('characters')){try{const r=await rpc('characters');characters=r.characters;renderAssignments()}catch{}}
    initialized=true;
    if(settings.provider==='lumiverse' || permissions.includes('cors_proxy'))void refreshCatalog().catch(()=>{});
    if(permissions.includes('chat_mutation')){await refreshPronunciations();await refreshMessages();await flushCompletion();if(!currentMessage)await prepareLatest(false,true);await recoverCompletion()}
    if(!settings.enabled)notice('Readalong is off. No speech requests will be started.');
  });
  return()=>{
    stop(false);disposed=true;marker.dispose();audioPlayer.dispose();widgetDragCleanup?.();widget?.destroy();for(const fn of cleanups)fn();editorTab?.destroy();action.destroy();tab.destroy();
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Readalong unloaded.'))}pending.clear();ctx.dom.cleanup();
  };
}
