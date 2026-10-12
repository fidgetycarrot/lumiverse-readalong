import type { Settings, VoiceAssignment, VoiceGender } from './shared';

/** A stable small number for a name, so the same character gets the same pick. */
function hash(text: string) { let h = 2166136261; for (const c of text.toLowerCase()) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619) } return h >>> 0 }

/**
 * A voice for a new character: one of the voices marked with their gender,
 * preferring voices nobody uses yet, chosen the same way every time.
 */
export function pickVoice(name: string, candidates: string[], used: string[]): string | undefined {
  if (!candidates.length) return;
  const counts = new Map(candidates.map(v => [v, used.filter(u => u === v).length]));
  const least = Math.min(...counts.values());
  const pool = candidates.filter(v => counts.get(v) === least);
  return pool[hash(name) % pool.length];
}

export interface AutoCastInput {
  /** Speakers in the reply, as display names. */
  speakers: string[];
  /** Voices the current model offers. */
  voices: string[];
  genderOfVoice: (voice: string) => VoiceGender | undefined;
  /** How a character should sound, when anyone has said so. */
  genderOf: (speaker: string) => VoiceGender | undefined;
  /** True for side characters with no voice of their own. */
  needsVoice: (speaker: string) => boolean;
}

/** New cast rows (keyed like settings.assignments) for side characters whose gender is known. */
export function autoCast(settings: Settings, input: AutoCastInput): Record<string, VoiceAssignment> {
  const added: Record<string, VoiceAssignment> = {};
  const used = [settings.voice, settings.narratorVoice, settings.npcVoice, ...Object.values(settings.assignments).map(a => a.voice)].filter(Boolean);
  for (const speaker of input.speakers) {
    const name = speaker.trim(), key = `name:${name.toLowerCase()}`;
    if (!name || name.toLowerCase() === 'narrator' || added[key] || !input.needsVoice(name)) continue;
    const gender = settings.assignments[key]?.gender ?? input.genderOf(name);
    if (!gender) continue;
    const voice = pickVoice(name, input.voices.filter(v => input.genderOfVoice(v) === gender), used);
    if (!voice) continue;
    used.push(voice);
    added[key] = { ...(settings.assignments[key] ?? { emotion: 'neutral', delivery: 'normal' }), voice, name, gender, auto: true };
  }
  return added;
}
