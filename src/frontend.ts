import type { SpindleFrontendContext, SpindleCharacterEditorTabHandle, SpindleFloatWidgetHandle } from 'lumiverse-spindle-types';
import { DEFAULTS, GEMINI_VOICES, EMOTIONS, DELIVERIES, needsPcm, normalizeSettings, speakerCharacterId, plainText, stripCues, speechRequest, type CharacterInfo, type Settings, type SpeechSegment, type SpeechModel, type MessageInfo, type VoiceAssignment } from './shared';
import { PassageMarker } from './highlight';
import { createNativeTtsClient, nativeSpeechRequest, type NativeConnection } from './native-tts';
import { planSpeech, planMessageSpeech, prepareAll, estimatedSentenceIndex, type SpeechPassage, type VoiceContext } from './playback-plan';
import { PreparedPlayer, prepareClip, type PreparedClip } from './prepared-audio';
import { AudioCache, preparationHash } from './audio-cache';
import {recordingPlan,type RecordingMetadata} from './saved-recording';
import {widgetDimensions as resolveWidgetDimensions,widgetPosition} from './widget-layout';
import {patchPlaybackChildren} from './playback-ui';
import {readingChanged} from './message-update';
import {earlyPlaybackPrefix} from './early-playback';
import {AutomaticPlayback} from './automatic-playback';
import {CompletionInbox,type CompletedReply} from './auto-preparation';
import {normalizePronunciations,pronunciationEntry,pronunciationSample,type Pronunciations,type PronunciationEntry} from './pronunciation';

const STYLE = `
::highlight(lumiverse-readalong){background:rgba(245,190,80,.30);color:inherit;text-decoration:underline;text-decoration-color:#e7b24c;text-decoration-thickness:2px;}
.ra-marker-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483000;}
.ra,.ra-mini,.ra-bubble{--ra-text:var(--lumiverse-text,#e8e6f0);--ra-dim:var(--lumiverse-text-muted,var(--lumiverse-text-dim,#9d99ad));--ra-line:var(--lumiverse-border,#555);--ra-fill:var(--lumiverse-fill,#25252d);--ra-soft:var(--lumiverse-fill-subtle,rgba(127,127,127,.08));--ra-accent:var(--lumiverse-primary,#ac8b4f);--ra-on-accent:var(--lumiverse-on-primary,#fff);--ra-mark:#e7b24c;--ra-serif:"Iowan Old Style",Charter,"Palatino Linotype",Palatino,Georgia,serif;}
.ra{font:inherit;color:var(--ra-text);padding:16px;max-width:760px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;}
.ra *,.ra-mini *{box-sizing:border-box;}
.ra h2{margin:0;font-size:19px;line-height:1.2}.ra h3{margin:0;font-size:14px;line-height:1.3}
.ra p{line-height:1.45;margin:0}.ra .ra-muted{color:var(--ra-dim);font-size:12.5px;}
.ra [hidden]{display:none!important}
.ra .ra-head{display:flex;align-items:center;gap:12px}.ra .ra-head h2{flex:1;min-width:0}
.ra .ra-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ra .ra-end{align-items:flex-end}.ra .ra-push{margin-left:auto}
.ra .ra-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.ra .ra-stack{display:flex;flex-direction:column;gap:12px}
.ra label.ra-field{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;flex:1;min-width:140px;color:var(--ra-dim)}
.ra input:not([type=checkbox]):not([type=range]),.ra select,.ra textarea{font:inherit;font-weight:400;color:var(--ra-text);background:var(--ra-fill);border:1px solid var(--ra-line);border-radius:8px;padding:8px 10px;width:100%;min-width:0;min-height:36px}
.ra input[type=range]{width:100%;margin:0;accent-color:var(--ra-accent);min-height:24px}
.ra button,.ra-mini button,.ra-bubble button{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--ra-line);border-radius:8px;padding:7px 12px;min-height:34px;color:var(--ra-text);background:var(--ra-fill);font:inherit;font-size:13px;line-height:1.2}
.ra button:hover:not(:disabled),.ra-mini button:hover:not(:disabled),.ra-bubble button:hover:not(:disabled){border-color:var(--ra-accent)}
.ra button:disabled,.ra-mini button:disabled,.ra-bubble button:disabled{opacity:.45;cursor:default}
.ra :focus-visible,.ra-mini :focus-visible,.ra-bubble :focus-visible{outline:2px solid var(--ra-accent);outline-offset:2px}
.ra button.ra-primary,.ra-mini button.ra-primary{background:var(--ra-accent);color:var(--ra-on-accent);border-color:transparent;font-weight:600}
.ra button.ra-quiet,.ra-mini button.ra-quiet{background:transparent;border-color:transparent;color:var(--ra-dim)}
.ra button.ra-quiet:hover:not(:disabled),.ra-mini button.ra-quiet:hover:not(:disabled){background:var(--ra-soft);color:var(--ra-text);border-color:transparent}
.ra button.ra-icon,.ra-mini button.ra-icon{width:34px;height:34px;min-height:0;padding:0;flex-shrink:0}
.ra button.ra-play,.ra-mini button.ra-play{width:44px;height:44px;min-height:0;padding:0;border-radius:50%;flex-shrink:0}
.ra-ico{width:18px;height:18px;fill:currentColor;flex-shrink:0}.ra-play .ra-ico{width:22px;height:22px}
.ra-spin{width:18px;height:18px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:ra-spin .8s linear infinite}
@keyframes ra-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ra-spin{animation-duration:2.4s}}
.ra .ra-toggle{display:flex;gap:10px;align-items:flex-start;font-size:13px;cursor:pointer}
.ra .ra-toggle>span{display:flex;flex-direction:column;gap:2px;line-height:1.35}.ra .ra-toggle small{color:var(--ra-dim);font-size:12px}
.ra input[type=checkbox]{appearance:none;-webkit-appearance:none;flex-shrink:0;width:34px;height:20px;margin:0;border-radius:10px;background:var(--ra-line);position:relative;cursor:pointer;transition:background .15s}
.ra input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.ra input[type=checkbox]:checked{background:var(--ra-accent)}.ra input[type=checkbox]:checked::after{transform:translateX(14px)}
.ra .ra-power-switch input{width:44px;height:26px;border-radius:13px}.ra .ra-power-switch input::after{width:22px;height:22px}.ra .ra-power-switch input:checked::after{transform:translateX(18px)}
.ra .ra-power-switch{align-items:center;font-weight:600}
.ra .ra-stage{border:1px solid var(--ra-line);background:var(--ra-soft);border-radius:14px;overflow:hidden}
.ra .ra-now{padding:14px;display:flex;flex-direction:column;gap:12px}
.ra .ra-meta{display:flex;align-items:baseline;gap:8px;font-size:12.5px;color:var(--ra-dim)}.ra .ra-meta strong{color:var(--ra-text);font-size:14px;overflow-wrap:anywhere}.ra .ra-meta .ra-push{white-space:nowrap}
.ra .ra-passage,.ra-mini .ra-reading{font-family:var(--ra-serif)}
.ra .ra-passage{margin:0;padding:2px 0 2px 12px;border-left:3px solid var(--ra-mark);line-height:1.55;font-size:16px;overflow-wrap:anywhere}
.ra .ra-seek,.ra-mini .ra-seek{display:flex;align-items:center;gap:10px}
.ra progress,.ra-mini progress{flex:1;width:100%;height:4px;border:0;border-radius:2px;overflow:hidden;background:var(--ra-line);appearance:none;-webkit-appearance:none}
.ra progress::-webkit-progress-bar,.ra-mini progress::-webkit-progress-bar{background:var(--ra-line)}
.ra progress::-webkit-progress-value,.ra-mini progress::-webkit-progress-value{background:var(--ra-mark)}
.ra progress::-moz-progress-bar,.ra-mini progress::-moz-progress-bar{background:var(--ra-mark)}
.ra .ra-time,.ra-mini .ra-time{font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--ra-dim)}
.ra .ra-status{display:flex;gap:8px;align-items:baseline;padding:9px 14px;border-top:1px solid var(--ra-line);font-size:12.5px;line-height:1.4;min-height:36px;color:var(--ra-dim)}
.ra .ra-status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ra-line);flex-shrink:0;transform:translateY(-1px)}
.ra[data-ra-phase=playing] .ra-status::before,.ra[data-ra-phase=ready] .ra-status::before,.ra[data-ra-phase=paused] .ra-status::before,.ra[data-ra-phase=finished] .ra-status::before{background:var(--ra-mark)}
.ra[data-ra-phase=preparing] .ra-status::before{background:var(--ra-accent)}
.ra .ra-status.ra-error{color:#e99087}.ra .ra-status.ra-error::before{background:#e99087}
.ra .ra-tabs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;border-radius:10px;background:var(--ra-soft);border:1px solid var(--ra-line)}
.ra .ra-tabs button{border:0;background:transparent;color:var(--ra-dim);padding:6px 4px;min-height:32px;border-radius:7px;min-width:0}
.ra .ra-tabs button[aria-selected=true]{background:var(--ra-fill);color:var(--ra-text);font-weight:600;box-shadow:0 0 0 1px var(--ra-line)}
.ra .ra-panel{display:flex;flex-direction:column;gap:14px}
.ra .ra-panel>h3{margin-top:4px}.ra .ra-rule{border:0;border-top:1px solid var(--ra-line);margin:2px 0;width:100%}
.ra .ra-voice-list{display:flex;gap:6px;flex-wrap:wrap;max-height:220px;overflow:auto;padding:2px}
.ra .ra-voice-list button{padding:5px 10px;min-height:30px;font-size:12.5px;border-radius:15px}
.ra .ra-voice-list button[aria-pressed=true]{border-color:var(--ra-mark);background:rgba(231,178,76,.14)}
.ra details{border:1px solid var(--ra-line);border-radius:10px;background:var(--ra-soft)}
.ra details>summary{cursor:pointer;font-size:13px;padding:10px 12px;display:flex;gap:8px;align-items:baseline;list-style:none}
.ra details>summary::-webkit-details-marker{display:none}
.ra details>summary::after{content:"";margin-left:auto;align-self:center;width:7px;height:7px;border-right:2px solid var(--ra-dim);border-bottom:2px solid var(--ra-dim);transform:rotate(-45deg);transition:transform .15s;flex-shrink:0}
.ra details[open]>summary::after{transform:rotate(45deg)}
.ra details>summary strong{overflow-wrap:anywhere}.ra details>summary span{color:var(--ra-dim);font-size:12.5px}
.ra details>.ra-body{padding:2px 12px 12px;display:flex;flex-direction:column;gap:12px}
.ra .ra-fix{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--ra-line);border-left:3px solid var(--ra-mark);border-radius:10px;background:var(--ra-soft)}
.ra button.ra-next{align-self:flex-end}
.ra details details{background:transparent;border-style:dashed}.ra details details>summary{padding:8px 10px}
.ra .ra-badge{font-size:11px;padding:1px 7px;border-radius:9px;border:1px solid var(--ra-mark);color:var(--ra-mark)!important}
.ra-bubble{display:flex;padding:4px 0 0}
.ra-bubble button{padding:3px 9px 3px 6px;min-height:26px;font-size:12px;border-radius:13px;background:transparent;color:var(--ra-dim);border-color:transparent}
.ra-bubble button:hover:not(:disabled){color:var(--ra-text);border-color:var(--ra-line)}.ra-bubble .ra-ico{width:15px;height:15px}
.ra-mini{box-sizing:border-box;font:13px/1.35 system-ui,sans-serif;color:var(--ra-text);padding:12px;background:var(--lumiverse-bg,#202026);height:100%;display:flex;flex-direction:column;gap:9px}
.ra-mini .ra-row{display:flex;gap:6px;align-items:center}.ra-mini .ra-push{margin-left:auto}
.ra-mini .ra-widget-top{align-items:flex-start;gap:10px}
.ra-mini .ra-widget-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding-top:1px}
.ra-mini .ra-who{display:flex;gap:6px;align-items:baseline;min-width:0}.ra-mini .ra-who strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ra-mini .ra-who span{color:var(--ra-dim);font-size:12px;white-space:nowrap}
.ra-mini .ra-caption{margin:0;color:var(--ra-dim);font-size:12.5px;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.ra-mini .ra-caption.ra-reading{color:var(--ra-text);font-size:14px}
.ra-mini .ra-widget-tools{gap:2px;margin:-4px -6px 0 0}.ra-mini button.ra-icon{width:28px;height:28px}
.ra-mini .ra-widget-foot{margin-top:auto}.ra-mini .ra-widget-foot button{min-height:28px;padding:4px 9px;font-size:12px}
.ra-mini button[aria-pressed=true] .ra-ico{color:var(--ra-mark)}
.ra-mini.ra-collapsed{position:relative;padding:8px 8px 11px;flex-direction:row;align-items:center;gap:6px}
.ra-collapsed button.ra-play{width:36px;height:36px}
.ra-collapsed .ra-compact-info{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.ra-collapsed .ra-compact-info strong{font-size:12px}.ra-collapsed .ra-compact-status{font-size:11px;color:var(--ra-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-collapsed progress{position:absolute;bottom:4px;left:8px;width:calc(100% - 16px);height:3px;pointer-events:none}
.ra-mini.ra-touch button{min-width:44px;min-height:44px;touch-action:manipulation}.ra-mini.ra-touch button.ra-icon,.ra-mini.ra-touch button.ra-play{width:44px;height:44px}
.ra-mini.ra-touch .ra-widget-tools{margin:0}
.ra-mini.ra-collapsed.ra-narrow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.ra-collapsed.ra-narrow .ra-compact-info{display:none}.ra-mini.ra-collapsed.ra-narrow button{width:100%;min-width:0;min-height:44px;border-radius:8px}
`;
/** Readalong's own symbol for the sidebar tab and input bar: lines of text with a play pointer on the current one. */
const TAB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M12 12h8M9 18h9"/><path d="M3 9.2l5.2 2.8L3 14.8z" fill="currentColor"/></svg>`;
const ICONS = {
  play:'M8 5v14l11-7z', pause:'M6 5h4v14H6zM14 5h4v14h-4z', stop:'M6 6h12v12H6z',
  replay:'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  close:'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  minimize:'M19 13H5v-2h14v2z', expand:'M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z',
  power:'M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z',
  speaker:'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  refresh:'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  float:'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
  tune:'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
} as const;
type IconName = keyof typeof ICONS;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node }
function icon(name: IconName) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','ra-ico');path.setAttribute('d',ICONS[name]);svg.append(path);return svg;
}
function button(text: string, action: () => void | Promise<void>, primary = false) { const b = el('button',text,primary ? 'ra-primary' : ''); b.type = 'button';b.dataset.raControl=text; b.onclick = () => { void action() }; return b }
/** An icon-only button. The label is its accessible name, tooltip and patch identity. */
function iconButton(name: IconName, label: string, action: () => void | Promise<void>, className = 'ra-icon ra-quiet') { const b = button('',action); b.className=className;b.dataset.raControl=label;b.setAttribute('aria-label',label);b.title=label;b.append(icon(name)); return b }
function withIcon(b: HTMLButtonElement, name: IconName) { b.prepend(icon(name)); return b }
function field(label: string, input: HTMLElement) { const l = el('label','', 'ra-field'); input.setAttribute('aria-label',label); l.append(el('span',label), input); return l }
function select(options: {value:string;label:string}[], value: string, change: (v: string) => void) { const s = el('select'); for (const o of options) { const option = el('option',o.label); option.value = o.value; s.append(option) }; s.value = value; s.onchange = e => change((e.currentTarget as HTMLSelectElement).value); return s }
function textInput(value: string, onInput: (value: string) => void, type = 'text') { const i = el('input'); i.type = type; i.value = value; i.oninput = () => onInput(i.value); return i }
function toggle(label: string, value: boolean, change: (v: boolean) => void, hint = '') { const row = el('label','', 'ra-toggle'), i = el('input'), text = el('span'); i.type = 'checkbox'; i.setAttribute('role','switch'); i.checked = value; i.onchange = e => change((e.currentTarget as HTMLInputElement).checked); text.append(el('span',label)); if (hint) text.append(el('small',hint)); row.append(i,text); return row }
function disclosure(summary: (Node|string)[], open = false) { const d = el('details'), s = el('summary'), body = el('div','', 'ra-body'); s.append(...summary); d.open = open; d.append(s,body); return {details:d,body} }
function speakerLabel(speaker: string | undefined, fallback: string) { return !speaker ? fallback : speaker.toLowerCase()==='narrator' ? 'Narrator' : speaker }
function timeLabel(seconds:number){const value=Math.floor(seconds);return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}

