/**
 * Sound effects for things the story describes (a knock, footsteps, a door).
 * The idea and the first set of rules come from Choir
 * (github.com/patatasbravasch-arch/Choir, MIT License, (c) 2026 Choir
 * contributors); these rules are adapted and extended for Readalong.
 */
export interface SoundRule { pattern: RegExp; query: string; filter: string }
export interface SoundCue { query: string; filter: string; /** 0..1, where in the passage the words appear */ at: number }

const d = (min: number, max: number) => `duration:[${min} TO ${max}]`;
export const SOUND_RULES: SoundRule[] = [
  { pattern: /\b(?:knock(?:ed|ing|s)?\s+(?:on|at)\s+(?:the|a|his|her|my|their)\s+door|a\s+knock\s+(?:at|on)\s+the\s+door|rapped\s+(?:on|at)\s+the\s+door)\b/i, query: 'knock on wooden door', filter: d(0.3, 2.5) },
  { pattern: /\b(?:slam(?:med|s)?\s+the\s+door|door\s+slammed)\b/i, query: 'door slam', filter: d(0.3, 2.5) },
  { pattern: /\b(?:door\s+(?:creaked|creaks|swung\s+open|groaned\s+open)|creak(?:ed|ing)?\s+(?:door|floorboards?|hinges?))\b/i, query: 'door creak', filter: d(0.3, 2.5) },
  { pattern: /\b(?:drew\s+the\s+bolt|bolted\s+the\s+door|lock\s+clicked|turned\s+the\s+key)\b/i, query: 'door bolt latch', filter: d(0.2, 2) },
  { pattern: /\b(?:footsteps?\s+(?:approached|echoed|sounded|slowed|receded)|heavy\s+footsteps|boots\s+(?:on|against)\s+the\s+(?:floor|stairs|stone)|pac(?:ed|ing)\s+(?:the\s+floor|back\s+and\s+forth))\b/i, query: 'footsteps', filter: d(0.5, 3) },
  { pattern: /\b(?:page\s+(?:turned|flipped)|turn(?:ed|ing)?\s+(?:the\s+)?page|flipp(?:ed|ing)\s+(?:through\s+)?(?:the\s+)?pages?|rustl(?:ed|ing)\s+(?:the\s+)?papers?)\b/i, query: 'page turn', filter: d(0.1, 2.5) },
  { pattern: /\b(?:glass\s+(?:shattered|broke|smashed)|shattering\s+glass)\b/i, query: 'glass shatter', filter: d(0.3, 2.5) },
  { pattern: /\b(?:glasses\s+clinked|clink(?:ed)?\s+(?:of\s+)?glasses|cups?\s+clatter(?:ed)?|dishes\s+clatter(?:ed)?)\b/i, query: 'glass clink', filter: d(0.1, 2) },
  { pattern: /\b(?:kettle\s+(?:hissed|whistled|sang))\b/i, query: 'kettle whistle', filter: d(0.5, 3) },
  { pattern: /\b(?:thunder\s+(?:rolled|cracked|rumbled|boomed)|crack\s+of\s+thunder)\b/i, query: 'thunder', filter: d(1, 4) },
  { pattern: /\b(?:rain\s+(?:ticked|drummed|pattered|tapped|lashed)\s+(?:on|against))\b/i, query: 'rain on window', filter: d(1, 4) },
  { pattern: /\b(?:fire\s+(?:crackled|popped|hissed)|crackl(?:ed|ing)\s+fire)\b/i, query: 'fire crackle', filter: d(1, 4) },
  { pattern: /\b(?:dr[ae]w\s+(?:his|her|their|my|a|the)\s+(?:sword|blade)|steel\s+rang|blades?\s+clashed)\b/i, query: 'sword unsheathe', filter: d(0.3, 2.5) },
  { pattern: /\b(?:horses?\s+(?:whinnied|neighed|snorted))\b/i, query: 'horse whinny', filter: d(0.5, 3) },
  { pattern: /\b(?:bells?\s+(?:rang|tolled|chimed))\b/i, query: 'bell toll', filter: d(1, 4) },
  { pattern: /\b(?:thump(?:ed)?|thudd?ed|a\s+(?:dull|heavy)\s+thud)\b/i, query: 'thump', filter: d(0.1, 2) },
  { pattern: /\b(?:heart\s+(?:pounded|hammered|thumped|raced))\b/i, query: 'heartbeat', filter: d(0.5, 2.5) },
  { pattern: /\b(?:clock\s+tick(?:ed|ing)|ticking\s+clock)\b/i, query: 'clock tick', filter: d(0.5, 2.5) },
];

/** Every cue in a passage, in order, at most one per kind of sound. */
export function soundCues(text: string, rules = SOUND_RULES): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const rule of rules) {
    const m = rule.pattern.exec(text);
    if (m && !cues.some(c => c.query === rule.query)) cues.push({ query: rule.query, filter: rule.filter, at: text.length ? m.index / text.length : 0 });
  }
  return cues.sort((a, b) => a.at - b.at);
}
