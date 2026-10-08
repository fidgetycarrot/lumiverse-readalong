import { sanitizeSpeechText,stripVocalTags } from './speech-text';
import {PRONUNCIATION_CUE_PATTERN,stripPronunciationCues} from './pronunciation';

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'worried', 'curious', 'excited', 'sarcastic', 'tender', 'afraid'] as const;
export const DELIVERIES = ['normal', 'whispers', 'shouts', 'softly', 'slowly', 'laughs', 'sighs'] as const;
export const GEMINI_VOICES = ['Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar','Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi','Vindemiatrix','Sadachbia','Sadaltager','Sulafat'];
export const CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]|${PRONUNCIATION_CUE_PATTERN}`;
export const HIDE_RULE_NAME = 'Readalong • Hide voice cues';
export interface VoiceAssignment { voice: string; emotion: string; delivery: string; name?:string }
export interface Settings {
  provider: 'lumiverse' | 'openrouter' | 'browser' | 'local';
  connectionId: string;
  model: string; voice: string; narratorVoice: string; localUrl: string;
  enabled: boolean; follow: boolean; earlyPlayback:boolean; automaticPlayback:boolean; promptEmotions: boolean; useEmotions: boolean;promptPronunciations:boolean; personaName:string; npcVoice:string;
  inheritVoices: boolean; widgetMinimized: boolean; widgetPosition: {x:number;y:number}|null;
  speed: number; volume: number;
  assignments: Record<string, VoiceAssignment>;
}
export const DEFAULTS: Settings = {
  provider: 'openrouter', connectionId:'', model: 'google/gemini-3.8-flash-tts', voice: 'Kore', narratorVoice: '',
  localUrl: 'http://localhost:8880/v1', enabled: false, follow: false, earlyPlayback:true, automaticPlayback:false,
  promptEmotions: true, useEmotions: true, promptPronunciations:true, personaName:'', npcVoice:'', inheritVoices:true, widgetMinimized:false, widgetPosition:null, speed: 1, volume: 0.85, assignments: {},
};
export interface SpeechSegment { text: string; speaker: string; emotion: string; delivery: string }
export interface SpeechModel { id: string; name: string; voices: string[] }
export interface MessageInfo { id: string; content: string; name: string; isUser: boolean; characterId?: string }
export interface NativeVoiceRef { connectionId:string;voice:string }
export interface CharacterInfo { id:string;name:string;ttsVoice?:NativeVoiceRef }
export interface SpeechRules { quoted:'speech'|'narration'|'skip';asterisked:'thought'|'narration'|'skip';undecorated:'speech'|'narration'|'skip' }
export const DEFAULT_SPEECH_RULES:SpeechRules = {quoted:'speech',asterisked:'narration',undecorated:'narration'};
export function readVoiceRef(raw:unknown):NativeVoiceRef|undefined {
  if(!raw || typeof raw!=='object')return;
  const v=raw as Record<string,unknown>;
  if(typeof v.connectionId!=='string' || !v.connectionId || v.connectionId.length>160)return;
  return {connectionId:v.connectionId,voice:typeof v.voice==='string'?v.voice.slice(0,160):''};
}
export function speakerCharacterId(speaker: string, characters: {id:string;name:string}[], fallback?: string): string | undefined {
  const name = speaker.trim().toLowerCase();
  if (name === 'narrator') return undefined;
  const matches = characters.filter(c => c.name.trim().toLowerCase() === name);
  return matches.length === 1 ? matches[0].id : fallback;
}
export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const p=r.widgetPosition;
  const widgetPosition=p && typeof p==='object' && typeof p.x==='number' && typeof p.y==='number' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.y>=0?{x:p.x,y:p.y}:null;
  const str = (v: unknown, fallback: string, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : fallback;
  const assignments: Settings['assignments'] = {};
  if (r.assignments && typeof r.assignments === 'object') for (const [key, v] of Object.entries(r.assignments).slice(0, 500)) {
    if (!v || typeof v !== 'object' || ['__proto__','constructor','prototype'].includes(key)) continue;
    assignments[key.slice(0, 200)] = { voice: str(v.voice, '', 160), emotion: enumValue(v.emotion, EMOTIONS, 'neutral'), delivery: enumValue(v.delivery, DELIVERIES, 'normal'), ...(typeof v.name==='string'?{name:str(v.name,'',80)}:{}) };
  }
  return {
    connectionId: str(r.connectionId,'',160),
    provider: ['lumiverse','openrouter','browser','local'].includes(r.provider ?? '') ? r.provider! : DEFAULTS.provider,
    model: str(r.model, DEFAULTS.model), voice: str(r.voice, DEFAULTS.voice), narratorVoice: str(r.narratorVoice, ''), npcVoice: str(r.npcVoice, ''),
    localUrl: str(r.localUrl, DEFAULTS.localUrl, 500),
    enabled: typeof r.enabled==='boolean'?r.enabled:DEFAULTS.enabled, follow: r.follow === true, earlyPlayback:r.earlyPlayback!==false, automaticPlayback:r.automaticPlayback===true,
    promptEmotions: r.promptEmotions !== false, useEmotions: r.useEmotions !== false,promptPronunciations:r.promptPronunciations!==false, personaName:typeof r.personaName==='string' && r.personaName.trim().length<=80 && !/[\[\]\r\n]/.test(r.personaName)?r.personaName.trim():'', inheritVoices:r.inheritVoices!==false, widgetMinimized:r.widgetMinimized===true, widgetPosition,
    speed: clamp(r.speed, 0.5, 2, 1), volume: clamp(r.volume, 0, 1, .85), assignments,
  };
}
function clamp(v: unknown, min: number, max: number, fallback: number) { return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback }
function enumValue(v: unknown, values: readonly string[], fallback: string) { return typeof v === 'string' && values.includes(v.toLowerCase()) ? v.toLowerCase() : fallback }
export function stripCues(text: string) { return text.replace(new RegExp(CUE_PATTERN, 'gi'), '') }
// Match rendered prose without depending on React's DOM structure or changing stored messages.
export function plainText(text: string,keepVocalTags=false): string {
  return stripPronunciationCues(sanitizeSpeechText(text,keepVocalTags)).replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_`~]/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