export function setup(ctx: SpindleFrontendContext) {
  let settings = normalizeSettings(DEFAULTS), ready = false, initialized = false, disposed = false;
  const hasKeys={openrouter:false,local:false},frontendId=crypto.randomUUID();
  const castDrafts=new Map<string,VoiceAssignment>(),openCast=new Set<string>();let castInitialized=false,addOpen=false,voiceQuery='',fixName='',fixSay='',viewChosen=false;
  const addedCast=new Set<string>(),addedNames=new Map<string,string>(),sayDrafts=new Map<string,{spokenAs:string;aliases:string}>(),moreOpen=new Set<string>(),testPick=new Map<string,string>();
  const validSpeaker=(name:string)=>!!name && name.length<=80 && !/[\[\]\r\n]/.test(name) && name.toLowerCase()!=='narrator';
  let canDiagnoseSpeech = false, diagnosing = false, diagnoseButton: HTMLButtonElement | null = null;
  let diagnoseHint: HTMLElement | null = null;
  let models: SpeechModel[] = [{ id:DEFAULTS.model, name:'Google: Gemini 3.8 Flash TTS', voices:GEMINI_VOICES }];
  const nativeTts=createNativeTtsClient(), nativeRequests=new Set<AbortController>();
  let nativeConnections:NativeConnection[]=[], catalogEpoch=0;
  let characters: CharacterInfo[] = [], permissions: string[] = [];
  let messages: MessageInfo[] = [], selectedId = '';
  let pronunciationEntries:Pronunciations={},pronunciationChatId='',pronunciationEpoch=0;
  let playbackId = 0, playing = false, paused = false, currentMessage: MessageInfo | null = null;
  let phase:'idle'|'preparing'|'ready'|'playing'|'paused'|'finished'='idle';
  let checkingSavedAudio=false;
  let preparingAudio=false,waitingForAudio=false;
  let incompleteAudio=false,retryPreparation:(()=>Promise<void>)|null=null;
  let retainedParts:{userId:string;key:string;clips:(PreparedClip|undefined)[];saved:boolean;recording:RecordingMetadata}|null=null;
  let previousRecording=false;
  let playAttempt:object|null=null,messageLoad:object|null=null;
  const automaticPlayback=new AutomaticPlayback();let automaticPlaybackError='';
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
  const widgetPermissionHint='To use the floating player, allow “UI panels” for Readalong in Lumiverse’s extension settings. You can still play and pause here.';
  let currentSegments: SpeechSegment[] = [], position = 0, markedPosition=-1;
  let playbackSettler: (() => void) | null = null;
  const pending = new Map<string,{resolve:(data:any)=>void;reject:(err:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const cleanups: (()=>void)[] = [], bubbleHandles = new Map<string,Element>();
  const speechActivity={automatic:0,manual:0,preview:0,diagnostic:0},speechActivityNote=el('p','', 'ra-muted');
  let lastPlaybackAction='None';
  function updateSpeechActivity(){speechActivityNote.textContent=`Speech requests started in this window: ${speechActivity.automatic+speechActivity.manual+speechActivity.preview+speechActivity.diagnostic}. Automatic preparation: ${speechActivity.automatic}; manual preparation: ${speechActivity.manual}; samples: ${speechActivity.preview}; diagnostics: ${speechActivity.diagnostic}. Last control: ${lastPlaybackAction}. Loading and playing saved audio do not start speech requests. This is a request count, not a bill.`}
  updateSpeechActivity();
  // Capture the Send click/Enter gesture before the asynchronous reply arrives.
  // A reserve is used if old audio is loaded, so priming never starts that story.
  const primeAutomaticAudio=()=>{if(!disposed && settings.enabled && settings.automaticPlayback && settings.provider!=='browser')audioPlayer.unlock()};
  for(const event of ['pointerdown','keydown','touchstart','click'] as const){
    document.addEventListener(event,primeAutomaticAudio,{capture:true,passive:true});
    cleanups.push(()=>document.removeEventListener(event,primeAutomaticAudio,true));
  }
  let editorTab: SpindleCharacterEditorTabHandle | null = null;
  const tab = ctx.ui.registerDrawerTab({ id:'readalong', title:'Readalong', shortName:'Read', description:'Listen to passages, assign character voices, and follow the spoken text', keywords:['tts','voice','speech','audio'], iconSvg:TAB_ICON });
  const root = tab.root; root.classList.add('ra'); root.dataset.raUi = 'true';
  cleanups.push(ctx.dom.addStyle(STYLE));
  const heading = el('h2','Readalong'), head = el('div','', 'ra-head');
  const powerSwitch = toggle('Off',false,v=>{void safe(()=>setEnabled(v))});powerSwitch.classList.add('ra-power-switch');
  const powerInput = powerSwitch.querySelector('input')!, powerLabel = powerSwitch.querySelector('span span')!;powerInput.setAttribute('aria-label','Readalong on');
  head.append(heading,powerSwitch);
  const intro = el('p','','ra-muted');
  const status = el('p','Loading…','ra-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const stage = el('div','', 'ra-stage'), player = el('section','', 'ra-now');stage.append(player,status);
  const options = el('section','', 'ra-panel'), config = el('section','', 'ra-panel'), voicesCard = el('section','', 'ra-panel'), assignmentsCard = el('section','', 'ra-panel');
  const VIEWS = [['connection','Connection',config],['voices','Voices',voicesCard],['cast','Cast',assignmentsCard],['options','Playback',options]] as const;
  type View = typeof VIEWS[number][0];
  let view: View = 'cast';
  const tabs = el('div','', 'ra-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Readalong settings');
  function showView(next: View, focus = false) {
    view = next;
    for (const [id,,panel] of VIEWS) {
      const selected = id === view, tabButton = tabs.querySelector<HTMLButtonElement>(`[data-ra-view="${id}"]`)!;
      panel.hidden = !selected;tabButton.setAttribute('aria-selected',String(selected));tabButton.tabIndex = selected ? 0 : -1;
      if (selected && focus) tabButton.focus();
    }
  }
  VIEWS.forEach(([id,label,panel],index) => {
    const tabButton = button(label,()=>{viewChosen=true;showView(id)});
    tabButton.dataset.raView=id;tabButton.id=`ra-tab-${id}`;tabButton.setAttribute('role','tab');
    tabButton.onkeydown = e => { const step = e.key==='ArrowRight' ? 1 : e.key==='ArrowLeft' ? -1 : 0; if (step) { e.preventDefault(); showView(VIEWS[(index+step+VIEWS.length)%VIEWS.length][0],true) } };
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tabButton.id);tabs.append(tabButton);
  });
  root.append(head,intro,stage,tabs,options,voicesCard,assignmentsCard,config);showView(view);
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
    return select([...(inherited ? [{value:'',label:'Main voice'}] : []), ...names.map(name=>({value:name,label:name}))],value,change);
  }
  function contentRoot(messageId: string) {
    const bubble = ctx.dom.findMessageElement(messageId);
    // Current host content anchor. If it changes, keep the passage visible in our player.
    return bubble?.querySelector('[data-component="MessageContent"]') ?? bubble;
  }
  function stopClock() { if(clockTimer)clearInterval(clockTimer);clockTimer=null }
  function stop(showStatus = true) {
    automaticPlayback.cancel();automaticPlaybackError='';
    playbackId++; playing = false; paused = false; phase='idle';checkingSavedAudio=false;preparingAudio=false;waitingForAudio=false;incompleteAudio=false;retryPreparation=null;playAttempt=null;messageLoad=null;stopClock();
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
  /** One description of the main transport button, shared by the drawer and the widget. */
  function playState() {
    const label=!settings.enabled?'Off':playAttempt?'Starting…':messageLoad?'Loading…':phase==='preparing'?(checkingSavedAudio?'Loading…':'Preparing…'):phase==='idle'?'Load saved':phase==='paused'?'Resume':phase==='playing'?'Pause':phase==='finished'?'Replay':'Play';
    const busy=settings.enabled && (!!playAttempt || !!messageLoad || phase==='preparing');
    const glyph:IconName=!settings.enabled?'power':phase==='playing'?'pause':phase==='finished'?'replay':'play';
    return {label,busy,glyph};
  }
  function playButton(action:()=>void|Promise<void>) {
    const {label,busy,glyph}=playState(),play=button('',action,true);
    play.classList.add('ra-play');play.dataset.raControl='play';play.setAttribute('aria-label',label);play.title=label;
    play.append(busy?el('span','', 'ra-spin'):icon(glyph));return play;
  }
  function renderWidget() {
    if(!widget || disposed)return;
    const {width,height}=widgetDimensions(),size=`${width}:${height}`;
    // Resize the host container as well as our content, preserving its drag position.
    if(widgetSize!==size){widget.setSize(width,height);widgetSize=size}
    widget.root.classList.toggle('ra-collapsed',settings.widgetMinimized);
    widget.root.classList.toggle('ra-touch',widgetTouch());widget.root.classList.toggle('ra-narrow',widgetDimensions().narrow);
    const {label:playLabel}=playState(),speaking=phase==='playing' || phase==='paused',hasTime=!!audioPlayer.duration;
    const play=playButton(()=>safe(playOrPause));
    play.disabled=!ready || !settings.enabled || !!playAttempt || !!messageLoad || phase==='preparing' || phase==='idle' && !selectedId || incompleteAudio && !audioPlayer.duration;
    const close=iconButton('close','Hide floating player',()=>widget?.setVisible(false));
    const resize=iconButton(settings.widgetMinimized?'expand':'minimize',settings.widgetMinimized?'Expand floating player':'Minimize floating player',()=>safe(()=>setWidgetMinimized(!settings.widgetMinimized)));
    resize.dataset.raControl='resize';resize.setAttribute('aria-expanded',String(!settings.widgetMinimized));
    const power=iconButton('power',settings.enabled?'Turn Readalong off':'Turn Readalong on',()=>safe(()=>setEnabled(!settings.enabled)));
    power.dataset.raControl='power';power.setAttribute('aria-pressed',String(settings.enabled));
    const progress=el('progress');progress.max=1;progress.value=preparingAudio?preparedCount/Math.max(1,currentPassages.length):phase==='finished'?1:phase==='ready'?0:hasTime?audioPlayer.elapsed/audioPlayer.duration:position/Math.max(1,currentSegments.length);progress.setAttribute('aria-label',preparingAudio?'Speech preparation':'Playback progress');
    const clock=`${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`;
    if(settings.widgetMinimized){
      const info=el('div','', 'ra-compact-info');info.append(el('strong',speaking?speakerLabel(currentSegments[position]?.speaker,'Readalong'):'Readalong'));
      const timed=hasTime && settings.enabled && ['playing','paused','ready','finished'].includes(phase);
      const detail=el('span',!settings.enabled?'Off':timed?clock:playLabel,timed?'ra-compact-status ra-time':'ra-compact-status');
      detail.title=status.textContent??'';info.append(detail);
      patchPlaybackChildren(widget.root,play,info,power,resize,close,progress);
    }else{
      const top=el('div','', 'ra-row ra-widget-top'),text=el('div','', 'ra-widget-text'),who=el('div','', 'ra-who');
      who.append(el('strong',speaking?speakerLabel(currentSegments[position]?.speaker,'Voice'):'Readalong'));
      if(speaking && currentPassages[currentPassage]?.voice)who.append(el('span',currentPassages[currentPassage].voice));
      // While reading, show the sentence itself. Otherwise the status says what to do next.
      const caption=el('p',speaking?plainText(currentSegments[position]?.text ?? ''):status.textContent || 'Choose a message.',speaking?'ra-caption ra-reading':'ra-caption');
      caption.title=caption.textContent ?? '';text.append(who,caption);
      const tools=el('div','', 'ra-row ra-widget-tools');tools.append(resize,close);top.append(play,text,tools);
      const seek=el('div','', 'ra-seek');seek.append(progress,el('span',hasTime?clock:'','ra-time'));
      const foot=el('div','', 'ra-row ra-widget-foot'),stopButton=withIcon(button('Stop',()=>stop()),'stop');stopButton.disabled=phase==='idle';
      const retry=!!retryPreparation && (incompleteAudio || preparingAudio && preparedCount>0);
      const fix=retry?button('Retry missing audio',()=>safe(async()=>{await retryPreparation?.()})):button('Fix a name',()=>fixAName());fix.title=retry?'Requests only missing parts; your speech service may charge.':'Change how a name is said';if(retry)fix.disabled=preparingAudio;
      const open=iconButton('tune','Open Readalong',()=>tab.activate());
      power.classList.add('ra-push');foot.append(stopButton,fix,power,open);
      patchPlaybackChildren(widget.root,top,seek,foot);
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
    for(const time of [widget?.root.querySelector('.ra-time'),player.querySelector('.ra-time')])if(time)time.textContent=`${timeLabel(at.elapsed)} / ${timeLabel(at.duration)}`;
  }
  function finished() {
    playing=false;paused=false;phase='finished';stopClock();
    if(currentPassages.length)markSentence(currentPassages.length-1,currentPassages.at(-1)!.segments.length-1);
    notice(currentPassages[0]?.settings.provider==='browser'?'Finished. Replay reads this passage again.':'Finished. Replay is free.');renderPlayer();
  }
  audioPlayer.onEnded=finished;
  audioPlayer.onError=error=>{paused=true;playing=false;phase='paused';stopClock();notice(error.message,true);renderPlayer()};
  audioPlayer.onWaiting=waiting=>{
    waitingForAudio=waiting;
    if(waiting && incompleteAudio){audioPlayer.pause();paused=true;playing=false;phase='paused';stopClock();notice('Reached the missing audio. Retry missing audio to continue; your speech service may charge.',true)}
    else if(phase==='playing')notice(waiting?'Waiting for the rest of the audio…':'Reading…');
    renderPlayer();
  };
  function tryAutomaticPlayback() {
    if(!automaticPlayback.take({enabled:settings.enabled,automatic:settings.automaticPlayback,ready:phase==='ready',busy:!!playAttempt || !!messageLoad}))return;
    const token=playbackId;
    void playOrPause(true).catch(error=>{
      if(disposed || token!==playbackId)return;
      automaticPlaybackError=error instanceof Error?error.message:'Automatic playback could not start. Press Play to use the prepared audio.';
      notice(automaticPlaybackError,true);renderPlayer();
    });
  }
  function preparationNotice(text:string){notice(automaticPlaybackError || text,!!automaticPlaybackError)}
  async function playOrPause(automatic=false) {
    lastPlaybackAction=automatic?'Automatic playback':phase==='idle'?'Load saved':playState().label;updateSpeechActivity();
    // Any manual playback action owns this reading from now on. Preparation
    // updates must never undo a pause or retry a blocked automatic start.
    if(!automatic){automaticPlayback.cancel();automaticPlaybackError=''}
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
      } catch(e){if(token===playbackId){
        browserQueueActive=false;playing=false;paused=false;phase='ready';stopClock();
        speechSynthesis.cancel();utterance=null;renderPlayer();throw e;
      }}
      return;
    }
    const attempt={};playAttempt=attempt;
    try {
      // Call play synchronously inside the click, before any asynchronous work.
      const pending=audioPlayer.play();notice('Starting playback…');renderPlayer();
      const started=await pending;
      if(token!==playbackId || !started)return;
      playing=true;phase='playing';notice(waitingForAudio?'Waiting for the rest of the audio…':preparingAudio?'Reading… The rest is still on its way.':'Reading…');updateClock();
      stopClock();clockTimer=setInterval(updateClock,100);
    }catch(error){
      if(token!==playbackId)return;
      playing=false;paused=audioPlayer.hasStarted;phase=paused?'paused':'ready';stopClock();
      // Keep the useful local error visible if preparation finishes later.
      automaticPlaybackError=error instanceof Error?error.message:'Playback could not start. Press Play to use the prepared audio.';
      notice(automaticPlaybackError,true);throw error;
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
    const reply=completionInbox.take(chatId);if(reply)await autoPrepareMessage(reply.message,false,false,true);
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
    if(!disposed && epoch===pronunciationEpoch && ctx.getActiveChat().chatId===chatId){pronunciationChatId=chatId;pronunciationEntries=entries;renderAssignments()}
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
  async function prepareSpeech(segment:SpeechSegment, snapshot:Settings, kind:keyof typeof speechActivity, signal?:AbortSignal,recordedConnection?:NativeConnection) {
    signal?.throwIfAborted();
    if(snapshot.provider!=='lumiverse'){speechActivity[kind]++;updateSpeechActivity();return rpc('speech',{segment,previewSettings:snapshot})}
    const connection=recordedConnection??activeNative(snapshot.connectionId);
    if(!connection)throw new Error('Choose a connection first. If the list is empty, add one in Lumiverse’s voice settings.');
    const controller=new AbortController();nativeRequests.add(controller);
    speechActivity[kind]++;updateSpeechActivity();
    try{return await nativeTts.speech(connection,snapshot,segment,undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(300000),...(signal?[signal]:[])]))}
    finally{nativeRequests.delete(controller)}
  }
  async function autoPrepareMessage(message:MessageInfo,force=false,restoreOnly=false,autoStart=false) {
    if(!initialized || !settings.enabled || disposed || message.isUser)return;
    const key=JSON.stringify([ctx.getActiveChat().chatId,message.id,message.content]);
    if(!force && (automaticPreparations.has(key) || currentMessage?.id===message.id && currentMessage.content===message.content))return;
    if(!restoreOnly){automaticPreparations.add(key);if(automaticPreparations.size>20)automaticPreparations.delete(automaticPreparations.values().next().value!)}
    await startMessage(message,{automatic:true,restoreOnly,autoStart});
  }
  async function prepareLatest(force=false,restoreOnly=false) {
    if(!settings.enabled || !initialized)return;
    const latest=messages.at(-1);if(latest)await autoPrepareMessage(latest,force,restoreOnly);
    else notice('Readalong is on. New replies will get audio on their own.');
  }
  async function setEnabled(enabled:boolean) {
    if(settings.enabled===enabled)return;
    lastPlaybackAction=enabled?'Turn on':'Turn off';updateSpeechActivity();
    completionInbox.setEnabled(enabled);knownCompletions.clear();localGenerations.clear();
    settings.enabled=enabled;if(!enabled)stop(false);
    else if(settings.automaticPlayback && settings.provider!=='browser')audioPlayer.unlock();
    renderPlayer();renderVoices();renderAssignments();
    notice(enabled?'Readalong is on. Preparing the latest reply…':'Readalong is off. Nothing is sent to your voice service.');
    await saveSettings();
    if(enabled && settings.enabled){await refreshMessages();await prepareLatest(true)}
  }
  async function setAutomaticPlayback(enabled:boolean) {
    settings.automaticPlayback=enabled;
    // The next completed reply may start automatically. This reading keeps
    // waiting for Play, including when its preparation is still in flight.
    automaticPlayback.cancel();
    if(enabled && settings.enabled && settings.provider!=='browser')audioPlayer.unlock();
    renderOptions();renderPlayer();
    await saveSettings();
  }
  async function startMessage(message: MessageInfo,options:{automatic?:boolean;restoreOnly?:boolean;autoStart?:boolean;updateAudio?:boolean}={}) {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to prepare audio.');
    if(!options.restoreOnly){
      automaticPreparations.add(JSON.stringify([ctx.getActiveChat().chatId,message.id,message.content]));
      if(automaticPreparations.size>20)automaticPreparations.delete(automaticPreparations.values().next().value!);
    }
    stop(false);
    previousRecording=false;
    automaticPlayback.arm(!!options.autoStart && settings.automaticPlayback && !options.restoreOnly);
    const token=playbackId;readingAbort=new AbortController();const signal=readingAbort.signal;
    currentMessage={...message,characterId:message.isUser?undefined:message.characterId ?? speakerCharacterId(message.name,characters,ctx.getActiveChat().characterId ?? undefined)};
    phase='preparing';preparingAudio=true;checkingSavedAudio=true;preparedCount=0;showWidget();notice('Looking for saved audio…');renderPlayer();
    try {
      const snapshot=normalizeSettings(settings);
      const chatId=ctx.getActiveChat().chatId;
      const context:VoiceContext={characters,characterId:currentMessage.characterId,connections:nativeConnections,mainSpeaker:message.name,
        pronunciations:await refreshPronunciations(chatId,options.restoreOnly?undefined:message.id)};
      let rules,hostAutomaticTts=false;
      if(snapshot.provider==='lumiverse') {
        const results=await Promise.allSettled([nativeTts.preferences(),ctx.chats.getActive?.() ?? Promise.resolve(null),nativeTts.connections()]);
        if(results[0].status==='fulfilled'){rules=results[0].value.rules;context.narrationVoice=results[0].value.narrationVoice;hostAutomaticTts=results[0].value.automaticTts}
        if(results[1].status==='fulfilled')context.overrides=results[1].value?.metadata?.voiceOverrides as VoiceContext['overrides'];
        if(results[2].status==='fulfilled' && token===playbackId){nativeConnections=results[2].value;context.connections=nativeConnections;renderConfig()}
      }
      if(token!==playbackId)return;
      currentPassages=planMessageSpeech(message,snapshot,context,rules);currentSegments=currentPassages.flatMap(p=>p.segments);
      if(!currentSegments.length){stop(false);notice('There is no readable text in this message.');return}
      let restored=false,saved=true,openingCount=0;
      if(snapshot.provider!=='browser') {
        const messageKey=await preparationHash([ctx.getActiveChat().chatId,message.id,message.content]);
        const requests=(passages:SpeechPassage[],legacy=false)=>passages.map(p=>{
          const connection=activeNative(p.settings.connectionId);
          if(p.settings.provider==='lumiverse' && connection){const request=nativeSpeechRequest(connection,p.settings,p.segment);if(legacy)delete request.parameters.speech_style;return request}
          return [p.settings.provider,p.settings.localUrl,speechRequest(p.settings,p.segment)];
        });
        const desiredKey=await preparationHash([messageKey,requests(currentPassages)]);
        let audioKey=desiredKey,plan=recordingPlan(currentPassages,nativeConnections);
        let partial:(PreparedClip|undefined)[]|undefined;
        // A message's existing take owns playback until the user explicitly
        // updates it. Style changes can alter both requests and part counts.
        if(retainedParts?.userId===cacheUserId && retainedParts.recording.messageKey===messageKey && (!options.updateAudio || retainedParts.key===desiredKey)){
          audioKey=retainedParts.key;plan=retainedParts.recording.plan;partial=Array.from(retainedParts.clips);saved=retainedParts.saved;
        }else if(!options.updateAudio)try{
          const existing=await audioCache.getRecording(cacheUserId,messageKey);
          if(existing){audioKey=existing.key;plan=existing.plan;partial=existing.clips}
        }catch{/* The server ledger still prevents automatic regeneration. */}
        if(!partial)try{partial=await audioCache.getPartial(cacheUserId,audioKey,plan.passages.length)}catch{/* Storage never authorizes a retry. */}
        if(!partial && !options.updateAudio){
          // Migrate 0.2.10 audio by its original batching and request identity,
          // without replacing a byte or making a speech request.
          const legacy=planMessageSpeech(message,snapshot,{...context,legacyAudio:true},rules);
          if(legacy.length){
            const legacyKey=await preparationHash([messageKey,requests(legacy,true)]);
            try{
              const clips=await audioCache.getPartial(cacheUserId,legacyKey,legacy.length);
              if(clips){
                audioKey=legacyKey;partial=clips;
                plan=recordingPlan(legacy,nativeConnections.map(c=>({...c,speechStyle:''})));
                try{saved=await audioCache.putPartial(cacheUserId,audioKey,clips,{messageKey,plan})}catch{saved=false}
              }
            }catch{/* Losing cache access never authorizes an automatic retry. */}
          }
        }
        if(token!==playbackId)return;
        previousRecording=!!partial && audioKey!==desiredKey;
        currentPassages=plan.passages;currentSegments=currentPassages.flatMap(p=>p.segments);
        if(partial?.length!==currentPassages.length)partial=undefined;
        partial??=Array.from({length:currentPassages.length},()=>undefined);
        const parts=partial,texts=currentPassages.map(p=>plainText(p.segment.text));
        const recording={messageKey,plan},retained={userId:cacheUserId,key:audioKey,clips:parts,saved,recording};retainedParts=retained;
        const prefixCount=()=>{let n=0;while(n<parts.length && parts[n])n++;return n};
        const retainPartial=()=>{
          automaticPlayback.cancel();incompleteAudio=true;preparingAudio=false;checkingSavedAudio=false;
          preparedCount=parts.filter(Boolean).length;
          const prefix=prefixCount();
          if(prefix>openingCount){
            if(openingCount && (audioPlayer.hasStarted || playAttempt))audioPlayer.append(parts.slice(openingCount,prefix) as PreparedClip[],false);
            else audioPlayer.begin(parts.slice(0,prefix) as PreparedClip[]);
            openingCount=prefix;audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);
          }
          if(phase==='preparing')phase='ready';
          renderPlayer();
        };
        const progress=()=>{
          if(token!==playbackId)return;preparedCount=parts.filter(Boolean).length;
          if(settings.earlyPlayback && !openingCount && preparedCount<parts.length){
            const prefix=earlyPlaybackPrefix(texts,parts);
            if(prefix){openingCount=prefix;audioPlayer.begin(parts.slice(0,prefix) as PreparedClip[]);audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);phase='ready'}
          }
          const opening=prefixCount(),percent=Math.round(texts.slice(0,opening).reduce((n,t)=>n+t.length,0)/Math.max(1,texts.reduce((n,t)=>n+t.length,0))*100),seconds=parts.slice(0,opening).reduce((n,c)=>n+(c?.duration??0),0);
          preparationNotice(phase==='playing'?`Reading… ${preparedCount} of ${parts.length} parts ready. The rest is on its way.`:phase==='paused'?`Paused. ${preparedCount} of ${parts.length} parts ready. The rest is on its way.`:openingCount?`You can press Play now. ${preparedCount} of ${parts.length} parts ready.`:`Preparing: ${preparedCount} of ${parts.length} parts ready…${settings.earlyPlayback?` Opening audio: ${percent}% of text · ${timeLabel(seconds)}.`:''}`);
          renderPlayer();tryAutomaticPlayback();
        };
        const prepareParts=async(manual:boolean)=>{
          if(token!==playbackId)return;
          if(!manual && hostAutomaticTts){
            automaticPlayback.cancel();
            if(parts.some(Boolean))retainPartial();else stop(false);
            notice('Readalong automatic preparation is paused because Lumiverse’s built-in automatic TTS is on. Turn that off in Lumiverse’s voice settings to avoid two recordings and two sets of speech requests. Readalong sent no new speech request.',true);renderPlayer();return;
          }
          preparingAudio=true;incompleteAudio=false;checkingSavedAudio=false;
          notice(`Preparing missing audio… ${parts.filter(Boolean).length} of ${parts.length} parts kept.`);renderPlayer();
          try{
            const claim=await rpc('claim_preparation',{key:messageKey,manual});
            if(token!==playbackId)return;
            if(!claim?.allowed){
              if(parts.some(Boolean)){retainPartial();notice(`Kept ${preparedCount} of ${parts.length} parts. Retry missing audio explicitly; your speech service may charge.`,true);renderPlayer()}
              else{stop(false);notice('Audio for this message was already tried once. Press Prepare message to try again. This may cost money.')}
              return;
            }
            const clips=await prepareAll(currentPassages,async(p,index,requestSignal)=>{
              if(parts[index])return parts[index]!;
              const data=await prepareSpeech(p.segment,p.settings,manual?'manual':'automatic',requestSignal,plan.connections.find(c=>c.id===p.settings.connectionId));requestSignal.throwIfAborted();
              const clip=await prepareClip(data,requestSignal);requestSignal.throwIfAborted();parts[index]=clip;
              try{saved=await audioCache.putPartial(cacheUserId,audioKey,parts,recording)}catch{saved=false}
              retained.saved=saved;
              requestSignal.throwIfAborted();return clip;
            },signal,progress,snapshot.provider==='lumiverse'?3:2);
            if(token!==playbackId)return;
            if(openingCount && (audioPlayer.hasStarted || playAttempt))audioPlayer.append(clips.slice(openingCount),true);
            else audioPlayer.load(clips);
            incompleteAudio=false;retryPreparation=null;preparingAudio=false;checkingSavedAudio=false;preparedCount=clips.length;
            audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);
            if(phase==='preparing')phase='ready';
            preparationNotice(!saved?'The audio is ready, but some parts could not be saved. Keep this window open.':phase==='playing'?'Reading… The whole message is ready.':phase==='paused'?'Paused. The whole message is ready.':'The whole message is ready. Press Play.');
            renderPlayer();tryAutomaticPlayback();
          }catch(error){
            if(token!==playbackId)return;
            if(parts.some(Boolean)){
              retainPartial();const detail=error instanceof Error?error.message:'The speech request failed.';
              notice(`${detail} Kept ${preparedCount} of ${parts.length} parts${saved?' on this device':' in this window'}. Retry missing audio requests only the missing parts and may cost money.`,true);renderPlayer();
            }else{stop(false);throw error}
          }
        };
        retryPreparation=async()=>{if(preparingAudio || token!==playbackId || !settings.enabled)return;lastPlaybackAction='Retry missing audio';updateSpeechActivity();automaticPlayback.cancel();automaticPlaybackError='';await prepareParts(true)};
        if(parts.filter(Boolean).length===parts.length){
          // Explicitly selecting an already saved take makes it the default
          // again without paying for it, including after switching styles back.
          if(options.updateAudio){try{saved=await audioCache.putPartial(cacheUserId,audioKey,parts,recording)}catch{saved=false}retained.saved=saved}
          restored=true;preparedCount=parts.length;retryPreparation=null;audioPlayer.load(parts as PreparedClip[]);audioPlayer.setSpeed(settings.speed);audioPlayer.setVolume(settings.volume);
        }else if(options.restoreOnly || options.automatic && parts.some(Boolean)){
          if(parts.some(Boolean)){retainPartial();notice(`Kept ${preparedCount} of ${parts.length} parts${saved?' on this device':' in this window'}. Play uses the prepared opening. Retry missing audio requests only missing parts and may cost money.`,true);renderPlayer()}
          else{stop(false);notice('No saved audio for this message. Press Prepare message to make it. This may cost money.')}
          return;
        }else{await prepareParts(!options.automatic);return}

      }
      if(token!==playbackId)return;
      if(phase==='preparing')phase='ready';preparingAudio=false;checkingSavedAudio=false;
      preparationNotice(restored?previousRecording?'Saved audio keeps its original voices and style. Play is free. Use Update saved audio to apply changes; that may cost money.':saved?'Saved audio is ready, at no new cost. Press Play.':'The prepared audio is ready, at no new cost. Keep this window open; it could not be saved.':!saved?'This audio could not be saved. It will be gone after a reload.':(phase as string)==='playing'?'Reading… The whole message is ready.':(phase as string)==='paused'?'Paused. The whole message is ready.':(phase as string)==='finished'?'Finished. Replay is free.':'The whole message is ready. Press Play.');renderPlayer();tryAutomaticPlayback();
    } catch(e) {if(token===playbackId){stop(false);throw e}}
  }
  async function preview(voice: string, assignment?: Partial<VoiceAssignment>,sample?:{text:string;entries:Pronunciations}) {
    if(!settings.enabled)throw new Error('Readalong is off. Turn it on to test a voice.');
    stop(false);const token=playbackId;readingAbort=new AbortController();
    if(settings.provider!=='browser')audioPlayer.unlock();
    const segment={text:sample?.text??'The door was open. I took a breath, and stepped into the light.',speaker:'Preview',emotion:assignment?.emotion ?? 'neutral',delivery:assignment?.delivery ?? 'normal'};
    const snapshot=normalizeSettings({...settings,voice,narratorVoice:'',npcVoice:'',assignments:{},inheritVoices:false});
    if(snapshot.provider==='lumiverse'){try{nativeConnections=await nativeTts.connections()}catch{}if(token!==playbackId)return}
    currentPassages=planSpeech([segment],snapshot,{characters:[],connections:nativeConnections,pronunciations:sample?.entries});currentSegments=[segment];position=0;phase='preparing';showWidget();renderPlayer();notice(`Preparing ${voice}…`);
    try {
      if(snapshot.provider!=='browser') {
        const data=await prepareSpeech(currentPassages[0].segment,currentPassages[0].settings,'preview',readingAbort.signal);
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
    settings=normalizeSettings(r.settings);if(phase==='idle')notice(settings.enabled?'Readalong is on. New replies get audio on their own.':'Readalong is off. Nothing is sent to your voice service.');
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
    lastPlaybackAction=restoreOnly?'Load saved':'Prepare message';updateSpeechActivity();
    try {
      const r = await rpc('message',{chatId,messageId:id});
      if (ctx.getActiveChat().chatId !== chatId || token!==playbackId || messageLoad!==operation)return;
      await startMessage(r.message,{restoreOnly});
    }finally{if(messageLoad===operation){messageLoad=null;renderPlayer();tryAutomaticPlayback()}}
  }
  function renderPlayer() {
    for(const handle of bubbleHandles.values()){const read=handle.querySelector('button');if(read)read.disabled=!settings.enabled}
    powerInput.checked=settings.enabled;powerLabel.textContent=settings.enabled?'On':'Off';
    intro.textContent=settings.enabled?settings.automaticPlayback?'New replies get audio on their own and play when enough is ready. Your voice service may charge for each one.':'New replies get audio on their own and wait for Play. Your voice service may charge for each one.':'Turn on to hear replies read aloud.';
    root.dataset.raPhase=settings.enabled?phase:'off';
    const content=el('section'),canFloat=typeof ctx.ui.createFloatWidget==='function';
    const float=()=>iconButton('float','Floating player',()=>safe(openWidget),'ra-icon ra-quiet ra-push');
    if (currentSegments.length) {
      const segment=currentSegments[position],meta=el('div','', 'ra-meta'),voice=currentPassages[currentPassage]?.voice;
      meta.append(el('strong',speakerLabel(segment?.speaker,'Voice')));if(voice)meta.append(el('span',voice));
      meta.append(el('span',(preparingAudio || incompleteAudio)?`${preparedCount} of ${currentPassages.length} parts ready`:`Sentence ${position+1} of ${currentSegments.length}`,'ra-push'));
      const progress=el('progress');progress.max=preparingAudio?currentPassages.length:currentSegments.length;progress.value=preparingAudio?preparedCount:phase==='ready'?0:position+1;progress.setAttribute('aria-label',preparingAudio?'Speech preparation':'Playback progress');
      const seek=el('div','', 'ra-seek');seek.append(progress,el('span',audioPlayer.duration?`${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`:'','ra-time'));
      content.append(meta,el('p',plainText(segment?.text ?? ''), 'ra-passage'),seek);
    } else if (messages.length) {
      content.append(field('Message',select([...messages].reverse().map(m=>({value:m.id,label:`${m.name || 'Assistant'}: ${plainText(stripCues(m.content)).slice(0,70)}`})), selectedId,v=>{selectedId=v})));
    } else content.append(el('p',ready?'No replies in this chat yet. Readalong picks up the next one.':'Loading…','ra-muted'));
    const row=el('div','', 'ra-row');
    if (phase !== 'idle') {
      const play=playButton(()=>safe(playOrPause));play.disabled=phase==='preparing' || !!playAttempt || incompleteAudio && !audioPlayer.duration;
      row.append(play,iconButton('stop','Stop',()=>stop(),'ra-icon'));
      if (currentMessage) row.append(button('Show in chat',()=>marker.follow()),button('Fix a name',()=>fixAName()));
      if(retryPreparation && (incompleteAudio || preparingAudio && preparedCount>0)){const retry=button('Retry missing audio',()=>safe(async()=>{await retryPreparation?.()}),true);retry.disabled=preparingAudio;row.append(retry)}
      if(currentMessage && !preparingAudio && currentPassages[0]?.settings.provider!=='browser' && preparedCount>0){
        const update=button('Update saved audio (may cost)',()=>safe(async()=>{
          if(!currentMessage || preparingAudio)return;
          lastPlaybackAction='Update saved audio';updateSpeechActivity();
          await startMessage({...currentMessage},{updateAudio:true});
        }));update.disabled=!settings.enabled || !!playAttempt || !!messageLoad;update.title='Use your current voices, emotions and speech style. This may request new paid audio. Play keeps the existing recording.';row.append(update);
      }
    } else {
      const read=button('Prepare message',()=>safe(async()=>{ if (selectedId) await readId(selectedId); else { await refreshMessages(); if (selectedId) await readId(selectedId); else throw new Error('No assistant message found.') } }),true);
      read.disabled=!ready || !settings.enabled || !!messageLoad;row.append(read,iconButton('refresh','Refresh messages',()=>safe(refreshMessages),'ra-icon'));
    }
    if(canFloat)row.append(float());
    content.append(row);
    if(phase==='idle' && settings.enabled)content.append(el('p','Uses saved audio if there is any. If not, it makes new audio, which may cost money.','ra-muted'));
    if(ready && canFloat && (widgetError || !permissions.includes('ui_panels')))content.append(el('p',widgetError || widgetPermissionHint,'ra-muted'));
    patchPlaybackChildren(player,...content.childNodes);renderWidget();
  }
  function renderOptions() {
    const slider=el('input');slider.type='range';slider.min='.5';slider.max='2';slider.step='.1';slider.value=String(settings.speed);
    const speedText=()=>`Speed: ${settings.speed.toFixed(1)}×`,speedLabel=el('span',speedText()),speedField=el('label','', 'ra-field');
    slider.setAttribute('aria-label','Speed');
    slider.oninput=()=>{settings.speed=Number(slider.value);speedLabel.textContent=speedText();audioPlayer.setSpeed(settings.speed)};slider.onchange=()=>{void safe(saveSettings)};speedField.append(speedLabel,slider);
    const volume=el('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value=String(settings.volume);
    const volumeText=()=>`Volume: ${Math.round(settings.volume*100)}%`,volumeLabel=el('span',volumeText()),volumeField=el('label','', 'ra-field');
    volume.setAttribute('aria-label','Volume');
    volume.oninput=()=>{settings.volume=Number(volume.value);volumeLabel.textContent=volumeText();audioPlayer.setVolume(settings.volume)};volume.onchange=()=>{void safe(saveSettings)};volumeField.append(volumeLabel,volume);
    const sliders=el('div','', 'ra-grid');sliders.append(speedField,volumeField);
    const about=disclosure([el('strong','About cost and saved audio')]);
    about.body.append(
      el('p','While Readalong is on, each new reply gets audio as soon as it is written. Automatic playback can start it for you; otherwise press Play.','ra-muted'),
      el('p','Each successful audio part is saved on this device. Reloading or switching chats reuses what is still saved. Play never requests speech.','ra-muted'),
      el('p','If preparation fails, Retry missing audio keeps the successful parts and requests only what is missing. That retry can cost money. Storage limits or clearing app data can remove saved audio.','ra-muted'),
      speechActivityNote,
      el('p','Changing a voice, or how a name is said, only changes new audio.','ra-muted'),
      el('p','The highlighted sentence is a close guess of where the voice is.','ra-muted'));
    options.replaceChildren(sliders,
      toggle('Play replies automatically',settings.automaticPlayback,v=>{void safe(()=>setAutomaticPlayback(v))},'Start with the next new reply when enough audio is ready. Current and manually prepared messages wait for Play. Pause waits for Resume.'),
      toggle('Scroll the chat to follow the voice',settings.follow,v=>{settings.follow=v;void safe(saveSettings)}),
      toggle('Allow playback before the whole message is ready',settings.earlyPlayback,v=>{settings.earlyPlayback=v;void safe(saveSettings)},'Manual and automatic playback can start with about three quarters of the text and at least 30 seconds of opening audio. Turn off to wait for the whole message.'),
      about.details);
  }
  function nextStep(label:string,to:View) { const b=button(label,()=>showView(to,true));b.classList.add('ra-quiet','ra-next');return b }
  function renderConfig() {
    const rerender=()=>{renderConfig();renderVoices();renderAssignments()};
    config.replaceChildren();
    config.append(field('Voice service',select([{value:'lumiverse',label:'Lumiverse connection (easiest)'},{value:'openrouter',label:'OpenRouter with my own key'},{value:'browser',label:'Browser voices (free)'},{value:'local',label:'My own server'}],settings.provider,v=>{
      stop(false); settings.provider=v as Settings['provider'];
      if(v==='lumiverse'){const connection=activeNative()??nativeConnections.find(c=>c.provider==='openrouter_tts')??nativeConnections[0];if(connection)chooseNative(connection)}
      else if(v==='browser')settings.voice=voiceNames()[0] ?? '';else if(v==='local'){settings.model='kokoro';settings.voice='af_heart'}else{settings.model=DEFAULTS.model;settings.voice='Kore'};
      rerender();void safe(async()=>{await saveSettings();await refreshCatalog()});
    })));
    const modelField=()=>field('Voice model',select(models.map(m=>({value:m.id,label:m.name})),settings.model,v=>{stop(false);settings.model=v;settings.voice=voiceNames()[0]??'';rerender();void safe(saveSettings)}));
    const actions=el('div','', 'ra-row');
    diagnoseButton=null;diagnoseHint=null;
    if(settings.provider==='lumiverse') {
      config.append(field('Connection',select([{value:'',label:'Choose a connection'},...nativeConnections.map(c=>({value:c.id,label:`${c.name} (${c.provider.replace(/_tts$/,'')})`}))],settings.connectionId,v=>{
        stop(false);const connection=nativeConnections.find(c=>c.id===v);if(connection)chooseNative(connection);else settings.connectionId='';
        rerender();void safe(async()=>{await saveSettings();await refreshCatalog()});
      })));
      if(models.length && activeNative())config.append(modelField());
      actions.append(button('Test connection',()=>safe(async()=>{if(!activeNative())throw new Error('Choose a connection first.');notice('Testing the connection…');notice(await nativeTts.check(settings.connectionId))}),true),withIcon(button('Reload list',()=>safe(refreshNativeConnections)),'refresh'));
      config.append(actions,el('p','Uses a voice connection you already saved in Lumiverse’s voice settings. Add or change connections there.','ra-muted'));
      if(/gemini-3\.8.*tts/i.test(settings.model))config.append(el('p',activeNative()?.supportsSpeechStyle?'Gemini uses the speech style saved on this connection, plus your character’s mood and delivery when feelings are on. Vocal sounds stay in the dialogue. Changes apply to new audio; saved recordings stay as they are.':'Gemini reads vocal sounds from your preset. Update Lumiverse to a build with Speech style to use Readalong’s character moods and delivery. Saved audio is kept.','ra-muted'));
    }
    if(settings.provider==='openrouter')config.append(modelField());
    if(settings.provider==='local'){
      const grid=el('div','', 'ra-grid');grid.append(field('Server address',textInput(settings.localUrl,v=>settings.localUrl=v)),field('Model name',textInput(settings.model,v=>settings.model=v)));
      config.append(grid,button('Save address and model',()=>safe(saveSettings)));
    }
    if(settings.provider==='openrouter' || settings.provider==='local') {
      const provider=settings.provider;
      const key=textInput('',()=>{},'password');key.autocomplete='off';key.placeholder=hasKeys[provider]?'Key saved. Leave blank to keep it':'Paste your API key';
      const keyRow=el('div','', 'ra-row ra-end');
      keyRow.append(field('API key',key),button('Save key',()=>safe(async()=>{if(!key.value.trim())throw new Error('Paste a key first.');const r=await rpc('save_key',{key:key.value,provider,localUrl:settings.localUrl});hasKeys[provider]=r.hasKey;key.value='';key.placeholder='Key saved';notice('Key saved.');})));
      config.append(keyRow);
      actions.append(button('Test connection',()=>safe(async()=>{
        notice('Testing the connection…');const r=await rpc('check_connection',{settings});notice(r.message);
      }),true));
      if(provider==='openrouter')actions.append(withIcon(button('Reload voices',()=>safe(async()=>{const r=await rpc('models');models=r.models;if(!models.some(m=>m.id===settings.model))models.unshift({id:settings.model,name:settings.model,voices:[]});rerender();notice('Voice list reloaded.')})),'refresh'));
      const remove=button('Remove saved key',()=>safe(async()=>{
        const result=await ctx.ui.showConfirm({title:'Remove saved key?',message:`Remove the Readalong ${provider==='local'?'server':'OpenRouter'} key? Connections saved in Lumiverse are not touched.`,variant:'danger',confirmLabel:'Remove key'});
        if(!result.confirmed)return;
        await rpc('remove_key',{provider,confirmed:true});hasKeys[provider]=false;key.placeholder='Paste your API key';notice('Saved key removed.');
      }));remove.classList.add('ra-quiet');actions.append(remove);
      config.append(actions,el('p',`Your key is stored encrypted. Each sample or reading sends a request to this service.${provider==='local'?' A key only works with the exact server address it was saved for. Servers on the internet must use HTTPS.':''}`,'ra-muted'));
      diagnoseButton=button('Show last error',()=>safe(async()=>{
        if(diagnosing)return;diagnosing=true;stop(false);showDiagnostics(false);notice('Reading the error…');
        lastPlaybackAction='Show last error';speechActivity.diagnostic++;updateSpeechActivity();
        try {const r=await rpc('diagnose_speech');notice(r.message)}finally{diagnosing=false;showDiagnostics(canDiagnoseSpeech)}
      }));
      diagnoseHint=el('p','Show last error sends the failed request one more time to read what went wrong. If it works this time, you may be charged for it.','ra-muted');
      config.append(diagnoseButton,diagnoseHint);showDiagnostics(canDiagnoseSpeech);
    }
    config.append(el('hr','', 'ra-rule'),el('h3','Help from the story model'),
      toggle('Mark feelings and who is speaking',settings.promptEmotions,v=>{settings.promptEmotions=v;void safe(saveSettings)},'Adds a little to each reply. The marks stay hidden in chat.'),
      toggle('Act out those feelings',settings.useEmotions,v=>{settings.useEmotions=v;void safe(saveSettings)},'Only for voices that can do it.'),
      nextStep('Next: try some voices',  'voices'));
  }
  function renderVoices() {
    voicesCard.replaceChildren();
    const names=voiceNames(),pick=(name:string)=>{settings.voice=name;renderVoices();void safe(saveSettings)};
    const row=el('div','', 'ra-row ra-end');
    const listen=withIcon(button('Listen',()=>safe(()=>preview(settings.voice)),true),'speaker');listen.disabled=!settings.enabled;
    row.append(field('Main voice',voiceSelect(settings.voice,pick)),listen);
    voicesCard.append(row,el('p',settings.enabled?'Used for anyone who has no voice of their own. Listen plays a short sample, which may cost a little.':'Turn Readalong on to listen to samples.','ra-muted'));
    if(settings.provider==='local' || !names.length)voicesCard.append(field('Voice name',textInput(settings.voice,v=>settings.voice=v)),el('p',names.length?'The list shows common Kokoro voices. Type a voice name if your server uses others.':'This model has no voice list yet. Reload it under Connection, or type a voice name.','ra-muted'));
    if(names.length) {
      const search=textInput(voiceQuery,v=>{voiceQuery=v;drawList()});search.placeholder=`Search ${names.length} voices`;search.setAttribute('aria-label','Search voices');
      const list=el('div','', 'ra-voice-list');
      function drawList() {list.replaceChildren();for(const name of names.filter(n=>n.toLowerCase().includes(voiceQuery.toLowerCase()))) {const b=button(name,()=>pick(name));b.setAttribute('aria-pressed',String(name===settings.voice));list.append(b)}if(!list.childElementCount)list.append(el('p','No voice matches that search.','ra-muted'))}
      drawList();voicesCard.append(search,list);
    }
    if(settings.provider==='lumiverse')voicesCard.append(toggle('Use voices already set in Lumiverse',settings.inheritVoices,v=>{settings.inheritVoices=v;void safe(saveSettings)},'For anyone without a Readalong voice.'));
    voicesCard.append(nextStep('Next: give voices to your cast','cast'));
  }
  // ---- Cast: everyone in the story, their voice and how their name is said ----
  const baseName=(name:string)=>name.split('||')[0].trim();
  const emptyVoice=():VoiceAssignment=>({voice:'',emotion:'neutral',delivery:'normal'});
  function storyNames(){return pronunciationChatId && pronunciationChatId===ctx.getActiveChat().chatId?Object.values(pronunciationEntries):[]}
  function sayingFor(name:string){const wanted=name.toLowerCase();return wanted?storyNames().find(e=>[e.name,...e.aliases].some(n=>n.toLowerCase()===wanted)):undefined}
  function castName(key:string){return key.startsWith('id:')?characters.find(c=>c.id===key.slice(3))?.name??'Unknown character':settings.assignments[key]?.name??castDrafts.get(key)?.name??addedNames.get(key)??key.slice(5)}
  function voiceForName(name:string){
    const wanted=name.toLowerCase(),character=characters.find(c=>baseName(c.name).toLowerCase()===wanted);
    return settings.assignments[`name:${wanted}`]??(character?settings.assignments[`id:${character.id}`]:undefined);
  }
  function sayingEntry(name:string,spokenAs:string,aliases:string){
    const entry=pronunciationEntry({name,spokenAs,aliases:aliases.split(',').map(s=>s.trim()).filter(Boolean)},'manual');
    if(!entry)throw new Error('Type the name and how to say it. Use letters, numbers, spaces, apostrophes or hyphens.');
    return entry;
  }
  async function saveSaying(entry:PronunciationEntry){
    const chatId=ctx.getActiveChat().chatId;if(!chatId)throw new Error('Open a story first. How a name is said is saved for each story.');
    const r=await rpc('save_pronunciation',{chatId,entry});
    if(disposed || ctx.getActiveChat().chatId!==chatId)return;
    pronunciationEntries=normalizePronunciations(r.entries);pronunciationChatId=chatId;
  }
  async function removeSaying(name:string){
    const chatId=ctx.getActiveChat().chatId;if(!chatId)return;
    const r=await rpc('remove_pronunciation',{chatId,name});
    if(disposed || ctx.getActiveChat().chatId!==chatId)return;
    pronunciationEntries=normalizePronunciations(r.entries);pronunciationChatId=chatId;
  }
  function testSaying(entry:PronunciationEntry,voice:string,assignment?:Partial<VoiceAssignment>,spelling?:string){
    // An unknown choice (the spelling was edited away) falls back to reading them all.
    const only=spelling && [entry.name,...entry.aliases].includes(spelling)?spelling:undefined;
    return preview(voice,assignment,{text:pronunciationSample(entry,only),entries:normalizePronunciations({[entry.name]:entry})});
  }
  /** Voice and name form for one cast member. Also used by the character editor tab. */
  function castForm(container:HTMLElement,key:string,name:string,inList=true) {
    const saved=settings.assignments[key],spoken=baseName(name),known=sayingFor(spoken),hasStory=!!ctx.getActiveChat().chatId;
    if(!castDrafts.has(key))castDrafts.set(key,{...(saved??emptyVoice()),...(key.startsWith('name:')?{name:spoken}:{})});
    const draft=castDrafts.get(key)!;
    const say=sayDrafts.get(key)??{spokenAs:known?.spokenAs??'',aliases:(known?.aliases??[]).join(', ')};
    const touch=()=>{sayDrafts.set(key,say)};
    container.replaceChildren();
    if(!inList){container.classList.add('ra-stack');container.append(el('h3',`Voice for ${spoken}`))}
    const listen=withIcon(button('Listen',()=>safe(()=>preview(draft.voice||settings.voice,draft))),'speaker');listen.disabled=!settings.enabled;
    const voiceRow=el('div','', 'ra-row ra-end');voiceRow.append(field('Voice',voiceSelect(draft.voice,v=>draft.voice=v,true)),listen);container.append(voiceRow);
    if(settings.provider==='local')container.append(field('Voice name',textInput(draft.voice,v=>draft.voice=v)));
    if(hasStory) {
      const sayInput=textInput(say.spokenAs,v=>{say.spokenAs=v;touch()});sayInput.maxLength=100;sayInput.placeholder='For example, Eleese';sayInput.dataset.raSay=key;
      const test=button('Test',()=>safe(()=>testSaying(sayingEntry(known?.name??spoken,say.spokenAs,say.aliases),draft.voice||settings.voice,draft,testPick.get(key))));test.disabled=!settings.enabled;
      const sayRow=el('div','', 'ra-row ra-end');sayRow.append(field('Say the name as',sayInput),test);container.append(sayRow);
    } else container.append(el('p','Open a story to set how this name is said.','ra-muted'));
    const more=disclosure([el('strong','More')],moreOpen.has(key));
    more.details.addEventListener('toggle',()=>{if(more.details.isConnected){if(more.details.open)moreOpen.add(key);else moreOpen.delete(key)}});
    if(hasStory){
      const pick=el('select'),pickField=field('Which spelling to test',pick);pick.onchange=()=>{if(pick.value)testPick.set(key,pick.value);else testPick.delete(key)};
      const refreshPick=()=>{
        const names=[...new Set([known?.name??spoken,...say.aliases.split(',').map(s=>s.trim())].filter(Boolean))];
        if(!names.includes(testPick.get(key)??''))testPick.delete(key);
        pick.replaceChildren();
        for(const choice of [{value:'',label:'All of them'},...names.map(value=>({value,label:value}))]){const option=el('option',choice.label);option.value=choice.value;pick.append(option)}
        pick.value=testPick.get(key)??'';pickField.hidden=names.length<2;
      };
      const also=textInput(say.aliases,v=>{say.aliases=v;touch();refreshPick()});also.maxLength=810;also.placeholder='Nicknames or other spellings, with commas between';
      refreshPick();more.body.append(field('Also goes by',also),pickField);
    }
    const moods=el('div','', 'ra-grid');moods.append(field('Usual mood',select(EMOTIONS.map(v=>({value:v,label:v})),draft.emotion,v=>draft.emotion=v)),field('Usual way of speaking',select(DELIVERIES.map(v=>({value:v,label:v})),draft.delivery,v=>draft.delivery=v)));
    more.body.append(moods);container.append(more.details);
    const done=()=>{castDrafts.delete(key);sayDrafts.delete(key);renderAssignments();if(!inList)castForm(container,key,name,false)};
    const save=button('Save',()=>safe(async()=>{
      const edited=sayDrafts.has(key),wantsVoice=!!saved || !!draft.voice || draft.emotion!=='neutral' || draft.delivery!=='normal';
      const entry=edited && say.spokenAs.trim()?sayingEntry(known?.name??spoken,say.spokenAs,say.aliases):undefined;
      if(!wantsVoice && !entry && !(edited && known))throw new Error('Pick a voice or type how to say the name first.');
      if(wantsVoice){settings.assignments[key]={...draft};await saveSettings()}
      if(entry)await saveSaying(entry);else if(edited && known)await removeSaying(known.name);
      done();notice(entry || (edited && known)?`Saved ${spoken}. Audio you already have keeps the old sound.`:`Saved ${spoken}.`);
    }),true);
    const remove=button(inList?'Remove':'Clear',()=>safe(async()=>{
      if(saved || known){
        const result=await ctx.ui.showConfirm({title:`Remove ${spoken}?`,message:known?'This forgets their voice and how their name is said in this story.':'This forgets their voice.',variant:'danger',confirmLabel:'Remove'});
        if(!result.confirmed)return;
      }
      if(saved){delete settings.assignments[key];await saveSettings()}
      if(known)await removeSaying(known.name);
      addedCast.delete(key);addedNames.delete(key);openCast.delete(key);if(inList && settings.personaName && key===`name:${settings.personaName.toLowerCase()}`){settings.personaName='';await saveSettings()}
      done();notice(`Removed ${spoken}.`);
    }));remove.classList.add('ra-quiet','ra-push');
    const actions=el('div','', 'ra-row');actions.append(save,remove);container.append(actions);
  }
  function fixAName() {
    tab.activate();showView('cast');
    if(!fixName && currentSegments[position]){
      const sentence=plainText(currentSegments[position].text).toLowerCase();
      fixName=castRows().map(r=>baseName(r.name)).find(n=>n && sentence.includes(n.toLowerCase()))??'';
      fixSay=sayingFor(fixName)?.spokenAs??'';renderAssignments();
    }
    const target=assignmentsCard.querySelector<HTMLInputElement>(fixName?'[data-ra-fix="say"]':'[data-ra-fix="name"]');target?.focus();target?.select();
  }
  function castRows() {
    const keys=new Set([...Object.keys(settings.assignments).filter(key=>/^(id|name):/.test(key)),...addedCast]);
    if(!keys.size && !castInitialized){const id=ctx.getActiveChat().characterId??characters[0]?.id;if(id && characters.some(c=>c.id===id)){addedCast.add(`id:${id}`);keys.add(`id:${id}`)}}
    const you=settings.personaName?`name:${settings.personaName.toLowerCase()}`:'';if(you)keys.add(you);
    const rows=[...keys].map(key=>({key,name:key===you?settings.personaName:castName(key),you:key===you}));
    // Names the story has taught Readalong join the cast, even before they have a voice.
    for(const entry of storyNames()){
      const names=[entry.name,...entry.aliases].map(n=>n.toLowerCase());
      if(!rows.some(r=>names.includes(baseName(r.name).toLowerCase())))rows.push({key:`name:${entry.name.toLowerCase()}`,name:entry.name,you:false});
    }
    const active=ctx.getActiveChat().characterId,rank=(r:{key:string;you:boolean})=>r.you?0:r.key===`id:${active}`?1:2;
    return rows.sort((a,b)=>rank(a)-rank(b) || a.name.localeCompare(b.name));
  }
  function renderAssignments() {
    assignmentsCard.replaceChildren();
    const hasStory=!!ctx.getActiveChat().chatId,rows=castRows();
    if(!castInitialized && rows.length){castInitialized=true}
    // Quick fix: the thing people reach for in the middle of a story.
    if(hasStory) {
      const fix=el('div','', 'ra-fix'),names=el('datalist');names.id='ra-cast-names';
      for(const name of new Set(rows.map(r=>baseName(r.name)))){const option=el('option');option.value=name;names.append(option)}
      const nameInput=textInput(fixName,v=>{fixName=v;const known=sayingFor(v.trim());if(known && !fixSay){fixSay=known.spokenAs;sayInput.value=fixSay}});nameInput.maxLength=80;nameInput.placeholder='Pick or type a name';nameInput.setAttribute('list',names.id);nameInput.dataset.raFix='name';
      const sayInput=textInput(fixSay,v=>fixSay=v);sayInput.maxLength=100;sayInput.placeholder='For example, Eleese';sayInput.dataset.raFix='say';
      const candidate=()=>{const known=sayingFor(fixName.trim());return sayingEntry(known?.name??fixName.trim(),fixSay,(known?.aliases??[]).join(', '))};
      const test=button('Test',()=>safe(async()=>{const entry=candidate(),assigned=voiceForName(entry.name);await testSaying(entry,assigned?.voice||settings.voice,assigned)}));test.disabled=!settings.enabled;
      const save=button('Save',()=>safe(async()=>{const entry=candidate();await saveSaying(entry);fixName='';fixSay='';sayDrafts.clear();renderAssignments();notice(`${entry.name} will be said as “${entry.spokenAs}”. Audio you already have keeps the old sound.`)}),true);
      const fields=el('div','', 'ra-grid');fields.append(field('Name',nameInput),field('Say it as',sayInput));
      const actions=el('div','', 'ra-row');actions.append(save,test);
      fix.append(el('h3','Fix how a name is said'),fields,actions,names);assignmentsCard.append(fix);
    }
    assignmentsCard.append(el('h3','Cast'),el('p','Everyone in your stories who has a voice, plus the names this story has picked up.','ra-muted'));
    const narrator=disclosure([el('strong','Narrator'),el('span',settings.narratorVoice||'Main voice')],openCast.has('narrator'));
    narrator.details.addEventListener('toggle',()=>{if(narrator.details.isConnected){if(narrator.details.open)openCast.add('narrator');else openCast.delete('narrator')}});
    const narratorListen=withIcon(button('Listen',()=>safe(()=>preview(settings.narratorVoice||settings.voice))),'speaker');narratorListen.disabled=!settings.enabled;
    const narratorRow=el('div','', 'ra-row ra-end');narratorRow.append(field('Voice',voiceSelect(settings.narratorVoice,v=>{settings.narratorVoice=v;void safe(async()=>{await saveSettings();renderAssignments();notice('Narrator voice saved.')})},true)),narratorListen);
    narrator.body.append(narratorRow,el('p','Reads narrative prose and actions. Your own message text uses your You voice.','ra-muted'));assignmentsCard.append(narrator.details);
    if(!settings.personaName) {
      const you=disclosure([el('strong','You'),el('span','Add your character')],openCast.has('you'));
      you.details.addEventListener('toggle',()=>{if(you.details.isConnected){if(you.details.open)openCast.add('you');else openCast.delete('you')}});
      let mine='';const mineInput=textInput('',v=>mine=v);mineInput.maxLength=80;mineInput.placeholder='The name you play as';
      const youRow=el('div','', 'ra-row ra-end');youRow.append(field('Your name in the story',mineInput),button('Add me',()=>safe(async()=>{
        const name=mine.trim();if(!validSpeaker(name))throw new Error('Type the name you play as, up to 80 letters.');
        settings.personaName=name;openCast.delete('you');openCast.add(`name:${name.toLowerCase()}`);await saveSettings();renderAssignments();
      }),true));
      you.body.append(youRow,el('p','Gives your own messages a voice, and voices your character when a reply speaks for them. Your Lumiverse persona can use a longer name.','ra-muted'));assignmentsCard.append(you.details);
    }
    for(const row of rows){
      const saved=settings.assignments[row.key],known=sayingFor(baseName(row.name));
      const summary:(Node|string)[]=[el('strong',row.you?`You (${row.name})`:baseName(row.name)),el('span',saved?.voice||'No voice yet')];
      if(known)summary.push(el('span',`said “${known.spokenAs}”`));
      if(!saved && !known && !row.you)summary.push(el('span','New','ra-badge'));
      const entry=disclosure(summary,openCast.has(row.key));
      entry.details.classList.add('ra-cast-entry');entry.details.dataset.castKey=row.key;entry.body.classList.add('ra-cast-form');
      entry.details.addEventListener('toggle',()=>{if(entry.details.isConnected){if(entry.details.open)openCast.add(row.key);else openCast.delete(row.key)}});
      assignmentsCard.append(entry.details);castForm(entry.body,row.key,row.name);
    }
    const others=disclosure([el('strong','Everyone else'),el('span',settings.npcVoice||'Same as the main character')],openCast.has('others'));
    others.details.addEventListener('toggle',()=>{if(others.details.isConnected){if(others.details.open)openCast.add('others');else openCast.delete('others')}});
    const othersListen=withIcon(button('Listen',()=>safe(()=>preview(settings.npcVoice||settings.voice))),'speaker');othersListen.disabled=!settings.enabled;
    const othersNames=[...voiceNames()];if(settings.npcVoice && !othersNames.includes(settings.npcVoice))othersNames.unshift(settings.npcVoice);
    const othersRow=el('div','', 'ra-row ra-end');othersRow.append(field('Voice',select([{value:'',label:'Same as the main character'},...othersNames.map(name=>({value:name,label:name}))],settings.npcVoice,v=>{settings.npcVoice=v;void safe(async()=>{await saveSettings();renderAssignments();notice(v?'Voice saved for everyone else. Audio you already have keeps the old sound.':'Everyone else now sounds like the main character.')})})),othersListen);
    others.body.append(othersRow,el('p','For side characters who speak but have no voice of their own yet. Give someone their own row above to make them sound different.','ra-muted'));
    if(!settings.promptEmotions)others.body.append(el('p','This only works when “Mark feelings and who is speaking” is on under Connection. That is how Readalong knows who is talking.','ra-muted'));
    assignmentsCard.append(others.details);
    function addMember(key:string,name?:string){
      if(!rows.some(r=>r.key===key) && rows.length>=500){notice('The cast can hold up to 500 people.',true);return}
      addedCast.add(key);if(name)addedNames.set(key,name);
      openCast.add(key);castInitialized=true;addOpen=false;renderAssignments();
    }
    const add=disclosure([el('strong','Add someone')],addOpen);
    add.details.addEventListener('toggle',()=>{if(add.details.isConnected)addOpen=add.details.open});
    let characterId=characters.find(c=>c.id===ctx.getActiveChat().characterId)?.id??characters[0]?.id??'';
    const fromLibrary=el('div','', 'ra-row ra-end');
    if(characters.length)fromLibrary.append(field('One of your characters',select(characters.map(c=>({value:c.id,label:baseName(c.name)})),characterId,v=>characterId=v)),button('Add',()=>{if(characterId)addMember(`id:${characterId}`)}));
    fromLibrary.append(iconButton('refresh','Reload characters',()=>safe(async()=>{const r=await rpc('characters');characters=r.characters;renderAssignments();}),'ra-icon'));
    let speaker='';const speakerInput=textInput('',v=>speaker=v);speakerInput.placeholder='For example, Jason';speakerInput.maxLength=80;
    const byName=el('div','', 'ra-row ra-end');
    const addByName=button('Add',()=>{
      const name=speaker.trim();if(!validSpeaker(name)){notice('Type a name of up to 80 letters. The narrator already has a row above.',true);return}
      addMember(`name:${name.toLowerCase()}`,name);
    });addByName.dataset.raControl='Add by name';
    byName.append(field('Or anyone else, by name',speakerInput),addByName);
    add.body.append(fromLibrary,byName,el('p','Side characters can have a voice too. For Readalong to tell several speakers apart in one reply, turn on “Mark feelings and who is speaking” under Connection.','ra-muted'));
    assignmentsCard.append(add.details,
      toggle('Learn how to say new names',settings.promptPronunciations,v=>{settings.promptPronunciations=v;void safe(saveSettings)},'The story model suggests how to say each new name. Your own fixes always win.'),
      nextStep('Next: playback options','options'));
  }
  function decorateMessages() {
    for(const {messageId,element} of ctx.dom.listMessageElements()) {
      if(bubbleHandles.has(messageId))continue;
      const handle=ctx.dom.inject(element,'<div class="ra-bubble" data-ra-ui="true"></div>','beforeend');const target=handle.firstElementChild!;
      const read=withIcon(button('Read aloud',()=>safe(()=>readId(messageId))),'speaker');read.disabled=!settings.enabled;target.append(read);bubbleHandles.set(messageId,handle);
    }
  }
  function onEvent(name:string,fn:(payload:any)=>void) {cleanups.push(ctx.events.on(name,p=>fn(p)))}
  onEvent('CHAT_SWITCHED',()=>{
    completionInbox.reset();localGenerations.clear();completionRecovery=null;
    pronunciationEpoch++;pronunciationEntries={};pronunciationChatId='';sayDrafts.clear();testPick.clear();fixName='';fixSay='';renderAssignments();
    stop(false); messages=[]; selectedId='';automaticPreparations.clear();
    for (const handle of bubbleHandles.values()) ctx.dom.uninject(handle);
    bubbleHandles.clear(); notice(settings.enabled?'Looking for saved audio…':'Readalong is off.'); void safe(async()=>{await refreshPronunciations();await refreshMessages();await prepareLatest(false,true)});
  });
  for(const event of ['MESSAGE_EDITED','MESSAGE_SWIPED','SWIPE_EDITED','MESSAGE_DELETED'])onEvent(event,p=>{
    const id=p?.message?.id??p?.messageId;
    if(p?.chatId && p.chatId!==ctx.getActiveChat().chatId)return;
    if(currentMessage && currentMessage.id===id){
      if(event==='MESSAGE_EDITED'){
        const changed=readingChanged(currentMessage,p.message);
        if(changed===true){stop();notice('The message text or speaker changed. Saved audio was kept; prepare the changed passage explicitly if needed.')}
        else if(changed===undefined){
          // Older hosts may send only an ID. Verify through the owned message
          // RPC before canceling; this read cannot synthesize or retry speech.
          const token=playbackId,chatId=ctx.getActiveChat().chatId;
          void safe(async()=>{
            const result=await rpc('message',{chatId,messageId:id});
            if(token!==playbackId || !currentMessage || currentMessage.id!==id || chatId!==ctx.getActiveChat().chatId)return;
            if(!result.message || readingChanged(currentMessage,result.message)===true){stop();notice('The message changed. Saved audio was kept; prepare the changed passage explicitly if needed.')}
          });
        }
      }else stop();
    }
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
  // Chat generation and speech preparation have independent lifetimes. A late
  // chat stop notification must not discard paid audio from a completed reply.
  onEvent('GENERATION_STOPPED',p=>{localGenerations.delete(p?.generationId)});
  onEvent('CONNECTED',()=>{void safe(recoverCompletion)});
  onEvent('CHARACTER_MESSAGE_RENDERED',()=>decorateMessages());
  cleanups.push(tab.onActivate(()=>{void safe(async()=>{await refreshPronunciations();await refreshMessages();await recoverCompletion()})}));
  const onReturn=()=>{if(document.visibilityState==='visible')void safe(recoverCompletion)};
  document.addEventListener('visibilitychange',onReturn);window.addEventListener('focus',onReturn);
  cleanups.push(()=>{document.removeEventListener('visibilitychange',onReturn);window.removeEventListener('focus',onReturn)});
  const recoveryTimer=setInterval(()=>{void safe(recoverCompletion)},15000);cleanups.push(()=>clearInterval(recoveryTimer));
  const action=ctx.ui.registerInputBarAction({id:'readalong',label:'Readalong',subtitle:'Listen and find your place',iconSvg:TAB_ICON});cleanups.push(action.onClick(()=>{tab.activate();void safe(openWidget)}));
  function installEditor() {
    if(editorTab || !permissions.includes('characters'))return;
    editorTab=ctx.ui.registerCharacterEditorTab({id:'readalong-voice',title:'Readalong voice'});editorTab.root.classList.add('ra');editorTab.root.dataset.raUi='true';
    const render=()=>{const state=ctx.ui.characterEditor.getState();if(state.open&&state.characterId)castForm(editorTab!.root,`id:${state.characterId}`,characters.find(c=>c.id===state.characterId)?.name??'this character',false)};
    cleanups.push(ctx.ui.characterEditor.onChange(render),editorTab.onActivate(render));render();
  }
  if('speechSynthesis' in window){const refresh=()=>{if(settings.provider==='browser'){renderVoices();renderAssignments()}};speechSynthesis.addEventListener('voiceschanged',refresh);cleanups.push(()=>speechSynthesis.removeEventListener('voiceschanged',refresh))}
  renderPlayer();renderOptions();renderConfig();renderVoices();renderAssignments();ctx.ready();
  void safe(async()=>{
    const r=await rpc('init');if(disposed)return;settings=normalizeSettings(r.settings);completionInbox.initialize(settings.enabled);cacheUserId=typeof r.userId==='string'?r.userId:'';Object.assign(hasKeys,r.hasKeys??{openrouter:r.hasKey,local:false});permissions=r.permissions;ready=true;
    try {
      nativeConnections=await nativeTts.connections();if(disposed)return;
      const existing=nativeConnections.find(c=>c.provider==='openrouter_tts' && c.model===settings.model) ?? nativeConnections.find(c=>c.provider==='openrouter_tts');
      if(needsPcm(settings) && existing){chooseNative(existing,true);await saveSettings()}
      else if(settings.provider==='lumiverse' && !settings.connectionId && nativeConnections.length){chooseNative(existing??nativeConnections[0]);await saveSettings()}
    } catch { /* Direct/browser modes remain available if native TTS is absent. */ }
    renderPlayer();renderOptions();renderConfig();renderVoices();renderAssignments();installEditor();
    // First run starts at step one. After that, the cast is what people come back for.
    if(!viewChosen)showView(settings.provider==='lumiverse'?(settings.connectionId?'cast':'connection'):settings.provider==='openrouter' && !hasKeys.openrouter?'connection':'cast');
    if(r.cueStatus)notice(r.cueStatus,true);else notice('Ready. New here? Start with Connection, then try a voice.');
    if(permissions.includes('characters')){try{const r=await rpc('characters');characters=r.characters;renderAssignments()}catch{}}
    initialized=true;
    if(settings.provider==='lumiverse' || permissions.includes('cors_proxy'))void refreshCatalog().catch(()=>{});
    if(permissions.includes('chat_mutation')){await refreshPronunciations();await refreshMessages();await flushCompletion();if(!currentMessage)await prepareLatest(false,true);await recoverCompletion()}
    if(!settings.enabled)notice('Readalong is off. Nothing is sent to your voice service.');
  });
  return()=>{
    stop(false);disposed=true;retainedParts=null;marker.dispose();audioPlayer.dispose();widgetDragCleanup?.();widget?.destroy();for(const fn of cleanups)fn();editorTab?.destroy();action.destroy();tab.destroy();
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Readalong unloaded.'))}pending.clear();ctx.dom.cleanup();
  };
}
