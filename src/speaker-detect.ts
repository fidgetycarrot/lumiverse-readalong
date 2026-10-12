/**
 * Who said each quote, when the story model did not mark it with a
 * [speaker:Name] cue. Pure text rules, no model call. Ideas from Chat Voice
 * (labels, dialogue tags, the paragraph's subject, back-and-forth turns) and
 * Choir (tags on either side of a quote); this implementation is Readalong's.
 */
export interface RosterEntry { name: string; aliases?: string[] }
export interface Roster { /** every spelling, lowercased, to its display name */ names: Map<string, string>; patterns: { re: RegExp; name: string }[] }
export interface QuoteSpan { start: number; end: number }

const TITLES = new Set(['mr','mrs','ms','miss','dr','sir','lady','lord','captain','sergeant','professor','king','queen','prince','princess','father','mother','sister','brother','master','mistress']);
const NOT_NAMES = new Set(['i','the','a','an','he','she','they','it','we','you','his','her','their','its','our','my','your','then','but','and','so','yes','no','oh','ah','well','note','ooc','okay','ok','now','still','just','even','after','before','when','while','as','if','there','here','this','that','these','those','what','who','why','how','where','someone','something','everyone','nobody','one','another','both','neither','either','finally','suddenly','slowly','quietly','again','instead','meanwhile','later','soon','narrator']);
const SPEECH_VERBS = String.raw`(?:said|says|say|asked|asks|ask|replied|replies|answered|answers|whispered|whispers|murmured|murmurs|muttered|mutters|shouted|shouts|yelled|yells|called|calls|cried|cries|snapped|snaps|growled|growls|hissed|hisses|added|adds|continued|continues|began|begins|offered|offers|demanded|demands|admitted|admits|insisted|insists|repeated|repeats|breathed|breathes|laughed|laughs|sighed|sighs|told|tells|declared|declares|announced|announces|warned|warns|explained|explains|agreed|agrees|teased|teases|whimpered|whimpers|purred|purrs|drawled|drawls|scoffed|scoffs|groaned|groans|managed|manages|pressed|presses|corrected|corrects|interrupted|interrupts|chimed in|chimes in|spoke|speaks)`;
const NAME_SHAPE = /^\p{Lu}[\p{L}\p{M}'’-]*(?: \p{Lu}[\p{L}\p{M}'’-]*){0,2}$/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = String.raw`[\p{L}\p{M}\p{N}_]`;

/** A plausible new speaker name seen in a label or a dialogue tag. */
export function looksLikeName(value: string): boolean {
  const s = value.trim();
  return NAME_SHAPE.test(s) && s.length <= 40 && !NOT_NAMES.has(s.toLowerCase()) && !NOT_NAMES.has(s.split(' ')[0].toLowerCase());
}

/** Every known speaker and spelling. A unique first name also reaches a full name. */
export function buildRoster(entries: RosterEntry[]): Roster {
  const names = new Map<string, string>(), firsts = new Map<string, Set<string>>();
  for (const entry of entries) {
    const name = entry.name.split('||')[0].trim();
    if (!name || name.toLowerCase() === 'narrator') continue;
    const display = names.get(name.toLowerCase()) ?? name;
    for (const alias of [name, ...(entry.aliases ?? [])]) {
      const key = alias.trim().toLowerCase();
      if (key && key !== 'narrator' && !names.has(key)) names.set(key, display);
    }
    const words = name.split(/\s+/);
    const first = words.find(w => !TITLES.has(w.toLowerCase().replace(/\.$/, '')));
    if (words.length > 1 && first) {
      const key = first.toLowerCase();
      if (!firsts.has(key)) firsts.set(key, new Set());
      firsts.get(key)!.add(display);
    }
  }
  for (const [key, owners] of firsts) if (owners.size === 1 && !names.has(key) && !NOT_NAMES.has(key)) names.set(key, [...owners][0]);
  // Longest spellings first, so "Captain Rhea" wins over "Rhea".
  const patterns = [...names.entries()].sort((a, b) => b[0].length - a[0].length).map(([key, name]) => {
    const original = [...entries.flatMap(e => [e.name.split('||')[0].trim(), ...(e.aliases ?? [])]), name.split(/\s+/)[0]].find(a => a.toLowerCase() === key) ?? key;
    // Capitalised names must stay capitalised ("Grace", not "grace"); lower-case roles may match any case.
    const flags = /^\p{Lu}/u.test(original) ? 'u' : 'iu';
    return { re: new RegExp(`(?<!${B})${escape(original)}(?!${B})`, flags), name };
  });
  return { names, patterns };
}