export function splitSentences(text: string): string[] {
  // Intl keeps abbreviations and Unicode punctuation substantially better than a period regex.
  // Vocal tokens have no linguistic content. Mask them for boundary detection
  // but retain their original positions in the text sent to Gemini.
  const detection=stripVocalTags(text,true);
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(detection), s => text.slice(s.index,s.index+s.segment.length).trim()).filter(Boolean)
    .flatMap(s => {
      if(s.length<=650)return [s];
      const chunks:string[]=[];let chunk='';
      // Multiword vocal events remain atomic even at long passage boundaries.
      for(const token of s.match(/<[^<>]+>|\S+/gu) ?? []) {
        for(const word of token.match(/.{1,600}/gu) ?? []) {
          if(chunk && chunk.length+word.length+1>600){chunks.push(chunk);chunk=''}
          chunk+=(chunk?' ':'')+word;
        }
      }
      if(chunk)chunks.push(chunk);return chunks;
    });
}
export function parseSegments(raw: string, defaultSpeaker = '', rules:SpeechRules=DEFAULT_SPEECH_RULES): SpeechSegment[] {
  raw = stripPronunciationCues(sanitizeSpeechText(raw,true)).replace(/!\[[^\]]*\]\([^)]*\)/g,' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1');
  const cue = new RegExp(`\\[(emotion|delivery|speaker):([^\\]\\r\\n]{1,80})\\]`, 'gi');
  const pieces:SpeechSegment[]=[];
  let speaker=defaultSpeaker,explicitSpeaker=false,emotion='',delivery='';
  const classify=(text:string,action:string)=>{
    if(action==='skip')return;
    let offset=0,prefix='',appended=false;
    const append=(prose:string)=>{
      const text=plainText(prose,true);if(!text)return;
      // A cue inside opening quotes must not create a spoken quote-only
      // request or discard the quote's character classification.
      if(/^["“”«»]+$/.test(text)){prefix+=text;return}
      const chosen=explicitSpeaker?speaker:action==='narration'?'narrator':defaultSpeaker;
      const value={text:prefix+text,speaker:chosen,emotion,delivery};prefix='';
      appended=true;
      const last=pieces.at(-1);
      if(last && last.speaker===value.speaker && last.emotion===emotion && last.delivery===delivery)last.text+=' '+value.text;
      else pieces.push(value);
    };
    for(const match of text.matchAll(cue)) {
      append(text.slice(offset,match.index));const value=match[2].trim(),kind=match[1].toLowerCase();
      if(kind==='speaker'){speaker=value;explicitSpeaker=true;emotion='';delivery=''}
      if(kind==='emotion')emotion=enumValue(value,EMOTIONS,'neutral');
      if(kind==='delivery')delivery=enumValue(value,DELIVERIES,'normal');
      offset=match.index!+match[0].length;
    }
    append(text.slice(offset));
    if(prefix && appended)pieces.at(-1)!.text+=prefix;
  };
  // Classify the complete decorated spans before parsing their cues, so an
  // emotion/delivery cue inside quotes cannot reset dialogue detection.
  const pattern=/"[^"\n]*(?:\n[^"\n]*)*"|“[^”]*”|«[^»]*»|(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g;
  const detection=raw.replace(new RegExp(CUE_PATTERN,'gi'),match=>' '.repeat(match.length));
  let cursor=0;
  for(const match of detection.matchAll(pattern)) {
    classify(raw.slice(cursor,match.index),rules.undecorated);
    const quoted=match[1]===undefined;
    classify(raw.slice(match.index,match.index!+match[0].length),quoted?rules.quoted:rules.asterisked);
    // A character cue attached to dialogue must not make the following
    // narrative use that character's voice or performance directions.
    if(quoted){speaker=defaultSpeaker;explicitSpeaker=false;emotion='';delivery=''}
    cursor=match.index!+match[0].length;
  }
  classify(raw.slice(cursor),rules.undecorated);
  return pieces.flatMap(piece=>splitSentences(piece.text).map(text=>({...piece,text})));
}

export function selectVoice(settings: Settings, segment: SpeechSegment, characterId?: string): VoiceAssignment {
  const byName = settings.assignments[`name:${segment.speaker.toLowerCase()}`];
  const narrator = segment.speaker.toLowerCase() === 'narrator';
  const card = characterId && !narrator ? settings.assignments[`id:${characterId}`] : undefined;
  const assigned = byName ?? card;
  return {
    voice: (narrator ? settings.narratorVoice : assigned?.voice) || settings.voice,
    emotion: settings.useEmotions ? segment.emotion || assigned?.emotion || 'neutral' : 'neutral',
    delivery: settings.useEmotions ? segment.delivery || assigned?.delivery || 'normal' : 'normal',
  };
}
export function speechInput(segment: SpeechSegment, assignment: VoiceAssignment, supportsTags: boolean, supportsVocalTags=false): string {
  const text=supportsVocalTags?segment.text:stripVocalTags(segment.text).replace(/\s+/g,' ').trim();
  if (!supportsTags) return text;
  const emotionTag: Record<string,string> = { happy:'happy', sad:'sad', angry:'angry', worried:'worried', curious:'curious', excited:'excited', sarcastic:'sarcastic', tender:'warmly', afraid:'scared' };
  const cues: string[] = [];
  if (emotionTag[assignment.emotion]) cues.push(`[${emotionTag[assignment.emotion]}]`);
  if (assignment.delivery !== 'normal') cues.push(`[${assignment.delivery}]`);
  return [...cues, text].join(' ');
}
export function needsPcm(settings: Settings): boolean {
  return settings.provider === 'openrouter' && /^google\/gemini-.*tts/i.test(settings.model);
}
export function speechRequest(settings: Settings, segment: SpeechSegment, characterId?: string): Record<string,unknown> {
  const assignment = selectVoice(settings,segment,characterId);
  const openrouter = settings.provider === 'openrouter';
  // Gemini 3.8 accepts inline vocal events; sustained directions stay separate.
  const gemini38 = openrouter && /^google\/gemini-3\.8.*tts/.test(settings.model);
  const legacyTags = openrouter && /^google\/gemini-3\.1.*tts/.test(settings.model);
  const body: Record<string,unknown> = { model:settings.model, voice:assignment.voice, input:speechInput(segment,assignment,legacyTags,gemini38), response_format:needsPcm(settings) ? 'pcm' : 'mp3' };
  if (gemini38) {
    const emotions: Record<string,string> = { happy:'happy and cheerful',sad:'sad',angry:'angry',worried:'worried',curious:'curious',excited:'excited',sarcastic:'sarcastic',tender:'warm and tender',afraid:'afraid' };
    const deliveries: Record<string,string> = { whispers:'whispering',shouts:'shouting',softly:'soft-spoken',slowly:'slow and deliberate',laughs:'with a light laugh',sighs:'with a sigh' };
    const style = [emotions[assignment.emotion],deliveries[assignment.delivery]].filter(Boolean).join(', ');
    if (style) body.provider = { options:{ 'google-ai-studio':{ speech_metadata:{ style } } } };
  }
  return body;
}
export const EMOTION_INSTRUCTION = `When vocal delivery matters, add sparse voice cues immediately before the affected sentence, using [emotion:neutral|happy|sad|angry|worried|curious|excited|sarcastic|tender|afraid] and optionally [delivery:normal|whispers|shouts|softly|slowly|laughs|sighs]. Choose one value per cue, not the list. Put [speaker:Character Name] inside the opening quotation mark of that character's dialogue. Quoted dialogue ends that speaker's cues; surrounding prose automatically uses the narrator. Repeat a speaker cue for each quote that needs a different character. For intentional unquoted speech, cues persist until [speaker:narrator] or another speaker cue; a speaker change resets emotion and delivery. Use the character's name, preserve ordinary prose and formatting, and avoid tagging every sentence. These cues are hidden from the reader and used only for speech. Do not add unrelated square-bracket audio instructions. Preserve inline vocal tags requested by the preset.`;
