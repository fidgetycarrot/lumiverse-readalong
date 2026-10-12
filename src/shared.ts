import {attributeQuotes,canonicalSpeaker,type Roster} from './speaker-detect';
import { sanitizeSpeechText,stripVocalTags } from './speech-text';
import {PRONUNCIATION_CUE_PATTERN,stripPronunciationCues} from './pronunciation';
import {deliveryStyle,isGeminiSpeechStyleModel} from './speech-style';

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'worried', 'curious', 'excited', 'sarcastic', 'tender', 'afraid'] as const;
export const DELIVERIES = ['normal', 'whispers', 'shouts', 'softly', 'slowly', 'laughs', 'sighs'] as const;
export const GEMINI_VOICES = ['Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar','Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi','Vindemiatrix','Sadachbia','Sadaltager','Sulafat'];
export type VoiceGender = 'f' | 'm';
/** How Google lists its prebuilt voices. A user's own marks in settings.voiceGenders win. */
const GEMINI_FEMALE = ['Achernar','Aoede','Autonoe','Callirrhoe','Despina','Erinome','Gacrux','Kore','Laomedeia','Leda','Pulcherrima','Sulafat','Vindemiatrix','Zephyr'];
export const GEMINI_VOICE_GENDERS: Readonly<Record<string,VoiceGender>> = Object.fromEntries(GEMINI_VOICES.map(name => [name.toLowerCase(), GEMINI_FEMALE.includes(name) ? 'f' : 'm'] as [string,VoiceGender]));
/** 'f' or 'm' for a voice, or undefined when nobody has marked it. A saved 'n' clears a built-in mark. */
export function voiceGender(settings: Pick<Settings,'voiceGenders'>, voice: string): VoiceGender | undefined {
  const key = voice.trim().toLowerCase(), own = settings.voiceGenders?.[key];
  if (own) return own === 'n' ? undefined : own;
  return GEMINI_VOICE_GENDERS[key];
}
/** The next saved marks after the user presses Female or Male for a voice. Pressing the active one clears it. */
export function markVoiceGender(marks: Record<string,VoiceGender|'n'>, voice: string, pressed: VoiceGender): Record<string,VoiceGender|'n'> {
  const key = voice.trim().toLowerCase(), next = { ...marks }, builtIn = GEMINI_VOICE_GENDERS[key];
  if (!key) return next;
  const current = voiceGender({ voiceGenders: marks }, voice), wanted = current === pressed ? undefined : pressed;
  if (wanted === builtIn) delete next[key]; else next[key] = wanted ?? 'n';
  return next;
}
export const CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]|${PRONUNCIATION_CUE_PATTERN}`;
export const HIDE_RULE_NAME = 'Readalong • Hide voice cues';
/** gender: how the character should sound. auto: Readalong picked the voice. */
export interface VoiceAssignment { voice: string; emotion: string; delivery: string; name?:string; aliases?:string[]; gender?:VoiceGender; auto?:boolean }
/** One story's own cast. A story is one Lumiverse chat. */
/**
 * One story's own cast. A story is one Lumiverse chat. `you` is your name in this
 * story when it differs from your usual one; `lead` is who speaks lines that name
 * nobody, on a storyteller card.
 */
export interface StoryCast { names: Record<string, VoiceAssignment>; members?: string[]; title?: string; characterId?: string; you?: string; lead?: string; updatedAt: number }
export interface Settings {
  provider: 'lumiverse' | 'openrouter' | 'browser' | 'local';
  connectionId: string;
  model: string; voice: string; narratorVoice: string; localUrl: string;
  enabled: boolean; follow: boolean; earlyPlayback:boolean; automaticPlayback:boolean; promptEmotions: boolean; useEmotions: boolean;promptPronunciations:boolean; personaName:string; npcVoice:string; autoVoices:boolean;
  /** Mixer: per speaker (lowercase name, 'narrator') level and skip. */
  mix:Record<string,{gain:number;mute:boolean}>; dialogueOnly:boolean; soundEffects:boolean; saveToMessage:boolean; savedRecordings:number; voiceGenders:Record<string,VoiceGender|'n'>;
  inheritVoices: boolean; widgetMinimized: boolean; widgetPosition: {x:number;y:number}|null;
  speed: number; volume: number;
  /** Voices shared by every story: library characters (`id:`) and You. */
  assignments: Record<string, VoiceAssignment>;
  /** Each story's own named cast, by chat ID. `earlier` holds names saved before casts were per story. */
  stories: Record<string, StoryCast>;
  /** Cards that tell a story rather than play one person, by character ID. */
  storytellers: string[];
}
export const DEFAULTS: Settings = {
  provider: 'openrouter', connectionId:'', model: 'google/gemini-3.8-flash-tts', voice: 'Kore', narratorVoice: '',
  localUrl: 'http://localhost:8880/v1', enabled: false, follow: false, earlyPlayback:true, automaticPlayback:false,
  promptEmotions: true, useEmotions: true, promptPronunciations:true, personaName:'', npcVoice:'', autoVoices:true, mix:{}, dialogueOnly:false, soundEffects:false, saveToMessage:false, savedRecordings:30, voiceGenders:{}, inheritVoices:true, widgetMinimized:false, widgetPosition:null, speed: 1, volume: 0.85, assignments: {}, stories: {}, storytellers: [],
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
  // Library names may carry a title after '||'; speakers are matched on the name itself.
  const matches = characters.filter(c => c.name.trim().toLowerCase() === name || c.name.split('||')[0].trim().toLowerCase() === name);
  return matches.length === 1 ? matches[0].id : fallback;
}
/** A speaker name safe to store: 1–80 characters, no cue brackets or line breaks, not "narrator". */
function speakerName(v: unknown): string { return typeof v === 'string' && v.trim() && v.trim().length <= 80 && !/[\[\]\r\n]/.test(v) && v.trim().toLowerCase() !== 'narrator' ? v.trim() : '' }
export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const p=r.widgetPosition;
  const widgetPosition=p && typeof p==='object' && typeof p.x==='number' && typeof p.y==='number' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.y>=0?{x:p.x,y:p.y}:null;
  const str = (v: unknown, fallback: string, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : fallback;
  const unsafe = (key: string) => ['__proto__','constructor','prototype'].includes(key);
  const assignment = (v: any): VoiceAssignment => ({ voice: str(v.voice, '', 160), emotion: enumValue(v.emotion, EMOTIONS, 'neutral'), delivery: enumValue(v.delivery, DELIVERIES, 'normal'), ...(typeof v.name==='string'?{name:str(v.name,'',80)}:{}), ...(Array.isArray(v.aliases)?{aliases:[...new Set<string>((v.aliases as unknown[]).filter((a:unknown):a is string=>typeof a==='string').map((a:string)=>a.trim().slice(0,80)).filter((a:string)=>a && !/[\[\]\r\n]/.test(a) && a.toLowerCase()!=='narrator'))].slice(0,10)}:{}), ...(v.gender==='f' || v.gender==='m'?{gender:v.gender}:{}), ...(v.auto===true?{auto:true}:{}) });
  const assignments: Settings['assignments'] = {}, stories: Settings['stories'] = {};
  if (r.stories && typeof r.stories === 'object' && !Array.isArray(r.stories)) {
    const kept = Object.entries(r.stories as Record<string, any>).filter(([id, v]) => /^[A-Za-z0-9_-]{1,100}$/.test(id) && !unsafe(id) && v && typeof v === 'object')
      .sort((a, b) => (a[0] === 'earlier' ? -1 : b[0] === 'earlier' ? 1 : (Number(b[1].updatedAt) || 0) - (Number(a[1].updatedAt) || 0))).slice(0, 300);
    for (const [id, v] of kept) {
      const names: Record<string, VoiceAssignment> = {};
      for (const [key, a] of Object.entries(v.names && typeof v.names === 'object' ? v.names as Record<string, any> : {}).slice(0, 300))
        if (key.startsWith('name:') && key.length <= 200 && !unsafe(key) && a && typeof a === 'object') names[key] = assignment(a);
      const members: string[] = Array.isArray(v.members) ? [...new Set<string>((v.members as unknown[]).filter((m: unknown): m is string => typeof m === 'string' && /^id:.{1,160}$/.test(m)))].slice(0, 100) : [];
      stories[id] = { names, ...(members.length ? { members } : {}), ...(typeof v.title === 'string' && v.title.trim() ? { title: str(v.title, '', 120) } : {}),
        ...(typeof v.characterId === 'string' && v.characterId.length <= 160 ? { characterId: v.characterId } : {}), ...(speakerName(v.you) ? { you: speakerName(v.you) } : {}), ...(speakerName(v.lead) ? { lead: speakerName(v.lead) } : {}), updatedAt: Number.isFinite(Number(v.updatedAt)) ? Number(v.updatedAt) : 0 };
    }
  }
  if (r.assignments && typeof r.assignments === 'object') for (const [key, v] of Object.entries(r.assignments).slice(0, 500)) {
    if (!v || typeof v !== 'object' || unsafe(key) || key.length > 200) continue;
    assignments[key] = assignment(v);
  }
  return {
    connectionId: str(r.connectionId,'',160),
    provider: ['lumiverse','openrouter','browser','local'].includes(r.provider ?? '') ? r.provider! : DEFAULTS.provider,
    model: str(r.model, DEFAULTS.model), voice: str(r.voice, DEFAULTS.voice), narratorVoice: str(r.narratorVoice, ''), npcVoice: str(r.npcVoice, ''), voiceGenders: Object.fromEntries(Object.entries(r.voiceGenders && typeof r.voiceGenders==='object' && !Array.isArray(r.voiceGenders) ? r.voiceGenders as Record<string,unknown> : {}).filter(([k,v]) => k.length>0 && k.length<=100 && k===k.trim().toLowerCase() && (v==='f' || v==='m' || v==='n')).slice(0,500)) as Record<string,VoiceGender|'n'>,
    localUrl: str(r.localUrl, DEFAULTS.localUrl, 500),
    enabled: typeof r.enabled==='boolean'?r.enabled:DEFAULTS.enabled, follow: r.follow === true, earlyPlayback:r.earlyPlayback!==false, automaticPlayback:r.automaticPlayback===true,
    promptEmotions: r.promptEmotions !== false, useEmotions: r.useEmotions !== false,promptPronunciations:r.promptPronunciations!==false, autoVoices:r.autoVoices!==false, dialogueOnly:r.dialogueOnly===true, soundEffects:r.soundEffects===true, saveToMessage:r.saveToMessage===true, savedRecordings:Number.isFinite(Number(r.savedRecordings))?Math.round(Math.min(200,Math.max(5,Number(r.savedRecordings)))):30,
    mix:Object.fromEntries(Object.entries(r.mix && typeof r.mix==='object' && !Array.isArray(r.mix)?r.mix as Record<string,any>:{}).filter(([k,v])=>k.length>0 && k.length<=80 && k===k.trim().toLowerCase() && !['__proto__','constructor','prototype'].includes(k) && v && typeof v==='object').slice(0,200).map(([k,v])=>[k,{gain:clamp(v.gain,0,1,1),mute:v.mute===true}])), personaName:typeof r.personaName==='string' && r.personaName.trim().length<=80 && !/[\[\]\r\n]/.test(r.personaName)?r.personaName.trim():'', inheritVoices:r.inheritVoices!==false, widgetMinimized:r.widgetMinimized===true, widgetPosition,
    speed: clamp(r.speed, 0.5, 2, 1), volume: clamp(r.volume, 0, 1, .85), assignments, stories,
    storytellers: Array.isArray(r.storytellers) ? [...new Set((r.storytellers as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160))].slice(0, 500) : [],
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
export function parseSegments(raw: string, defaultSpeaker = '', rules:SpeechRules=DEFAULT_SPEECH_RULES, roster?:Roster): SpeechSegment[] {
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
      if(kind==='speaker'){speaker=canonicalSpeaker(roster,value)??value;explicitSpeaker=true;emotion='';delivery=''}
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
  // Without a cue, work out who said each quote from the text around it.
  const spans=[...detection.matchAll(pattern)].filter(m=>m[1]===undefined).map(m=>({start:m.index!,end:m.index!+m[0].length}));
  const guesses=roster && rules.quoted==='speech'?attributeQuotes(detection,spans,roster):[];
  let quoteIndex=0;
  for(const match of detection.matchAll(pattern)) {
    classify(raw.slice(cursor,match.index),rules.undecorated);
    const quoted=match[1]===undefined;
    if(quoted){const guess=guesses[quoteIndex++];if(guess && !explicitSpeaker){speaker=guess;explicitSpeaker=true}}
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
  const gemini38 = openrouter && isGeminiSpeechStyleModel(settings.model);
  const legacyTags = openrouter && /^google\/gemini-3\.1.*tts/.test(settings.model);
  const body: Record<string,unknown> = { model:settings.model, voice:assignment.voice, input:speechInput(segment,assignment,legacyTags,gemini38), response_format:needsPcm(settings) ? 'pcm' : 'mp3' };
  if (gemini38) {
    const style=deliveryStyle(assignment.emotion,assignment.delivery);
    if(style)body.instructions=style;
  }
  return body;
}
export const EMOTION_INSTRUCTION = `When vocal delivery matters, add sparse voice cues immediately before the affected sentence, using [emotion:neutral|happy|sad|angry|worried|curious|excited|sarcastic|tender|afraid] and optionally [delivery:normal|whispers|shouts|softly|slowly|laughs|sighs]. Choose one value per cue, not the list. Put [speaker:Character Name] inside the opening quotation mark of that character's dialogue. Quoted dialogue ends that speaker's cues; surrounding prose automatically uses the narrator. Repeat a speaker cue for each quote that needs a different character. For intentional unquoted speech, cues persist until [speaker:narrator] or another speaker cue; a speaker change resets emotion and delivery. Use the character's name, preserve ordinary prose and formatting, and avoid tagging every sentence. These cues are hidden from the reader and used only for speech. Do not add unrelated square-bracket audio instructions. Preserve inline vocal tags requested by the preset.`;