/** The display name for any known spelling, or undefined. */
export function canonicalSpeaker(roster: Roster | undefined, value: string): string | undefined {
  return roster?.names.get(value.trim().toLowerCase());
}

/** Known speakers named in text, in order of appearance (each once). */
function mentions(roster: Roster, text: string): { name: string; index: number }[] {
  const found: { name: string; index: number; length: number }[] = [];
  for (const { re, name } of roster.patterns) {
    const g = new RegExp(re.source, re.flags + 'g');
    for (const m of text.matchAll(g)) {
      const start = m.index!, end = start + m[0].length;
      if (found.some(f => start < f.index + f.length && end > f.index)) continue;
      found.push({ name, index: start, length: m[0].length });
    }
  }
  const seen = new Set<string>();
  return found.sort((a, b) => a.index - b.index).filter(f => !seen.has(f.name) && !!seen.add(f.name));
}

/** A known or new name at the very start of a phrase, e.g. `Maren said` or `the sergeant asked`. */
function leadingName(roster: Roster, text: string, allowNew: boolean): { name: string; rest: string } | undefined {
  const s = text.replace(/^[\s,;:—–*_-]+/, '');
  const lead = '^(?:then |but |and |finally |at last |slowly |quietly |softly )?';
  for (const { re, name } of roster.patterns) {
    const m = s.match(new RegExp(lead + re.source, re.flags.includes('i') ? 'iu' : 'u'));
    if (m) return { name, rest: s.slice(m[0].length) };
  }
  if (!allowNew) return;
  const m = s.match(/^(\p{Lu}[\p{L}\p{M}'’-]*(?: \p{Lu}[\p{L}\p{M}'’-]*){0,2})/u);
  return m && looksLikeName(m[1]) ? { name: m[1], rest: s.slice(m[0].length) } : undefined;
}

