export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'worried', 'curious', 'excited', 'sarcastic', 'tender', 'afraid'] as const;
export const DELIVERIES = ['normal', 'whispers', 'shouts', 'softly', 'slowly', 'laughs', 'sighs'] as const;
export const GEMINI_VOICES = ['Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar','Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi','Vindemiatrix','Sadachbia','Sadaltager','Sulafat'];
export const CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]`;
export const HIDE_RULE_NAME = 'Readalong • Hide voice cues';
export interface VoiceAssignment { voice: string; emotion: string; delivery: string }
export interface Settings {
  provider: 'openrouter' | 'browser' | 'local';
  model: string; voice: string; narratorVoice: string; localUrl: string;
  autoPlay: boolean; follow: boolean; promptEmotions: boolean; useEmotions: boolean;
  speed: number; volume: number;
  assignments: Record<string, VoiceAssignment>;
}
export const DEFAULTS: Settings = {
  provider: 'openrouter', model: 'google/gemini-3.8-flash-tts', voice: 'Kore', narratorVoice: '',
  localUrl: 'http://localhost:8880/v1', autoPlay: false, follow: false,
  promptEmotions: true, useEmotions: true, speed: 1, volume: 0.85, assignments: {},
};
export interface SpeechSegment { text: string; speaker: string; emotion: string; delivery: string }
export interface SpeechModel { id: string; name: string; voices: string[] }
export interface MessageInfo { id: string; content: string; name: string; isUser: boolean; characterId?: string }
export function speakerCharacterId(speaker: string, characters: {id:string;name:string}[], fallback?: string): string | undefined {
  const name = speaker.trim().toLowerCase();
  if (name === 'narrator') return undefined;
  const matches = characters.filter(c => c.name.trim().toLowerCase() === name);
  return matches.length === 1 ? matches[0].id : fallback;
}
export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const str = (v: unknown, fallback: string, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : fallback;
  const assignments: Settings['assignments'] = {};
  if (r.assignments && typeof r.assignments === 'object') for (const [key, v] of Object.entries(r.assignments).slice(0, 500)) {
    if (!v || typeof v !== 'object' || ['__proto__','constructor','prototype'].includes(key)) continue;
    assignments[key.slice(0, 200)] = { voice: str(v.voice, '', 160), emotion: enumValue(v.emotion, EMOTIONS, 'neutral'), delivery: enumValue(v.delivery, DELIVERIES, 'normal') };
  }
  return {
    provider: ['openrouter','browser','local'].includes(r.provider ?? '') ? r.provider! : DEFAULTS.provider,
    model: str(r.model, DEFAULTS.model), voice: str(r.voice, DEFAULTS.voice), narratorVoice: str(r.narratorVoice, ''),
    localUrl: str(r.localUrl, DEFAULTS.localUrl, 500),
    autoPlay: r.autoPlay === true, follow: r.follow === true,
    promptEmotions: r.promptEmotions !== false, useEmotions: r.useEmotions !== false,
    speed: clamp(r.speed, 0.5, 2, 1), volume: clamp(r.volume, 0, 1, .85), assignments,
  };
}
function clamp(v: unknown, min: number, max: number, fallback: number) { return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback }
function enumValue(v: unknown, values: readonly string[], fallback: string) { return typeof v === 'string' && values.includes(v.toLowerCase()) ? v.toLowerCase() : fallback }
export function stripCues(text: string) { return text.replace(new RegExp(CUE_PATTERN, 'gi'), '') }
// Match rendered prose without depending on React's DOM structure or changing stored messages.
export function plainText(text: string): string {
  return text.replace(/```[^]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_`~]/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
export function splitSentences(text: string): string[] {
  // Intl keeps abbreviations and Unicode punctuation substantially better than a period regex.
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text), s => s.segment.trim()).filter(Boolean)
    .flatMap(s => s.length <= 650 ? [s] : s.match(/.{1,600}(?:\s|$)|.{1,600}/gu)!.map(x => x.trim()).filter(Boolean));
}
export function parseSegments(raw: string, defaultSpeaker = ''): SpeechSegment[] {
  raw = raw.replace(/```[^]*?```/g, ' ');
  const cue = new RegExp(`\\[(emotion|delivery|speaker):([^\\]\\r\\n]{1,80})\\]`, 'gi');
  const segments: SpeechSegment[] = [];
  let speaker = defaultSpeaker, emotion = '', delivery = '', offset = 0;
  const flush = (text: string) => {
    for (const sentence of splitSentences(plainText(text))) segments.push({ text: sentence, speaker, emotion, delivery });
  };
  for (const m of raw.matchAll(cue)) {
    flush(raw.slice(offset, m.index));
    const value = m[2].trim();
    if (m[1].toLowerCase() === 'speaker') { speaker = value; emotion = ''; delivery = ''; }
    if (m[1].toLowerCase() === 'emotion') emotion = enumValue(value, EMOTIONS, 'neutral');
    if (m[1].toLowerCase() === 'delivery') delivery = enumValue(value, DELIVERIES, 'normal');
    offset = m.index! + m[0].length;
  }
  flush(raw.slice(offset));
  return segments;
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
export function speechInput(segment: SpeechSegment, assignment: VoiceAssignment, supportsTags: boolean): string {
  if (!supportsTags) return segment.text;
  const emotionTag: Record<string,string> = { happy:'happy', sad:'sad', angry:'angry', worried:'worried', curious:'curious', excited:'excited', sarcastic:'sarcastic', tender:'warmly', afraid:'scared' };
  const cues: string[] = [];
  if (emotionTag[assignment.emotion]) cues.push(`[${emotionTag[assignment.emotion]}]`);
  if (assignment.delivery !== 'normal') cues.push(`[${assignment.delivery}]`);
  return [...cues, segment.text].join(' ');
}
export function speechRequest(settings: Settings, segment: SpeechSegment, characterId?: string): Record<string,unknown> {
  const assignment = selectVoice(settings,segment,characterId);
  const openrouter = settings.provider === 'openrouter';
  // Gemini 3.8 reads text verbatim; never put performance directions in its input.
  const gemini38 = openrouter && /^google\/gemini-3\.8.*tts/.test(settings.model);
  const legacyTags = openrouter && /^google\/gemini-3\.1.*tts/.test(settings.model);
  const body: Record<string,unknown> = { model:settings.model, voice:assignment.voice, input:speechInput(segment,assignment,legacyTags), response_format:'mp3' };
  if (gemini38) {
    const emotions: Record<string,string> = { happy:'happy and cheerful',sad:'sad',angry:'angry',worried:'worried',curious:'curious',excited:'excited',sarcastic:'sarcastic',tender:'warm and tender',afraid:'afraid' };
    const deliveries: Record<string,string> = { whispers:'whispering',shouts:'shouting',softly:'soft-spoken',slowly:'slow and deliberate',laughs:'with a light laugh',sighs:'with a sigh' };
    const style = [emotions[assignment.emotion],deliveries[assignment.delivery]].filter(Boolean).join(', ');
    if (style) body.provider = { options:{ 'google-ai-studio':{ speech_metadata:{ style } } } };
  }
  return body;
}
export const EMOTION_INSTRUCTION = `When vocal delivery matters, add sparse voice cues immediately before the affected sentence, using [emotion:neutral|happy|sad|angry|worried|curious|excited|sarcastic|tender|afraid] and optionally [delivery:normal|whispers|shouts|softly|slowly|laughs|sighs]. Choose one value per cue, not the list. For a speaker change use [speaker:Character Name], or [speaker:narrator] for narration. Cues persist until changed; a speaker change resets emotion and delivery. Use the exact character name, preserve ordinary prose and formatting, and avoid tagging every sentence. These cues are hidden from the reader and used only for speech. Do not add any other bracketed audio instructions.`;