const SENTENCE_END = /[.!?…](?:["”’)\]]*)\s+/g;
function sentences(text: string): string[] { return text.split(SENTENCE_END).map(s => s.trim()).filter(Boolean) }

/**
 * One speaker (or undefined) for each quote span. Explicit cues are handled by
 * the caller and always win; undefined keeps the reply's own character.
 */
export function attributeQuotes(text: string, quotes: QuoteSpan[], roster: Roster): (string | undefined)[] {
  const result: (string | undefined)[] = [];
  // Paragraphs are lines: role-play output rarely uses blank lines consistently.
  const lineStart = (i: number) => text.lastIndexOf('\n', i - 1) + 1;
  const lineEnd = (i: number) => { const n = text.indexOf('\n', i); return n === -1 ? text.length : n };
  type Para = { start: number; quotes: number[]; speakers: (string | undefined)[]; narration: string };
  const paras: Para[] = [];
  quotes.forEach((q, i) => {
    const start = lineStart(q.start);
    let para = paras.at(-1);
    if (!para || para.start !== start) {
      const end = lineEnd(q.end - 1), inside = quotes.filter(o => o.start >= start && o.end <= end);
      let narration = '', cursor = start;
      for (const o of inside) { narration += text.slice(cursor, o.start) + ' … '; cursor = o.end }
      narration += text.slice(cursor, end);
      para = { start, quotes: [], speakers: [], narration };
      paras.push(para);
    }
    para.quotes.push(i);
  });
  // Lines between dialogue paragraphs with real narration break a back-and-forth.
  const narratedBetween = (from: number, to: number) => {
    const between = text.slice(from, to).split('\n').map(l => l.trim()).filter(Boolean);
    return between.some(l => !/["“”«»]/.test(l) && l.split(/\s+/).length > 6);
  };
  const history: { speaker: string; end: number; pure: boolean }[] = [];
  for (const para of paras) {
    const quiet = para.narration.replace(/…/g, '').replace(/[\s*_]/g, '');
    const pure = quiet.length === 0;
    const paraNames = mentions(roster, para.narration).map(m => m.name);
    const end = lineEnd(quotes[para.quotes.at(-1)!].end - 1);
    para.quotes.forEach((qi, k) => {
      const q = quotes[qi];
      const prevEnd = k ? quotes[para.quotes[k - 1]].end : para.start;
      const nextStart = k + 1 < para.quotes.length ? quotes[para.quotes[k + 1]].start : end;
      const before = text.slice(prevEnd, q.start), after = text.slice(q.end, nextStart);
      let speaker: string | undefined;
      // 1. A label: `Alice: "…"` or `**Alice:** "…"`.
      const label = before.match(/(?:^|\n|[.!?]\s)[\s>*_-]*([\p{L}][\p{L}\p{M}'’ .-]{0,40}?)[*_]*\s*:[*_]*\s*$/u);
      if (label) speaker = canonicalSpeaker(roster, label[1]) ?? (looksLikeName(label[1]) ? label[1].trim() : undefined);
      // 2. A tag right after: `"…," Maren said` / `"…" said Maren` / `"…," the sergeant asked`.
      if (!speaker) {
        const tag = after.split(/[.!?\n]/)[0].slice(0, 90).replace(/^[\s,—–-]+/, '');
        const verbFirst = tag.match(new RegExp(String.raw`^${SPEECH_VERBS}\s+(.+)$`, 'iu'));
        const who = verbFirst ? leadingName(roster, verbFirst[1], true) : leadingName(roster, tag, true);
        if (who && (verbFirst || new RegExp(String.raw`^\s*(?:\p{L}+ly\s+)?${SPEECH_VERBS}`, 'iu').test(who.rest))) speaker = who.name;
        // A pronoun tag ("she said") falls through and keeps the paragraph's speaker.
      }
      // 3. A tag right before in the same sentence: `Maren said, "…"`.
      if (!speaker) {
        const lead = before.split(/[.!?\n]\s*/).at(-1) ?? '';
        if (new RegExp(SPEECH_VERBS + String.raw`[^.!?]{0,30}[,:]?\s*$`, 'iu').test(lead)) speaker = leadingName(roster, lead, true)?.name;
      }
      // 4. An action beat right after: `"Sit." Maren pointed at the chair.`
      if (!speaker) {
        const next = sentences(after)[0];
        if (next) speaker = leadingName(roster, next, false)?.name;
      }
      // 5. An action beat right before: `Maren crossed the room. "Sit."`
      if (!speaker) {
        const prev = sentences(before).at(-1);
        if (prev) speaker = leadingName(roster, prev, false)?.name;
      }
      // 6. The paragraph names exactly one known character.
      if (!speaker && paraNames.length === 1) speaker = paraNames[0];
      // 7. Same paragraph, same speaker as the quote before.
      if (!speaker && k) speaker = para.speakers[k - 1];
      // 8. Bare back-and-forth: A, B, then A again.
      if (!speaker && pure && k === 0 && history.length >= 2) {
        const [a, b] = history.slice(-2);
        if (a.speaker !== b.speaker && !narratedBetween(b.end, q.start) && !narratedBetween(a.end, lineStart(quotes[para.quotes[0]].start) - 1)) speaker = a.speaker;
      }
      para.speakers.push(speaker);
      result[qi] = speaker;
    });
    const known = para.speakers.filter(Boolean) as string[];
    if (known.length) history.push({ speaker: known.at(-1)!, end, pure });
    else if (!pure) history.length = 0;
  }
  return result;
}
