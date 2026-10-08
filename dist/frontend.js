// src/speech-text.ts
var PROSE_TAGS = new Set(`p div span section article header footer main aside nav address blockquote q cite figure figcaption hgroup ul ol li dl dt dd menu br hr wbr h1 h2 h3 h4 h5 h6 b strong i em u s strike del ins mark small big sub sup abbr acronym dfn kbd samp var time font tt bdi bdo data ruby rb rp rt rtc a table thead tbody tfoot tr td th caption col colgroup label legend fieldset`.split(" "));
var VOID_TAGS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
var ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’" };
var VOCAL_TAGS = ["laugh", "laughter", "chuckle", "chuckles", "giggle", "snicker", "cackle", "cheer", "gasp", "sigh", "sighs", "groan", "grunt", "grr", "growl", "hiss", "moan", "pant", "pff", "phew", "tsk", "whispers", "whispering", "shout", "argh", "whimper", "cry", "sob", "scream", "shriek", "snort", "breath", "heavy breath", "exhales", "cough", "throat-clearing", "sneeze", "yawn", "short pause", "long pause"];
var vocalTags = new Set(VOCAL_TAGS);
function vocalTag(tag) {
  const match = /^<([a-z][a-z\s-]*?)\s*\/?>$/i.exec(tag);
  const name = match?.[1].toLowerCase().trim().replace(/\s+/g, " ");
  return name && vocalTags.has(name) ? `<${name}>` : undefined;
}
function stripVocalTags(text, preserveOffsets = false) {
  return text.replace(/<[^<>]*>/g, (tag) => vocalTag(tag) ? " ".repeat(preserveOffsets ? tag.length : 1) : tag);
}
function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] !== "#")
      return ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 1114111 && !(code >= 55296 && code <= 57343) ? String.fromCodePoint(code) : entity;
  });
}
function sanitizeSpeechText(raw, keepVocalTags = false) {
  const text = decodeEntities(raw).replace(/<!--\s*([a-z0-9_]+)_START\s*-->[\s\S]*?(?:<!--\s*\1_END\s*-->|$)/gi, " ").replace(/<!--[\s\S]*?(?:-->|$)/g, " ").replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, " ").replace(/(`+)[\s\S]*?\1/g, " ");
  const tags = /<(\/?)([a-z][a-z0-9:_-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
  const blocked = [], parts = [];
  let cursor = 0;
  for (const match of text.matchAll(tags)) {
    if (!blocked.length)
      parts.push(text.slice(cursor, match.index), " ");
    const tag = match[2].toLowerCase();
    const vocal = vocalTag(match[0]);
    if (vocal) {
      if (!blocked.length && keepVocalTags)
        parts.push(vocal, " ");
    } else if (match[1]) {
      const index = blocked.lastIndexOf(tag);
      if (index !== -1)
        blocked.splice(index);
    } else if (!PROSE_TAGS.has(tag) && !VOID_TAGS.has(tag) && !/\/\s*>$/.test(match[0]))
      blocked.push(tag);
    cursor = match.index + match[0].length;
  }
  if (!blocked.length)
    parts.push(text.slice(cursor));
  return parts.join("").replace(/<\/?([a-z][a-z0-9:_-]*)(?:\s[^<>]*)?$/gi, " ");
}

// src/pronunciation.ts
var PRONUNCIATION_CUE_PATTERN = String.raw`\[pronounce:[^\]\r\n]*(?:\]|(?=\r?\n)|$)`;
var LIMIT = 500;
var normalized = (s) => s.normalize("NFC").trim().toLowerCase();
var escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var boundary = String.raw`[\p{L}\p{M}\p{N}_-]`;
function clean(value, max) {
  if (typeof value !== "string")
    return "";
  const s = value.normalize("NFC").trim().replace(/[ \t]+/g, " ");
  return s.length && s.length <= max && /^[\p{L}\p{M}\p{N} .’'ʼ\-]+$/u.test(s) && /[\p{L}\p{N}]/u.test(s) ? s : "";
}
function pronunciationEntry(raw, source) {
  if (!raw || typeof raw !== "object")
    return;
  const r = raw, name = clean(r.name, 80), spokenAs = clean(r.spokenAs, 100);
  if (!name || !spokenAs || ["__proto__", "constructor", "prototype", "narrator"].includes(normalized(name)))
    return;
  if (r.aliases !== undefined && (!Array.isArray(r.aliases) || r.aliases.length > 10 || r.aliases.some((v) => !clean(v, 80))))
    return;
  const aliases = Array.isArray(r.aliases) ? [...new Set(r.aliases.slice(0, 10).map((v) => clean(v, 80)).filter((v) => v && normalized(v) !== normalized(name)))] : [];
  return { name, spokenAs, aliases, source };
}
function normalizePronunciations(raw) {
  const result = Object.create(null);
  if (raw && typeof raw === "object")
    for (const value of Object.values(raw).slice(0, LIMIT)) {
      const entry = pronunciationEntry(value, value?.source === "manual" ? "manual" : "automatic");
      if (entry && !result[normalized(entry.name)])
        result[normalized(entry.name)] = entry;
    }
  return result;
}
function stripPronunciationCues(text) {
  return text.replace(new RegExp(PRONUNCIATION_CUE_PATTERN, "gi"), "");
}
function tokens(entries) {
  const map = new Map;
  for (const entry of Object.values(entries).sort((a, b) => Number(a.source === "manual") - Number(b.source === "manual")))
    for (const name of [entry.name, ...entry.aliases])
      map.set(normalized(name), entry.spokenAs);
  return map;
}
function applyPronunciations(text, entries) {
  const map = tokens(entries);
  if (!map.size)
    return text;
  const pattern = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const replace = (s) => s.replace(new RegExp(`(?<!${boundary})(?:${pattern})(?!${boundary})`, "giu"), (name) => map.get(normalized(name)) ?? name);
  return text.split(/(<[^<>]*>)/g).map((s) => s.startsWith("<") ? s : replace(s)).join("");
}

// src/shared.ts
var EMOTIONS = ["neutral", "happy", "sad", "angry", "worried", "curious", "excited", "sarcastic", "tender", "afraid"];
var DELIVERIES = ["normal", "whispers", "shouts", "softly", "slowly", "laughs", "sighs"];
var GEMINI_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"];
var CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]|${PRONUNCIATION_CUE_PATTERN}`;
var DEFAULTS = {
  provider: "openrouter",
  connectionId: "",
  model: "google/gemini-3.8-flash-tts",
  voice: "Kore",
  narratorVoice: "",
  localUrl: "http://localhost:8880/v1",
  enabled: false,
  follow: false,
  earlyPlayback: true,
  promptEmotions: true,
  useEmotions: true,
  promptPronunciations: true,
  personaName: "",
  npcVoice: "",
  inheritVoices: true,
  widgetMinimized: false,
  widgetPosition: null,
  speed: 1,
  volume: 0.85,
  assignments: {}
};
var DEFAULT_SPEECH_RULES = { quoted: "speech", asterisked: "narration", undecorated: "narration" };
function readVoiceRef(raw) {
  if (!raw || typeof raw !== "object")
    return;
  const v = raw;
  if (typeof v.connectionId !== "string" || !v.connectionId || v.connectionId.length > 160)
    return;
  return { connectionId: v.connectionId, voice: typeof v.voice === "string" ? v.voice.slice(0, 160) : "" };
}
function speakerCharacterId(speaker, characters, fallback) {
  const name = speaker.trim().toLowerCase();
  if (name === "narrator")
    return;
  const matches = characters.filter((c) => c.name.trim().toLowerCase() === name);
  return matches.length === 1 ? matches[0].id : fallback;
}
function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const p = r.widgetPosition;
  const widgetPosition = p && typeof p === "object" && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 ? { x: p.x, y: p.y } : null;
  const str = (v, fallback, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : fallback;
  const assignments = {};
  if (r.assignments && typeof r.assignments === "object")
    for (const [key, v] of Object.entries(r.assignments).slice(0, 500)) {
      if (!v || typeof v !== "object" || ["__proto__", "constructor", "prototype"].includes(key))
        continue;
      assignments[key.slice(0, 200)] = { voice: str(v.voice, "", 160), emotion: enumValue(v.emotion, EMOTIONS, "neutral"), delivery: enumValue(v.delivery, DELIVERIES, "normal"), ...typeof v.name === "string" ? { name: str(v.name, "", 80) } : {} };
    }
  return {
    connectionId: str(r.connectionId, "", 160),
    provider: ["lumiverse", "openrouter", "browser", "local"].includes(r.provider ?? "") ? r.provider : DEFAULTS.provider,
    model: str(r.model, DEFAULTS.model),
    voice: str(r.voice, DEFAULTS.voice),
    narratorVoice: str(r.narratorVoice, ""),
    npcVoice: str(r.npcVoice, ""),
    localUrl: str(r.localUrl, DEFAULTS.localUrl, 500),
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULTS.enabled,
    follow: r.follow === true,
    earlyPlayback: r.earlyPlayback !== false,
    promptEmotions: r.promptEmotions !== false,
    useEmotions: r.useEmotions !== false,
    promptPronunciations: r.promptPronunciations !== false,
    personaName: typeof r.personaName === "string" && r.personaName.trim().length <= 80 && !/[\[\]\r\n]/.test(r.personaName) ? r.personaName.trim() : "",
    inheritVoices: r.inheritVoices !== false,
    widgetMinimized: r.widgetMinimized === true,
    widgetPosition,
    speed: clamp(r.speed, 0.5, 2, 1),
    volume: clamp(r.volume, 0, 1, 0.85),
    assignments
  };
}
function clamp(v, min, max, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function enumValue(v, values, fallback) {
  return typeof v === "string" && values.includes(v.toLowerCase()) ? v.toLowerCase() : fallback;
}
function stripCues(text) {
  return text.replace(new RegExp(CUE_PATTERN, "gi"), "");
}
function plainText(text, keepVocalTags = false) {
  return stripPronunciationCues(sanitizeSpeechText(text, keepVocalTags)).replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-+]\s+|\d+\.\s+)/gm, "").replace(/[*_`~]/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function splitSentences(text) {
  const detection = stripVocalTags(text, true);
  return Array.from(new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(detection), (s) => text.slice(s.index, s.index + s.segment.length).trim()).filter(Boolean).flatMap((s) => {
    if (s.length <= 650)
      return [s];
    const chunks = [];
    let chunk = "";
    for (const token of s.match(/<[^<>]+>|\S+/gu) ?? []) {
      for (const word of token.match(/.{1,600}/gu) ?? []) {
        if (chunk && chunk.length + word.length + 1 > 600) {
          chunks.push(chunk);
          chunk = "";
        }
        chunk += (chunk ? " " : "") + word;
      }
    }
    if (chunk)
      chunks.push(chunk);
    return chunks;
  });
}
function parseSegments(raw, defaultSpeaker = "", rules = DEFAULT_SPEECH_RULES) {
  raw = stripPronunciationCues(sanitizeSpeechText(raw, true)).replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const cue = new RegExp(`\\[(emotion|delivery|speaker):([^\\]\\r\\n]{1,80})\\]`, "gi");
  const pieces = [];
  let speaker = defaultSpeaker, explicitSpeaker = false, emotion = "", delivery = "";
  const classify = (text, action) => {
    if (action === "skip")
      return;
    let offset = 0, prefix = "", appended = false;
    const append = (prose) => {
      const text = plainText(prose, true);
      if (!text)
        return;
      if (/^["“”«»]+$/.test(text)) {
        prefix += text;
        return;
      }
      const chosen = explicitSpeaker ? speaker : action === "narration" ? "narrator" : defaultSpeaker;
      const value = { text: prefix + text, speaker: chosen, emotion, delivery };
      prefix = "";
      appended = true;
      const last = pieces.at(-1);
      if (last && last.speaker === value.speaker && last.emotion === emotion && last.delivery === delivery)
        last.text += " " + value.text;
      else
        pieces.push(value);
    };
    for (const match of text.matchAll(cue)) {
      append(text.slice(offset, match.index));
      const value = match[2].trim(), kind = match[1].toLowerCase();
      if (kind === "speaker") {
        speaker = value;
        explicitSpeaker = true;
        emotion = "";
        delivery = "";
      }
      if (kind === "emotion")
        emotion = enumValue(value, EMOTIONS, "neutral");
      if (kind === "delivery")
        delivery = enumValue(value, DELIVERIES, "normal");
      offset = match.index + match[0].length;
    }
    append(text.slice(offset));
    if (prefix && appended)
      pieces.at(-1).text += prefix;
  };
  const pattern = /"[^"\n]*(?:\n[^"\n]*)*"|“[^”]*”|«[^»]*»|(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g;
  const detection = raw.replace(new RegExp(CUE_PATTERN, "gi"), (match) => " ".repeat(match.length));
  let cursor = 0;
  for (const match of detection.matchAll(pattern)) {
    classify(raw.slice(cursor, match.index), rules.undecorated);
    const quoted = match[1] === undefined;
    classify(raw.slice(match.index, match.index + match[0].length), quoted ? rules.quoted : rules.asterisked);
    if (quoted) {
      speaker = defaultSpeaker;
      explicitSpeaker = false;
      emotion = "";
      delivery = "";
    }
    cursor = match.index + match[0].length;
  }
  classify(raw.slice(cursor), rules.undecorated);
  return pieces.flatMap((piece) => splitSentences(piece.text).map((text) => ({ ...piece, text })));
}
function selectVoice(settings, segment, characterId) {
  const byName = settings.assignments[`name:${segment.speaker.toLowerCase()}`];
  const narrator = segment.speaker.toLowerCase() === "narrator";
  const card = characterId && !narrator ? settings.assignments[`id:${characterId}`] : undefined;
  const assigned = byName ?? card;
  return {
    voice: (narrator ? settings.narratorVoice : assigned?.voice) || settings.voice,
    emotion: settings.useEmotions ? segment.emotion || assigned?.emotion || "neutral" : "neutral",
    delivery: settings.useEmotions ? segment.delivery || assigned?.delivery || "normal" : "normal"
  };
}
function speechInput(segment, assignment, supportsTags, supportsVocalTags = false) {
  const text = supportsVocalTags ? segment.text : stripVocalTags(segment.text).replace(/\s+/g, " ").trim();
  if (!supportsTags)
    return text;
  const emotionTag = { happy: "happy", sad: "sad", angry: "angry", worried: "worried", curious: "curious", excited: "excited", sarcastic: "sarcastic", tender: "warmly", afraid: "scared" };
  const cues = [];
  if (emotionTag[assignment.emotion])
    cues.push(`[${emotionTag[assignment.emotion]}]`);
  if (assignment.delivery !== "normal")
    cues.push(`[${assignment.delivery}]`);
  return [...cues, text].join(" ");
}
function needsPcm(settings) {
  return settings.provider === "openrouter" && /^google\/gemini-.*tts/i.test(settings.model);
}
function speechRequest(settings, segment, characterId) {
  const assignment = selectVoice(settings, segment, characterId);
  const openrouter = settings.provider === "openrouter";
  const gemini38 = openrouter && /^google\/gemini-3\.8.*tts/.test(settings.model);
  const legacyTags = openrouter && /^google\/gemini-3\.1.*tts/.test(settings.model);
  const body = { model: settings.model, voice: assignment.voice, input: speechInput(segment, assignment, legacyTags, gemini38), response_format: needsPcm(settings) ? "pcm" : "mp3" };
  if (gemini38) {
    const emotions = { happy: "happy and cheerful", sad: "sad", angry: "angry", worried: "worried", curious: "curious", excited: "excited", sarcastic: "sarcastic", tender: "warm and tender", afraid: "afraid" };
    const deliveries = { whispers: "whispering", shouts: "shouting", softly: "soft-spoken", slowly: "slow and deliberate", laughs: "with a light laugh", sighs: "with a sigh" };
    const style = [emotions[assignment.emotion], deliveries[assignment.delivery]].filter(Boolean).join(", ");
    if (style)
      body.provider = { options: { "google-ai-studio": { speech_metadata: { style } } } };
  }
  return body;
}

// src/highlight.ts
function canon(c) {
  return /\s/.test(c) ? " " : c.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
}
function normalizeText(text) {
  return Array.from(text).map(canon).join("").replace(/\s+/g, " ").trim();
}
function locateText(text, phrase, cursor = 0) {
  const exact = normalizeText(phrase);
  const words = exact.replace(/^["'«»\s]+|["'«»\s]+$/g, "");
  let closest = null;
  for (const needle of exact === words ? [exact] : [exact, words]) {
    if (!needle)
      continue;
    const offset = text.indexOf(needle, cursor);
    if (offset >= 0 && (!closest || offset < closest.offset))
      closest = { offset, length: needle.length };
  }
  return closest;
}
function indexText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('button,pre,code,script,style,[aria-hidden="true"],[data-ra-ui],[data-spindle-extension-root],[data-spindle-ext]'))
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let text = "";
  const points = [];
  let lastBlock = null;
  for (let node = walker.nextNode();node; node = walker.nextNode()) {
    const block = node.parentElement?.closest("p,li,blockquote,h1,h2,h3,h4,h5,h6,td") ?? null;
    if (text && block !== lastBlock && !text.endsWith(" ")) {
      text += " ";
      points.push({ node, offset: 0 });
    }
    lastBlock = block;
    const value = node.textContent ?? "";
    for (let i = 0;i < value.length; i++) {
      const ch = canon(value[i]);
      if (ch === " " && text.endsWith(" "))
        continue;
      text += ch;
      points.push({ node, offset: i });
    }
  }
  return { text, points };
}
function findTextRange(root, phrase, cursor = 0) {
  const index = indexText(root), match = locateText(index.text, phrase, cursor);
  if (!match)
    return null;
  const { offset: at, length } = match;
  const a = index.points[at], b = index.points[at + length - 1];
  if (!a || !b)
    return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset + 1);
  return { range, next: at + length };
}

class PassageMarker {
  onVisible;
  ranges = [];
  overlay = document.createElement("div");
  frame = 0;
  getRoot = null;
  text = "";
  cursor = 0;
  start = 0;
  disposed = false;
  refreshAt = 0;
  constructor(onVisible) {
    this.onVisible = onVisible;
    this.overlay.className = "ra-marker-overlay";
    this.overlay.dataset.raUi = "true";
    this.overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.overlay);
  }
  reset() {
    this.clear();
    this.cursor = 0;
    this.start = 0;
  }
  mark(getRoot, text) {
    this.getRoot = getRoot;
    this.text = text;
    this.start = this.cursor;
    const found = this.refresh();
    if (found)
      this.cursor = found.next;
    if (!this.frame)
      this.frame = requestAnimationFrame(this.tick);
  }
  tick = (now) => {
    if (this.disposed || !this.getRoot) {
      this.frame = 0;
      return;
    }
    if (now - this.refreshAt > 250) {
      this.refresh();
      this.refreshAt = now;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  refresh() {
    const root = this.getRoot?.();
    const found = root ? findTextRange(root, this.text, this.start) : null;
    const css = CSS;
    this.overlay.replaceChildren();
    this.ranges = found ? [found.range] : [];
    const Highlight = window.Highlight;
    if (css.highlights && Highlight) {
      css.highlights.delete("lumiverse-readalong");
      if (found)
        css.highlights.set("lumiverse-readalong", new Highlight(found.range));
    } else if (found) {
      for (const rect of found.range.getClientRects()) {
        const block = document.createElement("div");
        block.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(245,190,80,.26);border-bottom:2px solid #e7b24c;border-radius:3px;pointer-events:none;`;
        this.overlay.appendChild(block);
      }
    }
    this.onVisible?.(!!found);
    return found;
  }
  follow() {
    const range = this.ranges[0];
    if (!range)
      return;
    const rect = range.getBoundingClientRect();
    if (rect.top < 100 || rect.bottom > window.innerHeight - 130)
      range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  clear() {
    this.getRoot = null;
    this.text = "";
    this.ranges = [];
    this.overlay.replaceChildren();
    CSS.highlights?.delete("lumiverse-readalong");
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  dispose() {
    this.disposed = true;
    this.clear();
    this.overlay.remove();
  }
}

// src/prepared-audio.ts
function waveHeader(size, rate = 24000, channels = 1, bits = 16) {
  const bytes = new Uint8Array(44), view = new DataView(bytes.buffer);
  const text = (offset, s) => {
    for (let i = 0;i < s.length; i++)
      bytes[offset + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, size + 36, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true);
  view.setUint16(34, bits, true);
  text(36, "data");
  view.setUint32(40, size, true);
  return bytes;
}
async function readWave(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const text = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (text(0) !== "RIFF" || text(8) !== "WAVE")
    return;
  const view = new DataView(bytes.buffer);
  let format;
  for (let at = 12;at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true), kind = text(at), offset = at + 8;
    if (kind === "fmt " && size >= 16 && offset + 16 <= bytes.length && view.getUint16(offset, true) === 1) {
      const channels = view.getUint16(offset + 2, true), rate = view.getUint32(offset + 4, true), bits = view.getUint16(offset + 14, true);
      if (channels >= 1 && channels <= 8 && rate >= 8000 && rate <= 192000 && [8, 16, 24, 32].includes(bits))
        format = { rate, channels, bits };
    }
    if (kind === "data" && format) {
      const frameBytes = format.channels * format.bits / 8;
      if (!size || offset + size > blob.size || size % frameBytes)
        throw new Error("The speech provider returned incomplete WAV audio.");
      return { ...format, offset, size };
    }
    at = offset + size + size % 2;
  }
}
async function pcmBlobToWav(blob, type = "audio/pcm") {
  const first = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (String.fromCharCode(...first.subarray(0, 4)) === "RIFF" && String.fromCharCode(...first.subarray(8, 12)) === "WAVE")
    return blob.slice(0, blob.size, "audio/wav");
  const param = (name, fallback) => {
    const match = type.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*"?([^;"\\s]+)`, "i"));
    return match ? Number(match[1]) : fallback;
  };
  const rate = param("rate", 24000), channels = param("channels", 1);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || channels !== 1)
    throw new Error("OpenRouter returned unsupported PCM sample settings.");
  if (!blob.size || blob.size % 2)
    throw new Error("OpenRouter returned empty or incomplete PCM audio.");
  if (blob.size > 4294967295 - 36)
    throw new Error("This audio exceeds the WAV file format limit.");
  return new Blob([waveHeader(blob.size, rate), blob], { type: "audio/wav" });
}
function audioBlob(data) {
  if (data.blob)
    return data.blob;
  const bytes = data.bytes ?? Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: data.mime });
}
async function prepareClip(data, signal, createAudio = () => new Audio) {
  signal?.throwIfAborted();
  const blob = audioBlob(data), wave = await readWave(blob);
  signal?.throwIfAborted();
  if (wave)
    return { blob, wave, duration: wave.size / (wave.rate * wave.channels * wave.bits / 8) };
  const audio = createAudio(), url = URL.createObjectURL(blob);
  try {
    const duration = await new Promise((resolve, reject) => {
      const abort = () => done(() => reject(signal?.reason ?? new DOMException("Stopped", "AbortError")));
      const timer = setTimeout(() => done(() => reject(new Error("Could not read the prepared audio file."))), 15000);
      const done = (work) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        work();
      };
      audio.onloadedmetadata = () => done(() => Number.isFinite(audio.duration) && audio.duration > 0 ? resolve(audio.duration) : reject(new Error("The provider returned audio without a usable duration.")));
      audio.onerror = () => done(() => reject(new Error("The speech provider returned audio this browser cannot play.")));
      signal?.addEventListener("abort", abort, { once: true });
      audio.preload = "metadata";
      audio.src = url;
    });
    signal?.throwIfAborted();
    return { blob, duration };
  } finally {
    audio.onloadedmetadata = null;
    audio.onerror = null;
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
function joinPrepared(clips) {
  if (!clips.length)
    return [];
  const first = clips[0].wave, total = clips.reduce((sum, c) => sum + (c.wave?.size ?? 0), 0);
  if (first && total <= 4294967295 - 36 && clips.every((c) => c.wave && c.wave.rate === first.rate && c.wave.channels === first.channels && c.wave.bits === first.bits)) {
    return [{ blob: new Blob([waveHeader(total, first.rate, first.channels, first.bits), ...clips.map((c) => c.blob.slice(c.wave.offset, c.wave.offset + c.wave.size))], { type: "audio/wav" }), duration: clips.reduce((sum, c) => sum + c.duration, 0) }];
  }
  return clips;
}

class PreparedPlayer {
  factory;
  urls;
  audio;
  next = null;
  tracks = [];
  durations = [];
  index = 0;
  running = false;
  finished = false;
  generation = 0;
  speed = 1;
  volume = 0.85;
  primed = false;
  complete = true;
  waiting = false;
  started = false;
  playEpoch = 0;
  pendingPlay = null;
  onEnded = () => {};
  onError = () => {};
  onWaiting = () => {};
  constructor(factory = () => new Audio, urls = { create: URL.createObjectURL.bind(URL), revoke: URL.revokeObjectURL.bind(URL) }) {
    this.factory = factory;
    this.urls = urls;
    this.audio = factory();
  }
  unlock() {
    if (this.primed || this.tracks.length)
      return;
    this.primed = true;
    const silent = new Blob([waveHeader(2), new Uint8Array(2)], { type: "audio/wav" }), url = this.urls.create(silent), audio = this.audio;
    audio.src = url;
    const generation = this.generation;
    audio.play().then(() => {
      if (generation === this.generation && !this.tracks.length)
        audio.pause();
    }).catch(() => {}).finally(() => this.urls.revoke(url));
  }
  load(clips) {
    this.clear();
    this.durations = clips.map((c) => c.duration);
    this.tracks = joinPrepared(clips).map((c) => ({ url: this.urls.create(c.blob), duration: c.duration }));
    if (this.tracks.length)
      this.activate(0);
  }
  begin(clips) {
    this.load(clips);
    this.complete = false;
  }
  append(clips, complete = true) {
    this.durations.push(...clips.map((c) => c.duration));
    this.tracks.push(...joinPrepared(clips).map((c) => ({ url: this.urls.create(c.blob), duration: c.duration })));
    this.complete = complete;
    if (this.waiting && this.index + 1 < this.tracks.length) {
      this.onWaiting(false);
      if (this.running) {
        this.waiting = false;
        this.advance();
      }
    } else if (this.waiting && complete) {
      this.waiting = false;
      this.running = false;
      this.finished = true;
      this.onWaiting(false);
      this.onEnded();
    } else
      this.preloadNext();
  }
  get hasStarted() {
    return this.started;
  }
  configure(audio) {
    audio.preload = "auto";
    audio.volume = this.volume;
    audio.playbackRate = this.speed;
  }
  activate(index) {
    this.index = index;
    this.configure(this.audio);
    if (this.audio.src !== this.tracks[index].url)
      this.audio.src = this.tracks[index].url;
    const generation = this.generation, audio = this.audio;
    this.audio.onended = () => {
      if (generation !== this.generation || audio !== this.audio || index !== this.index || !this.running)
        return;
      if (this.index + 1 === this.tracks.length) {
        if (!this.complete) {
          this.waiting = true;
          this.onWaiting(true);
          return;
        }
        this.running = false;
        this.finished = true;
        this.onEnded();
        return;
      }
      this.advance();
    };
    this.audio.onerror = () => {
      if (generation === this.generation && audio === this.audio) {
        this.running = false;
        this.onError(new Error("The prepared audio file could not be played."));
      }
    };
    this.preloadNext();
  }
  preloadNext() {
    if (!this.next && this.index + 1 < this.tracks.length) {
      this.next = this.factory();
      this.configure(this.next);
      this.next.src = this.tracks[this.index + 1].url;
    }
  }
  advance() {
    const generation = this.generation, old = this.audio;
    old.onended = null;
    old.onerror = null;
    old.removeAttribute("src");
    old.load();
    this.audio = this.next ?? this.factory();
    this.next = null;
    this.activate(this.index + 1);
    this.play().catch(() => {
      if (generation === this.generation) {
        this.running = false;
        this.onError(new Error("Prepared audio is ready. Press Resume to continue playback."));
      }
    });
  }
  get duration() {
    return this.durations.reduce((sum, n) => sum + n, 0);
  }
  get elapsed() {
    return this.finished ? this.duration : Math.min(this.duration, this.tracks.slice(0, this.index).reduce((sum, c) => sum + c.duration, 0) + (this.tracks.length ? this.audio.currentTime : 0));
  }
  get position() {
    const elapsed = this.elapsed;
    let index = 0, start = 0;
    while (index + 1 < this.durations.length && start + this.durations[index] <= elapsed + 0.0000001)
      start += this.durations[index++];
    const seconds = Math.max(0, elapsed - start), length = this.durations[index] ?? 0;
    return { index, seconds, fraction: length ? Math.min(1, seconds / length) : 0, elapsed, duration: this.duration };
  }
  play() {
    if (this.finished)
      this.rewind();
    if (this.pendingPlay)
      return this.pendingPlay;
    if (!this.tracks.length)
      throw new Error("No prepared audio is available.");
    if (this.waiting) {
      if (this.index + 1 < this.tracks.length) {
        this.waiting = false;
        this.onWaiting(false);
        this.advance();
        return this.pendingPlay;
      }
      this.running = true;
      return Promise.resolve(true);
    }
    const generation = this.generation, epoch = ++this.playEpoch;
    const pending = (async () => {
      try {
        await this.audio.play();
      } catch (error) {
        if (generation !== this.generation || epoch !== this.playEpoch)
          return false;
        const blocked = error instanceof Error && error.name === "NotAllowedError";
        throw new Error(`${blocked ? "Your browser blocked playback." : "Playback could not start."} Press Play again; the prepared audio is reused and no speech is requested.`);
      }
      if (generation !== this.generation || epoch !== this.playEpoch)
        return false;
      this.running = true;
      this.started = true;
      return true;
    })();
    this.pendingPlay = pending;
    pending.finally(() => {
      if (this.pendingPlay === pending)
        this.pendingPlay = null;
    }).catch(() => {});
    return pending;
  }
  pause() {
    this.playEpoch++;
    this.pendingPlay = null;
    this.audio.pause();
    this.running = false;
  }
  setSpeed(speed) {
    this.speed = Math.max(0.5, Math.min(2, speed));
    this.audio.playbackRate = this.speed;
    if (this.next)
      this.next.playbackRate = this.speed;
  }
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.audio.volume = this.volume;
    if (this.next)
      this.next.volume = this.volume;
  }
  rewind() {
    this.pause();
    this.finished = false;
    this.waiting = false;
    if (this.index === 0)
      this.audio.currentTime = 0;
    else {
      this.next?.removeAttribute("src");
      this.next?.load();
      this.next = null;
      this.activate(0);
    }
  }
  clear() {
    this.generation++;
    this.pause();
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.removeAttribute("src");
    this.audio.load();
    this.next?.removeAttribute("src");
    this.next?.load();
    this.next = null;
    for (const track of this.tracks)
      this.urls.revoke(track.url);
    this.tracks = [];
    this.durations = [];
    this.index = 0;
    this.finished = false;
    this.complete = true;
    this.waiting = false;
    this.started = false;
  }
  dispose() {
    this.clear();
  }
}

// src/provider-errors.ts
function redactSecrets(message, secret) {
  if (secret)
    for (const value of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]))
      message = message.split(value).join("[redacted]");
  return message.replace(/Bearer\s+[^\s"']+|sk-or-v1-[^\s"']+|\bsk-[a-z0-9_-]{8,}|\bAIza[a-z0-9_-]{20,}/gi, "[redacted]").replace(/((?:api[_ -]?key|authorization|access[_ -]?token|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
}
function nativeProviderError(status, body) {
  let message = "";
  try {
    const data = JSON.parse(body);
    message = typeof data.error === "string" ? data.error : data.error?.message ?? data.message ?? "";
  } catch {}
  const hints = [
    [/only supports.*pcm|response_format.*pcm/i, "This Gemini model requires PCM audio."],
    [/insufficient.*credit|credit.*(?:exhaust|balance)|payment required/i, "Check your speech credit and spending limit."],
    [/api.?key|unauthori[sz]ed|authentication|credential/i, "Check the saved API key in Lumiverse’s voice settings."],
    [/rate.?limit|too many requests/i, "The provider is rate limited. Wait before trying again."],
    [/voice.*(?:reject|invalid|unsupported|not found)/i, "Check that the selected voice is supported by this model."],
    [/model.*(?:unavailable|not found|unsupported|access)/i, "Check model availability and access for this connection."]
  ];
  const hint = hints.find(([pattern]) => pattern.test(String(message)))?.[1];
  return `${status >= 400 ? providerError("Lumiverse TTS", status, "") : "Lumiverse could not complete the TTS request."}${hint ? ` ${hint}` : ""}`;
}
function providerError(label, status, body, secret) {
  let detail = "";
  try {
    const data = JSON.parse(body);
    const error = data?.error;
    detail = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "";
  } catch {}
  detail = redactSecrets(detail, secret).replace(/[\u0000-\u001f]/g, " ").slice(0, 600);
  const hints = {
    400: "Check the selected model, voice, and output format.",
    401: "Save a valid API key for this connection.",
    402: "Check your speech credit and API key spending limit.",
    403: "Check this key’s access to the selected model and provider.",
    404: "Check model availability and provider routing in your account.",
    429: "The provider is rate limited. Wait before trying again."
  };
  return `${label} returned HTTP ${status}${detail ? `: ${detail}` : "."}${hints[status] ? ` ${hints[status]}` : ""}`;
}

// src/native-tts.ts
var API = "/api/v1";
async function boundedBytes(response, limit) {
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("Lumiverse returned an oversized speech response.");
  if (!response.body)
    return new Uint8Array;
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      size += value.length;
      if (size > limit)
        throw new Error("Lumiverse returned an oversized speech response.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function style(emotion, delivery) {
  const values = { happy: "happy and cheerful", sad: "sad", angry: "angry", worried: "worried", curious: "curious", excited: "excited", sarcastic: "sarcastic", tender: "warm and tender", afraid: "afraid", whispers: "whispering", shouts: "shouting", softly: "soft-spoken", slowly: "slow and deliberate", laughs: "with a light laugh", sighs: "with a sigh" };
  return [values[emotion], values[delivery]].filter(Boolean).join(", ");
}
function nativeSpeechRequest(connection, settings, segment, characterId) {
  const assignment = selectVoice(settings, segment, characterId), model = settings.model || connection.model;
  const openrouter = connection.provider === "openrouter_tts";
  const gemini = /gemini-.*tts/i.test(model);
  const legacyTags = gemini && /gemini-3\.1/i.test(model);
  const direction = style(assignment.emotion, assignment.delivery);
  const parameters = {};
  if (openrouter && gemini)
    parameters.speed = 1;
  if (/gpt-4o-mini-tts/i.test(model) && ["openrouter_tts", "openai_tts"].includes(connection.provider) && direction)
    parameters.instructions = `Speak ${direction}.`;
  return {
    connectionId: connection.id,
    text: speechInput(segment, assignment, legacyTags, gemini && /gemini-3\.8/i.test(model)),
    voice: assignment.voice || connection.voice,
    model,
    parameters,
    outputFormat: openrouter && gemini ? "pcm" : connection.outputFormat
  };
}
function createNativeTtsClient(transport = fetch) {
  async function request(path, options = {}) {
    return transport(`${API}${path}`, { ...options, credentials: "include", redirect: "error", signal: options.signal ?? AbortSignal.timeout(70000) });
  }
  async function readJson(response) {
    const text = new TextDecoder().decode(await boundedBytes(response, 1024 * 1024));
    if (!response.ok)
      throw new Error(nativeProviderError(response.status, text));
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Lumiverse returned an unexpected TTS response.");
    }
    if (typeof data.error === "string")
      throw new Error(nativeProviderError(response.status, text));
    return data;
  }
  return {
    async preferences() {
      const result = await readJson(await request("/settings/voiceSettings"));
      const value = result.value && typeof result.value === "object" ? result.value : {};
      const raw = value.speechDetectionRules ?? {}, rules = { ...DEFAULT_SPEECH_RULES };
      for (const key of ["quoted", "asterisked", "undecorated"]) {
        const allowed = key === "asterisked" ? ["thought", "narration", "skip"] : ["speech", "narration", "skip"];
        if (allowed.includes(raw[key]))
          rules[key] = raw[key];
      }
      return { rules, narrationVoice: readVoiceRef(value.narrationVoice) };
    },
    async connections() {
      const all = [];
      for (let offset = 0;offset < 2000; offset += 200) {
        const result = await readJson(await request(`/tts-connections?limit=200&offset=${offset}`));
        if (!Array.isArray(result.data))
          throw new Error("This Lumiverse build did not return its TTS connections.");
        for (const p of result.data)
          if (typeof p.id === "string" && typeof p.provider === "string")
            all.push({ id: p.id, name: p.name || p.id, provider: p.provider, model: p.model || "", voice: p.voice || "", outputFormat: p.default_parameters?.output_format });
        if (result.data.length < 200 || typeof result.total === "number" && offset + result.data.length >= result.total)
          break;
      }
      return all;
    },
    async models(id) {
      const result = await readJson(await request(`/tts-connections/${encodeURIComponent(id)}/models`));
      return (Array.isArray(result.models) ? result.models : []).filter((m) => typeof m.id === "string").map((m) => ({ id: m.id, name: m.label || m.id, voices: [] }));
    },
    async voices(id) {
      const result = await readJson(await request(`/tts-connections/${encodeURIComponent(id)}/voices`));
      return (Array.isArray(result.voices) ? result.voices : []).map((v) => typeof v === "string" ? v : v.id).filter((v) => typeof v === "string");
    },
    async check(id) {
      const result = await readJson(await request(`/tts-connections/${encodeURIComponent(id)}/test`, { method: "POST" }));
      if (result.success !== true)
        throw new Error(`Connection check failed. ${nativeProviderError(200, JSON.stringify({ error: result.message }))}`);
      return "Lumiverse accepts this saved TTS connection. Click Listen to test a voice. No speech was generated.";
    },
    async speech(connection, settings, segment, characterId, signal) {
      const body = nativeSpeechRequest(connection, settings, segment, characterId);
      const response = await request("/tts/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      const mime = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || mime.includes("json")) {
        const text = new TextDecoder().decode(await boundedBytes(response, 64 * 1024));
        throw new Error(nativeProviderError(response.status, text));
      }
      if (!mime.startsWith("audio/") && !mime.startsWith("application/ogg"))
        throw new Error("Lumiverse returned an unsupported speech response.");
      const blob = await response.blob();
      signal?.throwIfAborted();
      if (!blob.size)
        throw new Error("Lumiverse returned no speech audio.");
      if (mime.startsWith("audio/pcm") || mime.startsWith("audio/x-pcm"))
        return { blob: await pcmBlobToWav(blob, mime), mime: "audio/wav" };
      return { blob, mime };
    }
  };
}

// src/playback-plan.ts
var MAX_PASSAGE_CHARS = 3000;
var MAX_NATIVE_PASSAGE_CHARS = 12000;
var firstName = (name) => name.split("||")[0].trim().toLowerCase();
function isUnvoicedExtra(speaker, settings, context) {
  const name = speaker.trim().toLowerCase();
  if (!name || name === "narrator" || settings.assignments[`name:${name}`])
    return false;
  if (context.mainSpeaker && firstName(context.mainSpeaker) === name)
    return false;
  if (context.characters.some((c) => firstName(c.name) === name || c.name.trim().toLowerCase() === name))
    return false;
  return true;
}
function planSpeech(segments, settings, context) {
  const passages = [];
  let previousKey = "";
  for (const source of segments) {
    let segment = source;
    const narrator = segment.speaker.trim().toLowerCase() === "narrator";
    const npc = !!settings.npcVoice && !narrator && isUnvoicedExtra(segment.speaker, settings, context);
    const characterId = npc ? undefined : speakerCharacterId(segment.speaker, context.characters, context.characterId);
    const assignment = selectVoice(settings, segment, characterId);
    if (npc)
      assignment.voice = settings.npcVoice;
    const explicit = settings.assignments[`name:${segment.speaker.toLowerCase()}`]?.voice || !narrator && characterId && settings.assignments[`id:${characterId}`]?.voice;
    let snapshot = { ...settings, assignments: {}, narratorVoice: "", voice: assignment.voice };
    if (settings.provider === "lumiverse" && settings.inheritVoices && !(narrator ? settings.narratorVoice : explicit)) {
      const speech = readVoiceRef(characterId ? context.overrides?.characters?.[characterId] : undefined) ?? context.characters.find((c) => c.id === characterId)?.ttsVoice;
      const inherited = narrator ? readVoiceRef(context.overrides?.narrator) ?? context.narrationVoice ?? speech : speech;
      const connection = context.connections?.find((c) => c.id === inherited?.connectionId);
      if (connection && inherited)
        snapshot = { ...snapshot, connectionId: connection.id, model: connection.model || settings.model, voice: inherited.voice || connection.voice || assignment.voice };
    }
    if (snapshot.provider === "browser" || !/gemini-3\.8.*tts/i.test(snapshot.model)) {
      segment = { ...source, text: stripVocalTags(source.text).replace(/\s+/g, " ").trim() };
      if (!segment.text || /^["“”«»\s]+$/.test(segment.text))
        continue;
    }
    const styleSupported = /gemini-3\.1.*tts|gpt-4o-mini-tts/i.test(snapshot.model) && snapshot.provider !== "browser";
    const emotion = styleSupported ? assignment.emotion : "neutral", delivery = styleSupported ? assignment.delivery : "normal";
    const key = JSON.stringify([snapshot.provider, snapshot.connectionId, snapshot.model, snapshot.voice, emotion, delivery]);
    const limit = snapshot.provider === "lumiverse" && /gemini-.*tts/i.test(snapshot.model) ? MAX_NATIVE_PASSAGE_CHARS : MAX_PASSAGE_CHARS;
    const audioText = applyPronunciations(segment.text, context.pronunciations ?? {});
    for (const text of audioText.length <= limit ? [audioText] : splitSentences(audioText)) {
      const last = passages.at(-1);
      if (last && previousKey === key && last.segment.text.length + text.length + 1 <= limit) {
        last.segment.text += " " + text;
        if (last.segments.at(-1) !== segment)
          last.segments.push(segment);
      } else
        passages.push({ segment: { ...segment, text, emotion, delivery }, segments: [segment], settings: snapshot, voice: snapshot.voice });
      previousKey = key;
    }
  }
  return passages;
}
async function prepareAll(items, prepare, signal, progress, concurrency = 3) {
  const abort = new AbortController, combined = AbortSignal.any([signal, abort.signal]);
  const results = new Array(items.length);
  let next = 0, completed = 0, firstError;
  const worker = async () => {
    try {
      while (next < items.length) {
        combined.throwIfAborted();
        const index = next++;
        results[index] = await prepare(items[index], index, combined);
        combined.throwIfAborted();
        progress(++completed);
      }
    } catch (error) {
      if (firstError === undefined)
        firstError = error;
      abort.abort();
      throw error;
    }
  };
  await Promise.allSettled(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  if (firstError !== undefined)
    throw firstError;
  signal.throwIfAborted();
  return results;
}
function estimatedSentenceIndex(passage, fraction) {
  const weights = passage.segments.map((s) => Math.max(1, stripVocalTags(s.text).replace(/[^\p{L}\p{N}]/gu, "").length) + 12 * splitSentences(s.text).length);
  const target = Math.max(0, Math.min(0.999999, fraction)) * weights.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0;i < weights.length; i++) {
    sum += weights[i];
    if (target < sum)
      return i;
  }
  return weights.length - 1;
}

// src/audio-cache.ts
async function preparationHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
function validClips(value) {
  return Array.isArray(value) && value.length > 0 && value.every((c) => c?.blob instanceof Blob && c.blob.size > 0 && Number.isFinite(c.duration) && c.duration > 0);
}

class AudioCache {
  factory;
  name;
  maxBytes;
  maxEntries;
  constructor(factory = globalThis.indexedDB, name = "lumiverse-readalong-audio-v1", maxBytes = 256 * 1024 * 1024, maxEntries = 3) {
    this.factory = factory;
    this.name = name;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }
  async open() {
    if (!this.factory)
      throw new Error("Saved audio is unavailable in this browser.");
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error("Saved audio storage did not respond."));
      }, 1e4);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("audio", { keyPath: "id" });
        store.createIndex("user", "userId");
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled)
          request.result.close();
        else {
          settled = true;
          resolve(request.result);
        }
      };
      request.onerror = () => {
        clearTimeout(timer);
        settled = true;
        reject(request.error ?? new Error("Saved audio storage failed."));
      };
      request.onblocked = () => {
        clearTimeout(timer);
        settled = true;
        reject(new Error("Saved audio storage is blocked."));
      };
    });
  }
  async get(userId, key) {
    if (!userId)
      return;
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("audio", "readonly").objectStore("audio").get(`${userId}:${key}`);
        request.onsuccess = () => {
          const record = request.result;
          resolve(record?.userId === userId && validClips(record.clips) ? record.clips : undefined);
        };
        request.onerror = () => reject(request.error ?? new Error("Could not read saved audio."));
      });
    } finally {
      db.close();
    }
  }
  async put(userId, key, clips) {
    if (!userId || !validClips(clips))
      return false;
    const bytes = clips.reduce((n, c) => n + c.blob.size, 0);
    if (bytes > this.maxBytes)
      return false;
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("audio", "readwrite"), store = tx.objectStore("audio");
        tx.oncomplete = () => resolve(true);
        tx.onabort = () => reject(tx.error ?? new Error("Could not save audio."));
        const request = store.index("user").getAll(userId);
        request.onsuccess = () => {
          const rows = request.result;
          const record = { id: `${userId}:${key}`, userId, clips, bytes, at: Math.max(Date.now(), ...rows.map((r) => r.at + 1)) };
          const older = rows.filter((r) => r.id !== record.id).sort((a, b) => b.at - a.at);
          let total = bytes, count = 1;
          store.put(record);
          for (const row of older) {
            if (count >= this.maxEntries || total + row.bytes > this.maxBytes)
              store.delete(row.id);
            else {
              total += row.bytes;
              count++;
            }
          }
        };
      });
    } finally {
      db.close();
    }
  }
}

// src/widget-layout.ts
var PAD = 12;
function widgetDimensions(viewport, minimized, touch) {
  const availableWidth = Math.max(1, viewport.width - PAD * 2);
  const width = Math.min(minimized && !touch ? 240 : 320, availableWidth);
  const narrow = minimized && width < 220;
  const height = Math.min(minimized ? narrow ? 112 : touch ? 64 : 56 : width < 280 ? 240 : touch ? 164 : 140, Math.max(1, viewport.height - PAD * 2));
  return { width, height, narrow };
}
function widgetPosition(viewport, size, preferred) {
  const maxX = Math.max(0, viewport.width - size.width), maxY = Math.max(0, viewport.height - size.height);
  const padX = Math.min(PAD, maxX / 2), padY = Math.min(PAD, maxY / 2);
  return { x: Math.max(padX, Math.min(preferred?.x ?? viewport.width - size.width - 24, maxX - padX)), y: Math.max(padY, Math.min(preferred?.y ?? viewport.height - size.height - 36, maxY - padY)) };
}

// src/playback-ui.ts
function patchPlaybackChildren(parent, ...children) {
  const patch = (old, next) => {
    if (old.nodeType !== next.nodeType)
      return next;
    if (old instanceof HTMLElement && next instanceof HTMLElement) {
      if (old.tagName !== next.tagName || old.dataset.raControl !== next.dataset.raControl)
        return next;
      for (const attr of [...old.attributes])
        if (!next.hasAttribute(attr.name))
          old.removeAttribute(attr.name);
      for (const attr of [...next.attributes])
        if (old.getAttribute(attr.name) !== attr.value)
          old.setAttribute(attr.name, attr.value);
      old.onclick = next.onclick;
      old.oninput = next.oninput;
      old.onchange = next.onchange;
      if (old instanceof HTMLButtonElement && next instanceof HTMLButtonElement)
        old.disabled = next.disabled;
      if (old instanceof HTMLInputElement && next instanceof HTMLInputElement) {
        old.checked = next.checked;
        if (old.value !== next.value)
          old.value = next.value;
      }
      sync(old, [...next.childNodes]);
      if (old instanceof HTMLSelectElement && next instanceof HTMLSelectElement)
        old.value = next.value;
      return old;
    }
    if (old.nodeType === Node.TEXT_NODE) {
      if (old.textContent !== next.textContent)
        old.textContent = next.textContent;
      return old;
    }
    return next;
  };
  const sync = (target, nodes) => {
    nodes.forEach((node, i) => {
      const old = target.childNodes[i], replacement = old ? patch(old, node) : node;
      if (old !== replacement) {
        if (old)
          target.replaceChild(replacement, old);
        else
          target.appendChild(replacement);
      }
    });
    while (target.childNodes.length > nodes.length)
      target.lastChild.remove();
  };
  sync(parent, children);
}

// src/early-playback.ts
var EARLY_PLAYBACK_FRACTION = 0.75;
var EARLY_PLAYBACK_SECONDS = 30;
function earlyPlaybackPrefix(texts, clips) {
  let count = 0, chars = 0, seconds = 0;
  while (count < texts.length && clips[count]) {
    chars += texts[count].length;
    seconds += clips[count].duration;
    count++;
  }
  if (count === texts.length)
    return count;
  const total = texts.reduce((sum, text) => sum + text.length, 0);
  return total > 0 && chars / total >= EARLY_PLAYBACK_FRACTION && seconds >= EARLY_PLAYBACK_SECONDS ? count : 0;
}

// src/auto-preparation.ts
class CompletionInbox {
  pending = new Map;
  enabled;
  since;
  constructor(now = Date.now()) {
    this.since = now;
  }
  initialize(enabled) {
    this.enabled = enabled;
    if (!enabled)
      this.pending.clear();
  }
  reset(now = Date.now()) {
    this.since = now;
    this.pending.clear();
  }
  setEnabled(enabled, now = Date.now()) {
    this.enabled = enabled;
    this.reset(now);
  }
  receive(reply) {
    if (this.enabled === false || reply.message.isUser || reply.completedAt < this.since)
      return false;
    const prior = this.pending.get(reply.chatId);
    if (prior && prior.completedAt > reply.completedAt)
      return false;
    this.pending.set(reply.chatId, reply);
    while (this.pending.size > 20)
      this.pending.delete(this.pending.keys().next().value);
    return true;
  }
  take(chatId) {
    if (this.enabled !== true)
      return;
    const reply = this.pending.get(chatId);
    this.pending.delete(chatId);
    return reply;
  }
}

// src/frontend.ts
var STYLE = `
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
var ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  stop: "M6 6h12v12H6z",
  replay: "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  minimize: "M19 13H5v-2h14v2z",
  expand: "M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z",
  power: "M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z",
  speaker: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  refresh: "M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  float: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
  tune: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"
};
function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  if (text)
    node.textContent = text;
  if (className)
    node.className = className;
  return node;
}
function icon(name) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ra-ico");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}
function button(text, action, primary = false) {
  const b = el("button", text, primary ? "ra-primary" : "");
  b.type = "button";
  b.dataset.raControl = text;
  b.onclick = () => {
    action();
  };
  return b;
}
function iconButton(name, label, action, className = "ra-icon ra-quiet") {
  const b = button("", action);
  b.className = className;
  b.dataset.raControl = label;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(icon(name));
  return b;
}
function withIcon(b, name) {
  b.prepend(icon(name));
  return b;
}
function field(label, input) {
  const l = el("label", "", "ra-field");
  input.setAttribute("aria-label", label);
  l.append(el("span", label), input);
  return l;
}
function select(options, value, change) {
  const s = el("select");
  for (const o of options) {
    const option = el("option", o.label);
    option.value = o.value;
    s.append(option);
  }
  s.value = value;
  s.onchange = (e) => change(e.currentTarget.value);
  return s;
}
function textInput(value, onInput, type = "text") {
  const i = el("input");
  i.type = type;
  i.value = value;
  i.oninput = () => onInput(i.value);
  return i;
}
function toggle(label, value, change, hint = "") {
  const row = el("label", "", "ra-toggle"), i = el("input"), text = el("span");
  i.type = "checkbox";
  i.setAttribute("role", "switch");
  i.checked = value;
  i.onchange = (e) => change(e.currentTarget.checked);
  text.append(el("span", label));
  if (hint)
    text.append(el("small", hint));
  row.append(i, text);
  return row;
}
function disclosure(summary, open = false) {
  const d = el("details"), s = el("summary"), body = el("div", "", "ra-body");
  s.append(...summary);
  d.open = open;
  d.append(s, body);
  return { details: d, body };
}
function speakerLabel(speaker, fallback) {
  return !speaker ? fallback : speaker.toLowerCase() === "narrator" ? "Narrator" : speaker;
}
function timeLabel(seconds) {
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function setup(ctx) {
  let settings = normalizeSettings(DEFAULTS), ready = false, initialized = false, disposed = false;
  const hasKeys = { openrouter: false, local: false }, frontendId = crypto.randomUUID();
  const castDrafts = new Map, openCast = new Set;
  let castInitialized = false, addOpen = false, voiceQuery = "", fixName = "", fixSay = "", viewChosen = false;
  const addedCast = new Set, addedNames = new Map, sayDrafts = new Map, moreOpen = new Set;
  const validSpeaker = (name) => !!name && name.length <= 80 && !/[\[\]\r\n]/.test(name) && name.toLowerCase() !== "narrator";
  let canDiagnoseSpeech = false, diagnosing = false, diagnoseButton = null;
  let diagnoseHint = null;
  let models = [{ id: DEFAULTS.model, name: "Google: Gemini 3.8 Flash TTS", voices: GEMINI_VOICES }];
  const nativeTts = createNativeTtsClient(), nativeRequests = new Set;
  let nativeConnections = [], catalogEpoch = 0;
  let characters = [], permissions = [];
  let messages = [], selectedId = "";
  let pronunciationEntries = {}, pronunciationChatId = "", pronunciationEpoch = 0;
  let playbackId = 0, playing = false, paused = false, currentMessage = null;
  let phase = "idle";
  let checkingSavedAudio = false;
  let preparingAudio = false, waitingForAudio = false;
  let playAttempt = null, messageLoad = null;
  let utterance = null;
  const audioPlayer = new PreparedPlayer;
  const audioCache = new AudioCache;
  let cacheUserId = "";
  const automaticPreparations = new Set;
  const completionInbox = new CompletionInbox, knownCompletions = new Map;
  const localGenerations = new Map;
  let completionRecovery = null;
  let saveQueue = Promise.resolve(), saveVersion = 0;
  let currentPassages = [], preparedCount = 0, currentPassage = 0;
  let readingAbort = null, clockTimer = null;
  let browserQueueActive = false, browserResume = null;
  let widget = null;
  let widgetSize = "";
  let widgetDragCleanup = null;
  let widgetError = "";
  const widgetPermissionHint = "To use the floating player, allow “UI panels” for Readalong in Lumiverse’s extension settings. You can still play and pause here.";
  let currentSegments = [], position = 0, markedPosition = -1;
  let playbackSettler = null;
  const pending = new Map;
  const cleanups = [], bubbleHandles = new Map;
  let editorTab = null;
  const tab = ctx.ui.registerDrawerTab({ id: "readalong", title: "Readalong", shortName: "Read", description: "Listen to passages, assign character voices, and follow the spoken text", keywords: ["tts", "voice", "speech", "audio"] });
  const root = tab.root;
  root.classList.add("ra");
  root.dataset.raUi = "true";
  cleanups.push(ctx.dom.addStyle(STYLE));
  const heading = el("h2", "Readalong"), head = el("div", "", "ra-head");
  const powerSwitch = toggle("Off", false, (v) => {
    safe(() => setEnabled(v));
  });
  powerSwitch.classList.add("ra-power-switch");
  const powerInput = powerSwitch.querySelector("input"), powerLabel = powerSwitch.querySelector("span span");
  powerInput.setAttribute("aria-label", "Readalong on");
  head.append(heading, powerSwitch);
  const intro = el("p", "", "ra-muted");
  const status = el("p", "Loading…", "ra-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const stage = el("div", "", "ra-stage"), player = el("section", "", "ra-now");
  stage.append(player, status);
  const options = el("section", "", "ra-panel"), config = el("section", "", "ra-panel"), voicesCard = el("section", "", "ra-panel"), assignmentsCard = el("section", "", "ra-panel");
  const VIEWS = [["connection", "Connection", config], ["voices", "Voices", voicesCard], ["cast", "Cast", assignmentsCard], ["options", "Playback", options]];
  let view = "cast";
  const tabs = el("div", "", "ra-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Readalong settings");
  function showView(next, focus = false) {
    view = next;
    for (const [id, , panel] of VIEWS) {
      const selected = id === view, tabButton = tabs.querySelector(`[data-ra-view="${id}"]`);
      panel.hidden = !selected;
      tabButton.setAttribute("aria-selected", String(selected));
      tabButton.tabIndex = selected ? 0 : -1;
      if (selected && focus)
        tabButton.focus();
    }
  }
  VIEWS.forEach(([id, label, panel], index) => {
    const tabButton = button(label, () => {
      viewChosen = true;
      showView(id);
    });
    tabButton.dataset.raView = id;
    tabButton.id = `ra-tab-${id}`;
    tabButton.setAttribute("role", "tab");
    tabButton.onkeydown = (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step) {
        e.preventDefault();
        showView(VIEWS[(index + step + VIEWS.length) % VIEWS.length][0], true);
      }
    };
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabButton.id);
    tabs.append(tabButton);
  });
  root.append(head, intro, stage, tabs, options, voicesCard, assignmentsCard, config);
  showView(view);
  function notice(text, error = false) {
    if (!disposed) {
      status.textContent = text;
      status.classList.toggle("ra-error", error);
      renderWidget();
    }
  }
  async function safe(work) {
    try {
      await work();
    } catch (e) {
      notice(e instanceof Error ? e.message : "Readalong failed.", true);
    }
  }
  function showDiagnostics(available) {
    canDiagnoseSpeech = available;
    if (diagnoseButton)
      diagnoseButton.hidden = !available || diagnosing;
    if (diagnoseHint)
      diagnoseHint.hidden = !available || diagnosing;
  }
  function rpc(type, payload = {}) {
    if (disposed)
      return Promise.reject(new Error("Readalong was closed."));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Readalong timed out. Check the extension permissions and connection."));
      }, 70000);
      pending.set(requestId, { resolve, reject, timer });
      ctx.sendToBackend({ type, requestId, frontendId, ...payload });
    });
  }
  cleanups.push(ctx.onBackendMessage((payload) => {
    if (payload?.type === "reply") {
      const p = pending.get(payload.requestId);
      if (!p)
        return;
      clearTimeout(p.timer);
      pending.delete(payload.requestId);
      if (typeof payload.canDiagnoseSpeech === "boolean")
        showDiagnostics(payload.canDiagnoseSpeech);
      if (payload.error)
        p.reject(new Error(payload.error));
      else
        p.resolve(payload.data);
    } else if (payload?.type === "new_message" && payload.chatId === ctx.getActiveChat().chatId && payload.message && !payload.message.isUser) {
      if (payload.autoEligible !== false)
        safe(() => receiveCompletion({ chatId: payload.chatId, messageId: payload.message.id, generationId: payload.generationId ?? payload.message.id, completedAt: typeof payload.completedAt === "number" ? payload.completedAt : Date.now(), message: payload.message }));
    }
  }));
  const marker = new PassageMarker(() => {});
  function voiceNames() {
    if (settings.provider === "browser")
      return "speechSynthesis" in window ? speechSynthesis.getVoices().map((v) => v.name) : [];
    if (settings.provider === "local")
      return ["af_heart", "af_bella", "af_nicole", "am_adam", "am_michael", "bf_emma", "bm_george"];
    return models.find((m) => m.id === settings.model)?.voices ?? [];
  }
  function voiceSelect(value, change, inherited = false) {
    const names = [...voiceNames()];
    if (value && !names.includes(value))
      names.unshift(value);
    return select([...inherited ? [{ value: "", label: "Main voice" }] : [], ...names.map((name) => ({ value: name, label: name }))], value, change);
  }
  function contentRoot(messageId) {
    const bubble = ctx.dom.findMessageElement(messageId);
    return bubble?.querySelector('[data-component="MessageContent"]') ?? bubble;
  }
  function stopClock() {
    if (clockTimer)
      clearInterval(clockTimer);
    clockTimer = null;
  }
  function stop(showStatus = true) {
    playbackId++;
    playing = false;
    paused = false;
    phase = "idle";
    checkingSavedAudio = false;
    preparingAudio = false;
    waitingForAudio = false;
    playAttempt = null;
    messageLoad = null;
    stopClock();
    if (showStatus)
      completionInbox.reset();
    readingAbort?.abort();
    readingAbort = null;
    for (const controller of nativeRequests)
      controller.abort();
    nativeRequests.clear();
    audioPlayer.clear();
    browserResume?.();
    browserResume = null;
    browserQueueActive = false;
    if (utterance) {
      speechSynthesis.cancel();
      utterance = null;
    }
    playbackSettler?.();
    playbackSettler = null;
    marker.reset();
    currentMessage = null;
    currentSegments = [];
    currentPassages = [];
    preparedCount = 0;
    position = 0;
    markedPosition = -1;
    currentPassage = 0;
    rpc("cancel").catch(() => {});
    renderPlayer();
    if (showStatus)
      notice("Stopped.");
  }
  function showWidget() {
    if (!permissions.includes("ui_panels"))
      return;
    try {
      if (!widget && typeof ctx.ui.createFloatWidget === "function") {
        const { width, height } = widgetDimensions2();
        const initialPosition = widgetPosition(widgetViewport(), { width, height }, settings.widgetPosition);
        widget = ctx.ui.createFloatWidget({ width, height, initialPosition, snapToEdge: true, tooltip: "Readalong · drag to move" });
        widgetSize = `${width}:${height}`;
        widgetDragCleanup = widget.onDragEnd((pos) => {
          if (disposed)
            return;
          settings.widgetPosition = { x: pos.x, y: pos.y };
          safe(saveSettings);
        });
        widget.root.addEventListener("pointerdown", (event) => {
          if (event.target.closest("button,input,select,a"))
            event.stopPropagation();
        });
        widget.root.classList.add("ra-mini");
        widget.root.dataset.raUi = "true";
        widget.root.setAttribute("aria-label", "Readalong floating player");
      }
      widget?.setVisible(true);
      renderWidget();
      widgetError = "";
    } catch (error) {
      widgetDragCleanup?.();
      widgetDragCleanup = null;
      try {
        widget?.destroy();
      } catch {}
      widget = null;
      widgetSize = "";
      widgetError = error instanceof Error && /PERMISSION_DENIED.*ui_panels/.test(error.message) ? widgetPermissionHint : "The floating player is unavailable. You can play and pause here in the Readalong drawer.";
    }
  }
  async function openWidget() {
    try {
      permissions = await ctx.permissions.getGranted();
    } catch {}
    if (disposed)
      return;
    showWidget();
    renderPlayer();
  }
  function widgetViewport() {
    return ctx.ui.geometry?.layoutViewportSize() ?? { width: window.innerWidth, height: window.innerHeight };
  }
  function widgetTouch() {
    return window.innerWidth <= 600 || window.matchMedia("(pointer: coarse)").matches;
  }
  function widgetDimensions2() {
    return widgetDimensions(widgetViewport(), settings.widgetMinimized, widgetTouch());
  }
  function fitWidgetPosition(preferred = settings.widgetPosition ?? widget?.getPosition()) {
    if (!widget)
      return;
    const position = widgetPosition(widgetViewport(), widgetDimensions2(), preferred), current = widget.getPosition();
    if (current.x !== position.x || current.y !== position.y)
      widget.moveTo(position.x, position.y);
  }
  async function setWidgetMinimized(minimized) {
    const preferred = settings.widgetPosition ?? widget?.getPosition();
    settings.widgetMinimized = minimized;
    renderWidget();
    fitWidgetPosition(preferred);
    await saveSettings();
  }
  const resizeWidget = () => {
    if (disposed || !widget)
      return;
    const preferred = settings.widgetPosition ?? widget.getPosition();
    renderWidget();
    fitWidgetPosition(preferred);
  };
  window.addEventListener("resize", resizeWidget);
  cleanups.push(() => window.removeEventListener("resize", resizeWidget));
  const pointerMedia = window.matchMedia("(pointer: coarse)");
  pointerMedia.addEventListener("change", resizeWidget);
  cleanups.push(() => pointerMedia.removeEventListener("change", resizeWidget));
  function playState() {
    const label = !settings.enabled ? "Turn on" : playAttempt ? "Starting…" : messageLoad ? "Loading…" : phase === "preparing" ? checkingSavedAudio ? "Loading…" : "Preparing…" : phase === "idle" ? "Load saved" : phase === "paused" ? "Resume" : phase === "playing" ? "Pause" : phase === "finished" ? "Replay" : "Play";
    const busy = settings.enabled && (!!playAttempt || !!messageLoad || phase === "preparing");
    const glyph = !settings.enabled ? "power" : phase === "playing" ? "pause" : phase === "finished" ? "replay" : "play";
    return { label, busy, glyph };
  }
  function playButton(action) {
    const { label, busy, glyph } = playState(), play = button("", action, true);
    play.classList.add("ra-play");
    play.dataset.raControl = "play";
    play.setAttribute("aria-label", label);
    play.title = label;
    play.append(busy ? el("span", "", "ra-spin") : icon(glyph));
    return play;
  }
  function renderWidget() {
    if (!widget || disposed)
      return;
    const { width, height } = widgetDimensions2(), size = `${width}:${height}`;
    if (widgetSize !== size) {
      widget.setSize(width, height);
      widgetSize = size;
    }
    widget.root.classList.toggle("ra-collapsed", settings.widgetMinimized);
    widget.root.classList.toggle("ra-touch", widgetTouch());
    widget.root.classList.toggle("ra-narrow", widgetDimensions2().narrow);
    const { label: playLabel } = playState(), speaking = phase === "playing" || phase === "paused", hasTime = !!audioPlayer.duration;
    const play = playButton(() => safe(settings.enabled ? playOrPause : () => setEnabled(true)));
    play.disabled = !ready || !!playAttempt || !!messageLoad || settings.enabled && (phase === "preparing" || phase === "idle" && !selectedId);
    const close = iconButton("close", "Hide floating player", () => widget?.setVisible(false));
    const resize = iconButton(settings.widgetMinimized ? "expand" : "minimize", settings.widgetMinimized ? "Expand floating player" : "Minimize floating player", () => safe(() => setWidgetMinimized(!settings.widgetMinimized)));
    resize.dataset.raControl = "resize";
    resize.setAttribute("aria-expanded", String(!settings.widgetMinimized));
    const power = iconButton("power", settings.enabled ? "Turn Readalong off" : "Turn Readalong on", () => safe(() => setEnabled(!settings.enabled)));
    power.dataset.raControl = "power";
    power.setAttribute("aria-pressed", String(settings.enabled));
    const progress = el("progress");
    progress.max = 1;
    progress.value = preparingAudio ? preparedCount / Math.max(1, currentPassages.length) : phase === "finished" ? 1 : phase === "ready" ? 0 : hasTime ? audioPlayer.elapsed / audioPlayer.duration : position / Math.max(1, currentSegments.length);
    progress.setAttribute("aria-label", preparingAudio ? "Speech preparation" : "Playback progress");
    const clock = `${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`;
    if (settings.widgetMinimized) {
      const info = el("div", "", "ra-compact-info");
      info.append(el("strong", speaking ? speakerLabel(currentSegments[position]?.speaker, "Readalong") : "Readalong"));
      const timed = hasTime && settings.enabled && ["playing", "paused", "ready", "finished"].includes(phase);
      const detail = el("span", !settings.enabled ? "Off" : timed ? clock : playLabel, timed ? "ra-compact-status ra-time" : "ra-compact-status");
      detail.title = status.textContent ?? "";
      info.append(detail);
      patchPlaybackChildren(widget.root, play, info, power, resize, close, progress);
    } else {
      const top = el("div", "", "ra-row ra-widget-top"), text = el("div", "", "ra-widget-text"), who = el("div", "", "ra-who");
      who.append(el("strong", speaking ? speakerLabel(currentSegments[position]?.speaker, "Voice") : "Readalong"));
      if (speaking && currentPassages[currentPassage]?.voice)
        who.append(el("span", currentPassages[currentPassage].voice));
      const caption = el("p", speaking ? plainText(currentSegments[position]?.text ?? "") : status.textContent || "Choose a message.", speaking ? "ra-caption ra-reading" : "ra-caption");
      caption.title = caption.textContent ?? "";
      text.append(who, caption);
      const tools = el("div", "", "ra-row ra-widget-tools");
      tools.append(resize, close);
      top.append(play, text, tools);
      const seek = el("div", "", "ra-seek");
      seek.append(progress, el("span", hasTime ? clock : "", "ra-time"));
      const foot = el("div", "", "ra-row ra-widget-foot"), stopButton = withIcon(button("Stop", () => stop()), "stop");
      stopButton.disabled = phase === "idle";
      const fix = button("Fix a name", () => fixAName());
      fix.title = "Change how a name is said";
      const open = iconButton("tune", "Open Readalong", () => tab.activate());
      power.classList.add("ra-push");
      foot.append(stopButton, fix, power, open);
      patchPlaybackChildren(widget.root, top, seek, foot);
    }
  }
  function markSentence(passageIndex, sentenceIndex) {
    const next = currentPassages.slice(0, passageIndex).reduce((sum, p) => sum + p.segments.length, 0) + sentenceIndex;
    if (next === markedPosition && currentPassage === passageIndex)
      return;
    currentPassage = passageIndex;
    position = next;
    markedPosition = next;
    if (currentMessage) {
      marker.mark(() => contentRoot(currentMessage.id), plainText(currentSegments[position].text));
      if (settings.follow)
        marker.follow();
    }
    renderPlayer();
  }
  function updateClock() {
    if (phase !== "playing")
      return;
    const at = audioPlayer.position, passage = currentPassages[at.index];
    if (passage)
      markSentence(at.index, estimatedSentenceIndex(passage, at.fraction));
    const progress = widget?.root.querySelector("progress");
    if (progress && !preparingAudio)
      progress.value = at.duration ? at.elapsed / at.duration : 0;
    for (const time of [widget?.root.querySelector(".ra-time"), player.querySelector(".ra-time")])
      if (time)
        time.textContent = `${timeLabel(at.elapsed)} / ${timeLabel(at.duration)}`;
  }
  function finished() {
    playing = false;
    paused = false;
    phase = "finished";
    stopClock();
    if (currentPassages.length)
      markSentence(currentPassages.length - 1, currentPassages.at(-1).segments.length - 1);
    notice(currentPassages[0]?.settings.provider === "browser" ? "Finished. Replay reads this passage again." : "Finished. Replay is free.");
    renderPlayer();
  }
  audioPlayer.onEnded = finished;
  audioPlayer.onError = (error) => {
    paused = true;
    playing = false;
    phase = "paused";
    stopClock();
    notice(error.message, true);
    renderPlayer();
  };
  audioPlayer.onWaiting = (waiting) => {
    waitingForAudio = waiting;
    if (phase === "playing")
      notice(waiting ? "Waiting for the rest of the audio…" : "Reading…");
    renderPlayer();
  };
  async function playOrPause() {
    if (!settings.enabled)
      throw new Error("Readalong is off. Turn it on to prepare audio.");
    if (playAttempt || messageLoad)
      return;
    if (phase === "preparing")
      return;
    if (phase === "idle") {
      if (!selectedId)
        throw new Error("No assistant message found.");
      await readId(selectedId, true);
      return;
    }
    if (phase === "playing") {
      if (browserQueueActive)
        speechSynthesis.pause();
      else {
        updateClock();
        audioPlayer.pause();
      }
      paused = true;
      playing = false;
      phase = "paused";
      stopClock();
      notice("Paused. Your place is saved.");
      renderPlayer();
      return;
    }
    const token = playbackId;
    if (phase === "paused" && browserQueueActive) {
      speechSynthesis.resume();
      paused = false;
      playing = true;
      phase = "playing";
      browserResume?.();
      browserResume = null;
      notice("Reading…");
      renderPlayer();
      return;
    }
    if (phase === "finished") {
      marker.reset();
      position = 0;
      markedPosition = -1;
      currentPassage = 0;
      audioPlayer.rewind();
    }
    paused = false;
    if (currentPassages[0]?.settings.provider === "browser") {
      playing = true;
      phase = "playing";
      browserQueueActive = true;
      notice("Reading…");
      renderPlayer();
      try {
        for (let i = 0;i < currentPassages.length && token === playbackId; i++) {
          if (paused)
            await new Promise((resolve) => browserResume = resolve);
          if (token !== playbackId)
            return;
          markSentence(i, 0);
          await browserSpeech(currentPassages[i], token, i);
        }
        if (token === playbackId) {
          browserQueueActive = false;
          finished();
        }
      } catch (e) {
        if (token === playbackId) {
          stop(false);
          throw e;
        }
      }
      return;
    }
    const attempt = {};
    playAttempt = attempt;
    try {
      const pending = audioPlayer.play();
      renderPlayer();
      const started = await pending;
      if (token !== playbackId || !started)
        return;
      playing = true;
      phase = "playing";
      notice(waitingForAudio ? "Waiting for the rest of the audio…" : preparingAudio ? "Reading… The rest is still on its way." : "Reading…");
      updateClock();
      stopClock();
      clockTimer = setInterval(updateClock, 100);
    } finally {
      if (playAttempt === attempt) {
        playAttempt = null;
        renderPlayer();
      }
    }
  }
  function browserSpeech(passage, token, passageIndex) {
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window)) {
        reject(new Error("Browser voices are unavailable in this browser."));
        return;
      }
      const u = new SpeechSynthesisUtterance(passage.segment.text);
      utterance = u;
      u.voice = speechSynthesis.getVoices().find((v) => v.name === passage.voice) ?? null;
      u.rate = settings.speed;
      u.volume = settings.volume;
      playbackSettler = resolve;
      u.onboundary = (e) => {
        if (token !== playbackId || phase !== "playing")
          return;
        let end = 0;
        for (let i = 0;i < passage.segments.length; i++) {
          end += passage.segments[i].text.length + 1;
          if (e.charIndex < end) {
            markSentence(passageIndex, i);
            break;
          }
        }
      };
      const finish = () => {
        if (utterance === u) {
          utterance = null;
          playbackSettler = null;
        }
      };
      u.onend = () => {
        finish();
        resolve();
      };
      u.onerror = (e) => {
        finish();
        if (token === playbackId && e.error !== "canceled" && e.error !== "interrupted")
          reject(new Error(`Browser speech failed: ${e.error}`));
        else
          resolve();
      };
      speechSynthesis.speak(u);
    });
  }
  function activeNative(id = settings.connectionId) {
    return nativeConnections.find((c) => c.id === id);
  }
  async function flushCompletion() {
    if (!initialized || disposed || !settings.enabled)
      return;
    const chatId = ctx.getActiveChat().chatId;
    if (!chatId)
      return;
    const reply = completionInbox.take(chatId);
    if (reply)
      await autoPrepareMessage(reply.message);
  }
  async function receiveCompletion(reply) {
    if (disposed || reply.chatId !== ctx.getActiveChat().chatId || !completionInbox.receive(reply))
      return;
    knownCompletions.set(reply.chatId, reply.generationId);
    while (knownCompletions.size > 20)
      knownCompletions.delete(knownCompletions.keys().next().value);
    messages = [...messages.filter((m) => m.id !== reply.message.id), reply.message];
    selectedId = reply.message.id;
    await flushCompletion();
  }
  async function refreshPronunciations(chatId = ctx.getActiveChat().chatId, messageId) {
    if (!chatId)
      return {};
    const epoch = ++pronunciationEpoch, r = await rpc("pronunciations", { chatId, ...messageId ? { messageId } : {} }), entries = normalizePronunciations(r.entries);
    if (!disposed && epoch === pronunciationEpoch && ctx.getActiveChat().chatId === chatId) {
      pronunciationChatId = chatId;
      pronunciationEntries = entries;
      renderAssignments();
    }
    return entries;
  }
  async function recoverCompletion() {
    if (!initialized || !settings.enabled || disposed || completionRecovery || !permissions.includes("chat_mutation") || !permissions.includes("generation"))
      return;
    const chatId = ctx.getActiveChat().chatId;
    if (!chatId)
      return;
    const operation = {};
    completionRecovery = operation;
    const since = completionInbox.since;
    const current = () => !disposed && settings.enabled && ctx.getActiveChat().chatId === chatId && completionInbox.since === since;
    try {
      const r = await rpc("latest_completion", { chatId, since });
      const ticket = r.completion;
      if (!current() || r.generating || !ticket || ticket.completedAt < since || knownCompletions.get(chatId) === ticket.generationId)
        return;
      for (const [id, g] of localGenerations)
        if (g.chatId === chatId)
          localGenerations.delete(id);
      const loaded = await rpc("message", { chatId, messageId: ticket.messageId, latestOnly: true });
      if (!current())
        return;
      if (!loaded.message) {
        knownCompletions.set(chatId, ticket.generationId);
        return;
      }
      await receiveCompletion({ ...ticket, message: { ...loaded.message, name: ticket.name || loaded.message.name, characterId: ticket.characterId ?? loaded.message.characterId } });
    } finally {
      if (completionRecovery === operation)
        completionRecovery = null;
    }
  }
  async function prepareSpeech(segment, snapshot, signal) {
    signal?.throwIfAborted();
    if (snapshot.provider !== "lumiverse")
      return rpc("speech", { segment, previewSettings: snapshot });
    const connection = activeNative(snapshot.connectionId);
    if (!connection)
      throw new Error("Choose a connection first. If the list is empty, add one in Lumiverse’s voice settings.");
    const controller = new AbortController;
    nativeRequests.add(controller);
    try {
      return await nativeTts.speech(connection, snapshot, segment, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(300000), ...signal ? [signal] : []]));
    } finally {
      nativeRequests.delete(controller);
    }
  }
  async function autoPrepareMessage(message, force = false, restoreOnly = false) {
    if (!initialized || !settings.enabled || disposed || message.isUser)
      return;
    const key = JSON.stringify([ctx.getActiveChat().chatId, message.id, message.content]);
    if (!force && (automaticPreparations.has(key) || currentMessage?.id === message.id && currentMessage.content === message.content))
      return;
    if (!restoreOnly) {
      automaticPreparations.add(key);
      if (automaticPreparations.size > 20)
        automaticPreparations.delete(automaticPreparations.values().next().value);
    }
    await startMessage(message, { automatic: true, restoreOnly });
  }
  async function prepareLatest(force = false, restoreOnly = false) {
    if (!settings.enabled || !initialized)
      return;
    const latest = messages.at(-1);
    if (latest)
      await autoPrepareMessage(latest, force, restoreOnly);
    else
      notice("Readalong is on. New replies will get audio on their own.");
  }
  async function setEnabled(enabled) {
    if (settings.enabled === enabled)
      return;
    completionInbox.setEnabled(enabled);
    knownCompletions.clear();
    localGenerations.clear();
    settings.enabled = enabled;
    if (!enabled)
      stop(false);
    renderPlayer();
    renderVoices();
    renderAssignments();
    notice(enabled ? "Readalong is on. Preparing the latest reply…" : "Readalong is off. Nothing is sent to your voice service.");
    await saveSettings();
    if (enabled && settings.enabled) {
      await refreshMessages();
      await prepareLatest(true);
    }
  }
  async function startMessage(message, options = {}) {
    if (!settings.enabled)
      throw new Error("Readalong is off. Turn it on to prepare audio.");
    if (!options.restoreOnly) {
      automaticPreparations.add(JSON.stringify([ctx.getActiveChat().chatId, message.id, message.content]));
      if (automaticPreparations.size > 20)
        automaticPreparations.delete(automaticPreparations.values().next().value);
    }
    stop(false);
    const token = playbackId;
    readingAbort = new AbortController;
    const signal = readingAbort.signal;
    currentMessage = { ...message, characterId: message.characterId ?? speakerCharacterId(message.name, characters, ctx.getActiveChat().characterId ?? undefined) };
    phase = "preparing";
    preparingAudio = true;
    checkingSavedAudio = true;
    preparedCount = 0;
    showWidget();
    notice("Looking for saved audio…");
    renderPlayer();
    try {
      const snapshot = normalizeSettings(settings);
      const chatId = ctx.getActiveChat().chatId;
      const context = {
        characters,
        characterId: currentMessage.characterId,
        connections: nativeConnections,
        mainSpeaker: message.name,
        pronunciations: await refreshPronunciations(chatId, options.restoreOnly ? undefined : message.id)
      };
      let rules;
      if (snapshot.provider === "lumiverse") {
        const results = await Promise.allSettled([nativeTts.preferences(), ctx.chats.getActive?.() ?? Promise.resolve(null)]);
        if (results[0].status === "fulfilled") {
          rules = results[0].value.rules;
          context.narrationVoice = results[0].value.narrationVoice;
        }
        if (results[1].status === "fulfilled")
          context.overrides = results[1].value?.metadata?.voiceOverrides;
      }
      if (token !== playbackId)
        return;
      const parsed = parseSegments(message.content, message.name, rules);
      currentPassages = planSpeech(parsed, snapshot, context);
      currentSegments = currentPassages.flatMap((p) => p.segments);
      if (!currentSegments.length) {
        stop(false);
        notice("There is no readable text in this message.");
        return;
      }
      let restored = false, saved = true, openingCount = 0;
      if (snapshot.provider !== "browser") {
        const messageKey = await preparationHash([ctx.getActiveChat().chatId, message.id, message.content]);
        const requests = currentPassages.map((p) => {
          const connection = activeNative(p.settings.connectionId);
          return p.settings.provider === "lumiverse" && connection ? nativeSpeechRequest(connection, p.settings, p.segment) : [p.settings.provider, p.settings.localUrl, speechRequest(p.settings, p.segment)];
        });
        const audioKey = await preparationHash([messageKey, requests]);
        let clips = undefined;
        try {
          clips = await audioCache.get(cacheUserId, audioKey);
        } catch {}
        if (token !== playbackId)
          return;
        if (clips?.length !== currentPassages.length)
          clips = undefined;
        if (clips) {
          restored = true;
          preparedCount = currentPassages.length;
        } else {
          if (options.restoreOnly) {
            stop(false);
            notice("No saved audio for this message. Press Prepare message to make it. This may cost money.");
            return;
          }
          const claim = await rpc("claim_preparation", { key: messageKey, manual: !options.automatic });
          if (token !== playbackId)
            return;
          if (!claim?.allowed) {
            stop(false);
            notice("Audio for this message was already tried once. Press Prepare message to try again. This may cost money.");
            return;
          }
          checkingSavedAudio = false;
          notice("Preparing the whole message…");
          renderPlayer();
          const partial = new Array(currentPassages.length), texts = currentPassages.map((p) => plainText(p.segment.text));
          clips = await prepareAll(currentPassages, async (p, _index, requestSignal) => {
            const data = await prepareSpeech(p.segment, p.settings, requestSignal);
            requestSignal.throwIfAborted();
            const clip = await prepareClip(data, requestSignal);
            requestSignal.throwIfAborted();
            partial[_index] = clip;
            return clip;
          }, signal, (count) => {
            if (token !== playbackId)
              return;
            preparedCount = count;
            if (settings.earlyPlayback && !openingCount && count < currentPassages.length) {
              const prefix = earlyPlaybackPrefix(texts, partial);
              if (prefix) {
                openingCount = prefix;
                audioPlayer.begin(partial.slice(0, prefix));
                audioPlayer.setSpeed(settings.speed);
                audioPlayer.setVolume(settings.volume);
                phase = "ready";
              }
            }
            notice(phase === "playing" ? `Reading… ${count} of ${currentPassages.length} parts ready. The rest is on its way.` : phase === "paused" ? `Paused. ${count} of ${currentPassages.length} parts ready. The rest is on its way.` : openingCount ? `You can press Play now. ${count} of ${currentPassages.length} parts ready.` : `Preparing: ${count} of ${currentPassages.length} parts ready…`);
            renderPlayer();
          }, snapshot.provider === "lumiverse" ? 3 : 2);
          if (token !== playbackId)
            return;
          if (openingCount && (audioPlayer.hasStarted || playAttempt))
            audioPlayer.append(clips.slice(openingCount), true);
          else
            audioPlayer.load(clips);
          preparingAudio = false;
          audioPlayer.setSpeed(settings.speed);
          audioPlayer.setVolume(settings.volume);
          if (phase === "preparing")
            phase = "ready";
          notice(phase === "playing" ? "Reading… The whole message is ready." : phase === "paused" ? "Paused. The whole message is ready." : "The whole message is ready. Press Play.");
          renderPlayer();
          try {
            saved = await audioCache.put(cacheUserId, audioKey, clips);
          } catch {
            saved = false;
          }
        }
        if (token !== playbackId)
          return;
        if (restored) {
          audioPlayer.load(clips);
          audioPlayer.setSpeed(settings.speed);
          audioPlayer.setVolume(settings.volume);
        }
      }
      if (token !== playbackId)
        return;
      if (phase === "preparing")
        phase = "ready";
      preparingAudio = false;
      checkingSavedAudio = false;
      notice(restored ? "Saved audio is ready, at no new cost. Press Play." : !saved ? "This audio could not be saved. It will be gone after a reload." : phase === "playing" ? "Reading… The whole message is ready." : phase === "paused" ? "Paused. The whole message is ready." : phase === "finished" ? "Finished. Replay is free." : "The whole message is ready. Press Play.");
      renderPlayer();
    } catch (e) {
      if (token === playbackId) {
        stop(false);
        throw e;
      }
    }
  }
  async function preview(voice, assignment, sample) {
    if (!settings.enabled)
      throw new Error("Readalong is off. Turn it on to test a voice.");
    stop(false);
    const token = playbackId;
    readingAbort = new AbortController;
    if (settings.provider !== "browser")
      audioPlayer.unlock();
    const segment = { text: sample?.text ?? "The door was open. I took a breath, and stepped into the light.", speaker: "Preview", emotion: assignment?.emotion ?? "neutral", delivery: assignment?.delivery ?? "normal" };
    const snapshot = normalizeSettings({ ...settings, voice, narratorVoice: "", npcVoice: "", assignments: {}, inheritVoices: false });
    currentPassages = planSpeech([segment], snapshot, { characters: [], pronunciations: sample?.entries });
    currentSegments = [segment];
    position = 0;
    phase = "preparing";
    showWidget();
    renderPlayer();
    notice(`Preparing ${voice}…`);
    try {
      if (snapshot.provider !== "browser") {
        const data = await prepareSpeech(currentPassages[0].segment, currentPassages[0].settings, readingAbort.signal);
        if (token !== playbackId)
          return;
        const clip = await prepareClip(data, readingAbort.signal);
        if (token !== playbackId)
          return;
        audioPlayer.load([clip]);
        audioPlayer.setSpeed(settings.speed);
        audioPlayer.setVolume(settings.volume);
      }
      if (token !== playbackId)
        return;
      phase = "ready";
      notice("Sample ready. Press Play.");
      renderPlayer();
      try {
        await playOrPause();
      } catch (e) {
        notice(e instanceof Error ? e.message : "Sample ready. Press Play.", true);
        renderPlayer();
      }
    } catch (e) {
      if (token === playbackId) {
        stop(false);
        throw e;
      }
    }
  }
  async function saveSettings() {
    const snapshot = normalizeSettings(settings), version = ++saveVersion;
    const work = saveQueue.then(() => rpc("save", { settings: snapshot }));
    saveQueue = work.catch(() => {});
    const r = await work;
    if (disposed || version !== saveVersion)
      return;
    settings = normalizeSettings(r.settings);
    if (phase === "idle")
      notice(settings.enabled ? "Readalong is on. New replies get audio on their own." : "Readalong is off. Nothing is sent to your voice service.");
  }
  function chooseNative(connection, preserveModel = false) {
    settings.provider = "lumiverse";
    settings.connectionId = connection.id;
    if (!preserveModel) {
      settings.model = connection.model || DEFAULTS.model;
      settings.voice = connection.voice || DEFAULTS.voice;
    }
  }
  async function refreshCatalog() {
    const epoch = ++catalogEpoch, provider = settings.provider, connection = activeNative();
    let next;
    if (provider === "lumiverse") {
      if (!connection) {
        models = [];
        renderConfig();
        renderVoices();
        renderAssignments();
        return;
      }
      if (connection.provider === "openrouter_tts") {
        try {
          next = (await rpc("models")).models;
        } catch {
          next = [{ id: settings.model, name: settings.model, voices: /gemini-.*tts/i.test(settings.model) ? GEMINI_VOICES : await nativeTts.voices(connection.id) }];
        }
      } else {
        const results = await Promise.all([nativeTts.models(connection.id), nativeTts.voices(connection.id)]);
        next = results[0].map((m) => ({ ...m, voices: results[1] }));
        if (!next.length)
          next = [{ id: connection.model, name: connection.model, voices: results[1] }];
      }
    } else if (provider === "openrouter")
      next = (await rpc("models")).models;
    else
      return;
    if (disposed || epoch !== catalogEpoch || provider !== settings.provider || provider === "lumiverse" && connection?.id !== settings.connectionId)
      return;
    models = next;
    if (!models.some((m) => m.id === settings.model))
      models.unshift({ id: settings.model, name: settings.model, voices: [] });
    renderConfig();
    renderVoices();
    renderAssignments();
  }
  async function refreshNativeConnections() {
    const next = await nativeTts.connections();
    if (disposed)
      return;
    nativeConnections = next;
    if (settings.provider === "lumiverse" && !settings.connectionId && next.length)
      chooseNative(next.find((c) => c.provider === "openrouter_tts") ?? next[0]);
    renderConfig();
    await refreshCatalog();
  }
  async function refreshMessages() {
    const chatId = ctx.getActiveChat().chatId;
    if (!chatId) {
      messages = [];
      renderPlayer();
      return;
    }
    const r = await rpc("messages", { chatId });
    if (ctx.getActiveChat().chatId !== chatId)
      return;
    messages = r.messages;
    selectedId = messages.some((m) => m.id === selectedId) ? selectedId : messages.at(-1)?.id ?? "";
    renderPlayer();
    decorateMessages();
  }
  async function readId(id, restoreOnly = false) {
    if (messageLoad)
      return;
    const chatId = ctx.getActiveChat().chatId;
    if (!chatId)
      throw new Error("Open a chat first.");
    const operation = {};
    messageLoad = operation;
    const token = playbackId;
    renderPlayer();
    try {
      const r = await rpc("message", { chatId, messageId: id });
      if (ctx.getActiveChat().chatId !== chatId || token !== playbackId || messageLoad !== operation)
        return;
      await startMessage(r.message, { restoreOnly });
    } finally {
      if (messageLoad === operation) {
        messageLoad = null;
        renderPlayer();
      }
    }
  }
  function renderPlayer() {
    for (const handle of bubbleHandles.values()) {
      const read = handle.querySelector("button");
      if (read)
        read.disabled = !settings.enabled;
    }
    powerInput.checked = settings.enabled;
    powerLabel.textContent = settings.enabled ? "On" : "Off";
    intro.textContent = settings.enabled ? "New replies get audio on their own and wait for Play. Your voice service may charge for each one." : "Turn on to hear replies read aloud.";
    root.dataset.raPhase = settings.enabled ? phase : "off";
    const content = el("section"), canFloat = typeof ctx.ui.createFloatWidget === "function";
    const float = () => iconButton("float", "Floating player", () => safe(openWidget), "ra-icon ra-quiet ra-push");
    if (currentSegments.length) {
      const segment = currentSegments[position], meta = el("div", "", "ra-meta"), voice = currentPassages[currentPassage]?.voice;
      meta.append(el("strong", speakerLabel(segment?.speaker, "Voice")));
      if (voice)
        meta.append(el("span", voice));
      meta.append(el("span", preparingAudio ? `${preparedCount} of ${currentPassages.length} parts ready` : `Sentence ${position + 1} of ${currentSegments.length}`, "ra-push"));
      const progress = el("progress");
      progress.max = preparingAudio ? currentPassages.length : currentSegments.length;
      progress.value = preparingAudio ? preparedCount : phase === "ready" ? 0 : position + 1;
      progress.setAttribute("aria-label", preparingAudio ? "Speech preparation" : "Playback progress");
      const seek = el("div", "", "ra-seek");
      seek.append(progress, el("span", audioPlayer.duration ? `${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}` : "", "ra-time"));
      content.append(meta, el("p", plainText(segment?.text ?? ""), "ra-passage"), seek);
    } else if (messages.length) {
      content.append(field("Message", select([...messages].reverse().map((m) => ({ value: m.id, label: `${m.name || "Assistant"}: ${plainText(stripCues(m.content)).slice(0, 70)}` })), selectedId, (v) => {
        selectedId = v;
      })));
    } else
      content.append(el("p", ready ? "No replies in this chat yet. Readalong picks up the next one." : "Loading…", "ra-muted"));
    const row = el("div", "", "ra-row");
    if (phase !== "idle") {
      const play = playButton(() => safe(playOrPause));
      play.disabled = phase === "preparing" || !!playAttempt;
      row.append(play, iconButton("stop", "Stop", () => stop(), "ra-icon"));
      if (currentMessage)
        row.append(button("Show in chat", () => marker.follow()), button("Fix a name", () => fixAName()));
    } else {
      const read = button("Prepare message", () => safe(async () => {
        if (selectedId)
          await readId(selectedId);
        else {
          await refreshMessages();
          if (selectedId)
            await readId(selectedId);
          else
            throw new Error("No assistant message found.");
        }
      }), true);
      read.disabled = !ready || !settings.enabled || !!messageLoad;
      row.append(read, iconButton("refresh", "Refresh messages", () => safe(refreshMessages), "ra-icon"));
    }
    if (canFloat)
      row.append(float());
    content.append(row);
    if (phase === "idle" && settings.enabled)
      content.append(el("p", "Uses saved audio if there is any. If not, it makes new audio, which may cost money.", "ra-muted"));
    if (ready && canFloat && (widgetError || !permissions.includes("ui_panels")))
      content.append(el("p", widgetError || widgetPermissionHint, "ra-muted"));
    patchPlaybackChildren(player, ...content.childNodes);
    renderWidget();
  }
  function renderOptions() {
    const slider = el("input");
    slider.type = "range";
    slider.min = ".5";
    slider.max = "2";
    slider.step = ".1";
    slider.value = String(settings.speed);
    const speedText = () => `Speed: ${settings.speed.toFixed(1)}×`, speedLabel = el("span", speedText()), speedField = el("label", "", "ra-field");
    slider.setAttribute("aria-label", "Speed");
    slider.oninput = () => {
      settings.speed = Number(slider.value);
      speedLabel.textContent = speedText();
      audioPlayer.setSpeed(settings.speed);
    };
    slider.onchange = () => {
      safe(saveSettings);
    };
    speedField.append(speedLabel, slider);
    const volume = el("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "1";
    volume.step = ".05";
    volume.value = String(settings.volume);
    const volumeText = () => `Volume: ${Math.round(settings.volume * 100)}%`, volumeLabel = el("span", volumeText()), volumeField = el("label", "", "ra-field");
    volume.setAttribute("aria-label", "Volume");
    volume.oninput = () => {
      settings.volume = Number(volume.value);
      volumeLabel.textContent = volumeText();
      audioPlayer.setVolume(settings.volume);
    };
    volume.onchange = () => {
      safe(saveSettings);
    };
    volumeField.append(volumeLabel, volume);
    const sliders = el("div", "", "ra-grid");
    sliders.append(speedField, volumeField);
    const about = disclosure([el("strong", "About cost and saved audio")]);
    about.body.append(el("p", "While Readalong is on, each new reply gets audio as soon as it is written. Nothing plays until you press Play.", "ra-muted"), el("p", "Audio is saved on this device. Reloading or switching chats brings it back for free. If nothing is saved, press Prepare message to make it.", "ra-muted"), el("p", "Changing a voice, or how a name is said, only changes new audio.", "ra-muted"), el("p", "The highlighted sentence is a close guess of where the voice is.", "ra-muted"));
    options.replaceChildren(sliders, toggle("Scroll the chat to follow the voice", settings.follow, (v) => {
      settings.follow = v;
      safe(saveSettings);
    }), toggle("Let me press Play early", settings.earlyPlayback, (v) => {
      settings.earlyPlayback = v;
      safe(saveSettings);
    }, "Play unlocks when about three quarters of the audio is ready."), about.details);
  }
  function nextStep(label, to) {
    const b = button(label, () => showView(to, true));
    b.classList.add("ra-quiet", "ra-next");
    return b;
  }
  function renderConfig() {
    const rerender = () => {
      renderConfig();
      renderVoices();
      renderAssignments();
    };
    config.replaceChildren();
    config.append(field("Voice service", select([{ value: "lumiverse", label: "Lumiverse connection (easiest)" }, { value: "openrouter", label: "OpenRouter with my own key" }, { value: "browser", label: "Browser voices (free)" }, { value: "local", label: "My own server" }], settings.provider, (v) => {
      stop(false);
      settings.provider = v;
      if (v === "lumiverse") {
        const connection = activeNative() ?? nativeConnections.find((c) => c.provider === "openrouter_tts") ?? nativeConnections[0];
        if (connection)
          chooseNative(connection);
      } else if (v === "browser")
        settings.voice = voiceNames()[0] ?? "";
      else if (v === "local") {
        settings.model = "kokoro";
        settings.voice = "af_heart";
      } else {
        settings.model = DEFAULTS.model;
        settings.voice = "Kore";
      }
      rerender();
      safe(async () => {
        await saveSettings();
        await refreshCatalog();
      });
    })));
    const modelField = () => field("Voice model", select(models.map((m) => ({ value: m.id, label: m.name })), settings.model, (v) => {
      stop(false);
      settings.model = v;
      settings.voice = voiceNames()[0] ?? "";
      rerender();
      safe(saveSettings);
    }));
    const actions = el("div", "", "ra-row");
    diagnoseButton = null;
    diagnoseHint = null;
    if (settings.provider === "lumiverse") {
      config.append(field("Connection", select([{ value: "", label: "Choose a connection" }, ...nativeConnections.map((c) => ({ value: c.id, label: `${c.name} (${c.provider.replace(/_tts$/, "")})` }))], settings.connectionId, (v) => {
        stop(false);
        const connection = nativeConnections.find((c) => c.id === v);
        if (connection)
          chooseNative(connection);
        else
          settings.connectionId = "";
        rerender();
        safe(async () => {
          await saveSettings();
          await refreshCatalog();
        });
      })));
      if (models.length && activeNative())
        config.append(modelField());
      actions.append(button("Test connection", () => safe(async () => {
        if (!activeNative())
          throw new Error("Choose a connection first.");
        notice("Testing the connection…");
        notice(await nativeTts.check(settings.connectionId));
      }), true), withIcon(button("Reload list", () => safe(refreshNativeConnections)), "refresh"));
      config.append(actions, el("p", "Uses a voice connection you already saved in Lumiverse’s voice settings. Add or change connections there.", "ra-muted"));
      if (/gemini-3\.8.*tts/i.test(settings.model))
        config.append(el("p", "Gemini 3.8 reads sounds like sighs and pauses from your preset. It can’t yet take Readalong’s feeling marks through this connection.", "ra-muted"));
    }
    if (settings.provider === "openrouter")
      config.append(modelField());
    if (settings.provider === "local") {
      const grid = el("div", "", "ra-grid");
      grid.append(field("Server address", textInput(settings.localUrl, (v) => settings.localUrl = v)), field("Model name", textInput(settings.model, (v) => settings.model = v)));
      config.append(grid, button("Save address and model", () => safe(saveSettings)));
    }
    if (settings.provider === "openrouter" || settings.provider === "local") {
      const provider = settings.provider;
      const key = textInput("", () => {}, "password");
      key.autocomplete = "off";
      key.placeholder = hasKeys[provider] ? "Key saved. Leave blank to keep it" : "Paste your API key";
      const keyRow = el("div", "", "ra-row ra-end");
      keyRow.append(field("API key", key), button("Save key", () => safe(async () => {
        if (!key.value.trim())
          throw new Error("Paste a key first.");
        const r = await rpc("save_key", { key: key.value, provider, localUrl: settings.localUrl });
        hasKeys[provider] = r.hasKey;
        key.value = "";
        key.placeholder = "Key saved";
        notice("Key saved.");
      })));
      config.append(keyRow);
      actions.append(button("Test connection", () => safe(async () => {
        notice("Testing the connection…");
        const r = await rpc("check_connection", { settings });
        notice(r.message);
      }), true));
      if (provider === "openrouter")
        actions.append(withIcon(button("Reload voices", () => safe(async () => {
          const r = await rpc("models");
          models = r.models;
          if (!models.some((m) => m.id === settings.model))
            models.unshift({ id: settings.model, name: settings.model, voices: [] });
          rerender();
          notice("Voice list reloaded.");
        })), "refresh"));
      const remove = button("Remove saved key", () => safe(async () => {
        const result = await ctx.ui.showConfirm({ title: "Remove saved key?", message: `Remove the Readalong ${provider === "local" ? "server" : "OpenRouter"} key? Connections saved in Lumiverse are not touched.`, variant: "danger", confirmLabel: "Remove key" });
        if (!result.confirmed)
          return;
        await rpc("remove_key", { provider, confirmed: true });
        hasKeys[provider] = false;
        key.placeholder = "Paste your API key";
        notice("Saved key removed.");
      }));
      remove.classList.add("ra-quiet");
      actions.append(remove);
      config.append(actions, el("p", `Your key is stored encrypted. Each sample or reading sends a request to this service.${provider === "local" ? " A key only works with the exact server address it was saved for. Servers on the internet must use HTTPS." : ""}`, "ra-muted"));
      diagnoseButton = button("Show last error", () => safe(async () => {
        if (diagnosing)
          return;
        diagnosing = true;
        stop(false);
        showDiagnostics(false);
        notice("Reading the error…");
        try {
          const r = await rpc("diagnose_speech");
          notice(r.message);
        } finally {
          diagnosing = false;
          showDiagnostics(canDiagnoseSpeech);
        }
      }));
      diagnoseHint = el("p", "Show last error sends the failed request one more time to read what went wrong. If it works this time, you may be charged for it.", "ra-muted");
      config.append(diagnoseButton, diagnoseHint);
      showDiagnostics(canDiagnoseSpeech);
    }
    config.append(el("hr", "", "ra-rule"), el("h3", "Help from the story model"), toggle("Mark feelings and who is speaking", settings.promptEmotions, (v) => {
      settings.promptEmotions = v;
      safe(saveSettings);
    }, "Adds a little to each reply. The marks stay hidden in chat."), toggle("Act out those feelings", settings.useEmotions, (v) => {
      settings.useEmotions = v;
      safe(saveSettings);
    }, "Only for voices that can do it."), nextStep("Next: try some voices", "voices"));
  }
  function renderVoices() {
    voicesCard.replaceChildren();
    const names = voiceNames(), pick = (name) => {
      settings.voice = name;
      renderVoices();
      safe(saveSettings);
    };
    const row = el("div", "", "ra-row ra-end");
    const listen = withIcon(button("Listen", () => safe(() => preview(settings.voice)), true), "speaker");
    listen.disabled = !settings.enabled;
    row.append(field("Main voice", voiceSelect(settings.voice, pick)), listen);
    voicesCard.append(row, el("p", settings.enabled ? "Used for anyone who has no voice of their own. Listen plays a short sample, which may cost a little." : "Turn Readalong on to listen to samples.", "ra-muted"));
    if (settings.provider === "local" || !names.length)
      voicesCard.append(field("Voice name", textInput(settings.voice, (v) => settings.voice = v)), el("p", names.length ? "The list shows common Kokoro voices. Type a voice name if your server uses others." : "This model has no voice list yet. Reload it under Connection, or type a voice name.", "ra-muted"));
    if (names.length) {
      let drawList = function() {
        list.replaceChildren();
        for (const name of names.filter((n) => n.toLowerCase().includes(voiceQuery.toLowerCase()))) {
          const b = button(name, () => pick(name));
          b.setAttribute("aria-pressed", String(name === settings.voice));
          list.append(b);
        }
        if (!list.childElementCount)
          list.append(el("p", "No voice matches that search.", "ra-muted"));
      };
      const search = textInput(voiceQuery, (v) => {
        voiceQuery = v;
        drawList();
      });
      search.placeholder = `Search ${names.length} voices`;
      search.setAttribute("aria-label", "Search voices");
      const list = el("div", "", "ra-voice-list");
      drawList();
      voicesCard.append(search, list);
    }
    if (settings.provider === "lumiverse")
      voicesCard.append(toggle("Use voices already set in Lumiverse", settings.inheritVoices, (v) => {
        settings.inheritVoices = v;
        safe(saveSettings);
      }, "For anyone without a Readalong voice."));
    voicesCard.append(nextStep("Next: give voices to your cast", "cast"));
  }
  const baseName = (name) => name.split("||")[0].trim();
  const emptyVoice = () => ({ voice: "", emotion: "neutral", delivery: "normal" });
  function storyNames() {
    return pronunciationChatId && pronunciationChatId === ctx.getActiveChat().chatId ? Object.values(pronunciationEntries) : [];
  }
  function sayingFor(name) {
    const wanted = name.toLowerCase();
    return wanted ? storyNames().find((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase() === wanted)) : undefined;
  }
  function castName(key) {
    return key.startsWith("id:") ? characters.find((c) => c.id === key.slice(3))?.name ?? "Unknown character" : settings.assignments[key]?.name ?? castDrafts.get(key)?.name ?? addedNames.get(key) ?? key.slice(5);
  }
  function voiceForName(name) {
    const wanted = name.toLowerCase(), character = characters.find((c) => baseName(c.name).toLowerCase() === wanted);
    return settings.assignments[`name:${wanted}`] ?? (character ? settings.assignments[`id:${character.id}`] : undefined);
  }
  function sayingEntry(name, spokenAs, aliases) {
    const entry = pronunciationEntry({ name, spokenAs, aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean) }, "manual");
    if (!entry)
      throw new Error("Type the name and how to say it. Use letters, numbers, spaces, apostrophes or hyphens.");
    return entry;
  }
  async function saveSaying(entry) {
    const chatId = ctx.getActiveChat().chatId;
    if (!chatId)
      throw new Error("Open a story first. How a name is said is saved for each story.");
    const r = await rpc("save_pronunciation", { chatId, entry });
    if (disposed || ctx.getActiveChat().chatId !== chatId)
      return;
    pronunciationEntries = normalizePronunciations(r.entries);
    pronunciationChatId = chatId;
  }
  async function removeSaying(name) {
    const chatId = ctx.getActiveChat().chatId;
    if (!chatId)
      return;
    const r = await rpc("remove_pronunciation", { chatId, name });
    if (disposed || ctx.getActiveChat().chatId !== chatId)
      return;
    pronunciationEntries = normalizePronunciations(r.entries);
    pronunciationChatId = chatId;
  }
  function testSaying(entry, voice, assignment) {
    return preview(voice, assignment, { text: `${entry.name} arrived. I looked at ${entry.name}. ${entry.name}'s voice was calm.`, entries: normalizePronunciations({ [entry.name]: entry }) });
  }
  function castForm(container, key, name, inList = true) {
    const saved = settings.assignments[key], spoken = baseName(name), known = sayingFor(spoken), hasStory = !!ctx.getActiveChat().chatId;
    if (!castDrafts.has(key))
      castDrafts.set(key, { ...saved ?? emptyVoice(), ...key.startsWith("name:") ? { name: spoken } : {} });
    const draft = castDrafts.get(key);
    const say = sayDrafts.get(key) ?? { spokenAs: known?.spokenAs ?? "", aliases: (known?.aliases ?? []).join(", ") };
    const touch = () => {
      sayDrafts.set(key, say);
    };
    container.replaceChildren();
    if (!inList) {
      container.classList.add("ra-stack");
      container.append(el("h3", `Voice for ${spoken}`));
    }
    const listen = withIcon(button("Listen", () => safe(() => preview(draft.voice || settings.voice, draft))), "speaker");
    listen.disabled = !settings.enabled;
    const voiceRow = el("div", "", "ra-row ra-end");
    voiceRow.append(field("Voice", voiceSelect(draft.voice, (v) => draft.voice = v, true)), listen);
    container.append(voiceRow);
    if (settings.provider === "local")
      container.append(field("Voice name", textInput(draft.voice, (v) => draft.voice = v)));
    if (hasStory) {
      const sayInput = textInput(say.spokenAs, (v) => {
        say.spokenAs = v;
        touch();
      });
      sayInput.maxLength = 100;
      sayInput.placeholder = "For example, Eleese";
      sayInput.dataset.raSay = key;
      const test = button("Test", () => safe(() => testSaying(sayingEntry(known?.name ?? spoken, say.spokenAs, say.aliases), draft.voice || settings.voice, draft)));
      test.disabled = !settings.enabled;
      const sayRow = el("div", "", "ra-row ra-end");
      sayRow.append(field("Say the name as", sayInput), test);
      container.append(sayRow);
    } else
      container.append(el("p", "Open a story to set how this name is said.", "ra-muted"));
    const more = disclosure([el("strong", "More")], moreOpen.has(key));
    more.details.addEventListener("toggle", () => {
      if (more.details.isConnected) {
        if (more.details.open)
          moreOpen.add(key);
        else
          moreOpen.delete(key);
      }
    });
    if (hasStory) {
      const also = textInput(say.aliases, (v) => {
        say.aliases = v;
        touch();
      });
      also.maxLength = 810;
      also.placeholder = "Nicknames or other spellings, with commas between";
      more.body.append(field("Also goes by", also));
    }
    const moods = el("div", "", "ra-grid");
    moods.append(field("Usual mood", select(EMOTIONS.map((v) => ({ value: v, label: v })), draft.emotion, (v) => draft.emotion = v)), field("Usual way of speaking", select(DELIVERIES.map((v) => ({ value: v, label: v })), draft.delivery, (v) => draft.delivery = v)));
    more.body.append(moods);
    container.append(more.details);
    const done = () => {
      castDrafts.delete(key);
      sayDrafts.delete(key);
      renderAssignments();
      if (!inList)
        castForm(container, key, name, false);
    };
    const save = button("Save", () => safe(async () => {
      const edited = sayDrafts.has(key), wantsVoice = !!saved || !!draft.voice || draft.emotion !== "neutral" || draft.delivery !== "normal";
      const entry = edited && say.spokenAs.trim() ? sayingEntry(known?.name ?? spoken, say.spokenAs, say.aliases) : undefined;
      if (!wantsVoice && !entry && !(edited && known))
        throw new Error("Pick a voice or type how to say the name first.");
      if (wantsVoice) {
        settings.assignments[key] = { ...draft };
        await saveSettings();
      }
      if (entry)
        await saveSaying(entry);
      else if (edited && known)
        await removeSaying(known.name);
      done();
      notice(entry || edited && known ? `Saved ${spoken}. Audio you already have keeps the old sound.` : `Saved ${spoken}.`);
    }), true);
    const remove = button(inList ? "Remove" : "Clear", () => safe(async () => {
      if (saved || known) {
        const result = await ctx.ui.showConfirm({ title: `Remove ${spoken}?`, message: known ? "This forgets their voice and how their name is said in this story." : "This forgets their voice.", variant: "danger", confirmLabel: "Remove" });
        if (!result.confirmed)
          return;
      }
      if (saved) {
        delete settings.assignments[key];
        await saveSettings();
      }
      if (known)
        await removeSaying(known.name);
      addedCast.delete(key);
      addedNames.delete(key);
      openCast.delete(key);
      if (inList && settings.personaName && key === `name:${settings.personaName.toLowerCase()}`) {
        settings.personaName = "";
        await saveSettings();
      }
      done();
      notice(`Removed ${spoken}.`);
    }));
    remove.classList.add("ra-quiet", "ra-push");
    const actions = el("div", "", "ra-row");
    actions.append(save, remove);
    container.append(actions);
  }
  function fixAName() {
    tab.activate();
    showView("cast");
    if (!fixName && currentSegments[position]) {
      const sentence = plainText(currentSegments[position].text).toLowerCase();
      fixName = castRows().map((r) => baseName(r.name)).find((n) => n && sentence.includes(n.toLowerCase())) ?? "";
      fixSay = sayingFor(fixName)?.spokenAs ?? "";
      renderAssignments();
    }
    const target = assignmentsCard.querySelector(fixName ? '[data-ra-fix="say"]' : '[data-ra-fix="name"]');
    target?.focus();
    target?.select();
  }
  function castRows() {
    const keys = new Set([...Object.keys(settings.assignments).filter((key) => /^(id|name):/.test(key)), ...addedCast]);
    if (!keys.size && !castInitialized) {
      const id = ctx.getActiveChat().characterId ?? characters[0]?.id;
      if (id && characters.some((c) => c.id === id)) {
        addedCast.add(`id:${id}`);
        keys.add(`id:${id}`);
      }
    }
    const you = settings.personaName ? `name:${settings.personaName.toLowerCase()}` : "";
    if (you)
      keys.add(you);
    const rows = [...keys].map((key) => ({ key, name: key === you ? settings.personaName : castName(key), you: key === you }));
    for (const entry of storyNames()) {
      const names = [entry.name, ...entry.aliases].map((n) => n.toLowerCase());
      if (!rows.some((r) => names.includes(baseName(r.name).toLowerCase())))
        rows.push({ key: `name:${entry.name.toLowerCase()}`, name: entry.name, you: false });
    }
    const active = ctx.getActiveChat().characterId, rank = (r) => r.you ? 0 : r.key === `id:${active}` ? 1 : 2;
    return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }
  function renderAssignments() {
    assignmentsCard.replaceChildren();
    const hasStory = !!ctx.getActiveChat().chatId, rows = castRows();
    if (!castInitialized && rows.length) {
      castInitialized = true;
    }
    if (hasStory) {
      const fix = el("div", "", "ra-fix"), names = el("datalist");
      names.id = "ra-cast-names";
      for (const name of new Set(rows.map((r) => baseName(r.name)))) {
        const option = el("option");
        option.value = name;
        names.append(option);
      }
      const nameInput = textInput(fixName, (v) => {
        fixName = v;
        const known = sayingFor(v.trim());
        if (known && !fixSay) {
          fixSay = known.spokenAs;
          sayInput.value = fixSay;
        }
      });
      nameInput.maxLength = 80;
      nameInput.placeholder = "Pick or type a name";
      nameInput.setAttribute("list", names.id);
      nameInput.dataset.raFix = "name";
      const sayInput = textInput(fixSay, (v) => fixSay = v);
      sayInput.maxLength = 100;
      sayInput.placeholder = "For example, Eleese";
      sayInput.dataset.raFix = "say";
      const candidate = () => {
        const known = sayingFor(fixName.trim());
        return sayingEntry(known?.name ?? fixName.trim(), fixSay, (known?.aliases ?? []).join(", "));
      };
      const test = button("Test", () => safe(async () => {
        const entry = candidate(), assigned = voiceForName(entry.name);
        await testSaying(entry, assigned?.voice || settings.voice, assigned);
      }));
      test.disabled = !settings.enabled;
      const save = button("Save", () => safe(async () => {
        const entry = candidate();
        await saveSaying(entry);
        fixName = "";
        fixSay = "";
        sayDrafts.clear();
        renderAssignments();
        notice(`${entry.name} will be said as “${entry.spokenAs}”. Audio you already have keeps the old sound.`);
      }), true);
      const fields = el("div", "", "ra-grid");
      fields.append(field("Name", nameInput), field("Say it as", sayInput));
      const actions = el("div", "", "ra-row");
      actions.append(save, test);
      fix.append(el("h3", "Fix how a name is said"), fields, actions, names);
      assignmentsCard.append(fix);
    }
    assignmentsCard.append(el("h3", "Cast"), el("p", "Everyone in your stories who has a voice, plus the names this story has picked up.", "ra-muted"));
    const narrator = disclosure([el("strong", "Narrator"), el("span", settings.narratorVoice || "Main voice")], openCast.has("narrator"));
    narrator.details.addEventListener("toggle", () => {
      if (narrator.details.isConnected) {
        if (narrator.details.open)
          openCast.add("narrator");
        else
          openCast.delete("narrator");
      }
    });
    const narratorListen = withIcon(button("Listen", () => safe(() => preview(settings.narratorVoice || settings.voice))), "speaker");
    narratorListen.disabled = !settings.enabled;
    const narratorRow = el("div", "", "ra-row ra-end");
    narratorRow.append(field("Voice", voiceSelect(settings.narratorVoice, (v) => {
      settings.narratorVoice = v;
      safe(async () => {
        await saveSettings();
        renderAssignments();
        notice("Narrator voice saved.");
      });
    }, true)), narratorListen);
    narrator.body.append(narratorRow, el("p", "Reads everything that is not inside quotes.", "ra-muted"));
    assignmentsCard.append(narrator.details);
    if (!settings.personaName) {
      const you = disclosure([el("strong", "You"), el("span", "Add your character")], openCast.has("you"));
      you.details.addEventListener("toggle", () => {
        if (you.details.isConnected) {
          if (you.details.open)
            openCast.add("you");
          else
            openCast.delete("you");
        }
      });
      let mine = "";
      const mineInput = textInput("", (v) => mine = v);
      mineInput.maxLength = 80;
      mineInput.placeholder = "The name you play as";
      const youRow = el("div", "", "ra-row ra-end");
      youRow.append(field("Your name in the story", mineInput), button("Add me", () => safe(async () => {
        const name = mine.trim();
        if (!validSpeaker(name))
          throw new Error("Type the name you play as, up to 80 letters.");
        settings.personaName = name;
        openCast.delete("you");
        openCast.add(`name:${name.toLowerCase()}`);
        await saveSettings();
        renderAssignments();
      }), true));
      you.body.append(youRow, el("p", "Gives your own character a voice when a reply speaks for them.", "ra-muted"));
      assignmentsCard.append(you.details);
    }
    for (const row of rows) {
      const saved = settings.assignments[row.key], known = sayingFor(baseName(row.name));
      const summary = [el("strong", row.you ? `You (${row.name})` : baseName(row.name)), el("span", saved?.voice || "No voice yet")];
      if (known)
        summary.push(el("span", `said “${known.spokenAs}”`));
      if (!saved && !known && !row.you)
        summary.push(el("span", "New", "ra-badge"));
      const entry = disclosure(summary, openCast.has(row.key));
      entry.details.classList.add("ra-cast-entry");
      entry.details.dataset.castKey = row.key;
      entry.body.classList.add("ra-cast-form");
      entry.details.addEventListener("toggle", () => {
        if (entry.details.isConnected) {
          if (entry.details.open)
            openCast.add(row.key);
          else
            openCast.delete(row.key);
        }
      });
      assignmentsCard.append(entry.details);
      castForm(entry.body, row.key, row.name);
    }
    const others = disclosure([el("strong", "Everyone else"), el("span", settings.npcVoice || "Same as the main character")], openCast.has("others"));
    others.details.addEventListener("toggle", () => {
      if (others.details.isConnected) {
        if (others.details.open)
          openCast.add("others");
        else
          openCast.delete("others");
      }
    });
    const othersListen = withIcon(button("Listen", () => safe(() => preview(settings.npcVoice || settings.voice))), "speaker");
    othersListen.disabled = !settings.enabled;
    const othersNames = [...voiceNames()];
    if (settings.npcVoice && !othersNames.includes(settings.npcVoice))
      othersNames.unshift(settings.npcVoice);
    const othersRow = el("div", "", "ra-row ra-end");
    othersRow.append(field("Voice", select([{ value: "", label: "Same as the main character" }, ...othersNames.map((name) => ({ value: name, label: name }))], settings.npcVoice, (v) => {
      settings.npcVoice = v;
      safe(async () => {
        await saveSettings();
        renderAssignments();
        notice(v ? "Voice saved for everyone else. Audio you already have keeps the old sound." : "Everyone else now sounds like the main character.");
      });
    })), othersListen);
    others.body.append(othersRow, el("p", "For side characters who speak but have no voice of their own yet. Give someone their own row above to make them sound different.", "ra-muted"));
    if (!settings.promptEmotions)
      others.body.append(el("p", "This only works when “Mark feelings and who is speaking” is on under Connection. That is how Readalong knows who is talking.", "ra-muted"));
    assignmentsCard.append(others.details);
    function addMember(key, name) {
      if (!rows.some((r) => r.key === key) && rows.length >= 500) {
        notice("The cast can hold up to 500 people.", true);
        return;
      }
      addedCast.add(key);
      if (name)
        addedNames.set(key, name);
      openCast.add(key);
      castInitialized = true;
      addOpen = false;
      renderAssignments();
    }
    const add = disclosure([el("strong", "Add someone")], addOpen);
    add.details.addEventListener("toggle", () => {
      if (add.details.isConnected)
        addOpen = add.details.open;
    });
    let characterId = characters.find((c) => c.id === ctx.getActiveChat().characterId)?.id ?? characters[0]?.id ?? "";
    const fromLibrary = el("div", "", "ra-row ra-end");
    if (characters.length)
      fromLibrary.append(field("One of your characters", select(characters.map((c) => ({ value: c.id, label: baseName(c.name) })), characterId, (v) => characterId = v)), button("Add", () => {
        if (characterId)
          addMember(`id:${characterId}`);
      }));
    fromLibrary.append(iconButton("refresh", "Reload characters", () => safe(async () => {
      const r = await rpc("characters");
      characters = r.characters;
      renderAssignments();
    }), "ra-icon"));
    let speaker = "";
    const speakerInput = textInput("", (v) => speaker = v);
    speakerInput.placeholder = "For example, Jason";
    speakerInput.maxLength = 80;
    const byName = el("div", "", "ra-row ra-end");
    const addByName = button("Add", () => {
      const name = speaker.trim();
      if (!validSpeaker(name)) {
        notice("Type a name of up to 80 letters. The narrator already has a row above.", true);
        return;
      }
      addMember(`name:${name.toLowerCase()}`, name);
    });
    addByName.dataset.raControl = "Add by name";
    byName.append(field("Or anyone else, by name", speakerInput), addByName);
    add.body.append(fromLibrary, byName, el("p", "Side characters can have a voice too. For Readalong to tell several speakers apart in one reply, turn on “Mark feelings and who is speaking” under Connection.", "ra-muted"));
    assignmentsCard.append(add.details, toggle("Learn how to say new names", settings.promptPronunciations, (v) => {
      settings.promptPronunciations = v;
      safe(saveSettings);
    }, "The story model suggests how to say each new name. Your own fixes always win."), nextStep("Next: playback options", "options"));
  }
  function decorateMessages() {
    for (const { messageId, element } of ctx.dom.listMessageElements()) {
      if (bubbleHandles.has(messageId))
        continue;
      const handle = ctx.dom.inject(element, '<div class="ra-bubble" data-ra-ui="true"></div>', "beforeend");
      const target = handle.firstElementChild;
      const read = withIcon(button("Read aloud", () => safe(() => readId(messageId))), "speaker");
      read.disabled = !settings.enabled;
      target.append(read);
      bubbleHandles.set(messageId, handle);
    }
  }
  function onEvent(name, fn) {
    cleanups.push(ctx.events.on(name, (p) => fn(p)));
  }
  onEvent("CHAT_SWITCHED", () => {
    completionInbox.reset();
    localGenerations.clear();
    completionRecovery = null;
    pronunciationEpoch++;
    pronunciationEntries = {};
    pronunciationChatId = "";
    sayDrafts.clear();
    fixName = "";
    fixSay = "";
    renderAssignments();
    stop(false);
    messages = [];
    selectedId = "";
    automaticPreparations.clear();
    for (const handle of bubbleHandles.values())
      ctx.dom.uninject(handle);
    bubbleHandles.clear();
    notice(settings.enabled ? "Looking for saved audio…" : "Readalong is off.");
    safe(async () => {
      await refreshPronunciations();
      await refreshMessages();
      await prepareLatest(false, true);
    });
  });
  for (const event of ["MESSAGE_EDITED", "MESSAGE_SWIPED", "SWIPE_EDITED", "MESSAGE_DELETED"])
    onEvent(event, (p) => {
      const id = p?.message?.id ?? p?.messageId;
      if (currentMessage?.id === id)
        stop();
      if (event === "MESSAGE_DELETED" && bubbleHandles.has(id)) {
        ctx.dom.uninject(bubbleHandles.get(id));
        bubbleHandles.delete(id);
      }
      safe(refreshMessages);
    });
  onEvent("GENERATION_STARTED", (p) => {
    if (p?.chatId !== ctx.getActiveChat().chatId)
      return;
    if (typeof p.generationId === "string") {
      localGenerations.set(p.generationId, { chatId: p.chatId, name: p.characterName, characterId: p.characterId, eligible: initialized ? settings.enabled : undefined });
      while (localGenerations.size > 20)
        localGenerations.delete(localGenerations.keys().next().value);
    }
    if (currentMessage)
      stop(false);
  });
  onEvent("GENERATION_ENDED", (p) => {
    const info = localGenerations.get(p?.generationId);
    localGenerations.delete(p?.generationId);
    if (p?.chatId !== ctx.getActiveChat().chatId || !p.messageId || p.error || ["impersonate", "quiet"].includes(p.generationType) || info?.eligible === false)
      return;
    safe(async () => {
      if (!info) {
        await recoverCompletion();
        return;
      }
      const since = completionInbox.since;
      const message = p.content ? { id: p.messageId, content: p.content, name: info.name ?? "", characterId: info.characterId, isUser: false } : (await rpc("message", { chatId: p.chatId, messageId: p.messageId, latestOnly: true })).message;
      if (!message || completionInbox.since !== since)
        return;
      await receiveCompletion({ chatId: p.chatId, messageId: p.messageId, generationId: p.generationId, completedAt: Date.now(), message });
    });
  });
  onEvent("GENERATION_STOPPED", (p) => {
    localGenerations.delete(p?.generationId);
    if (p?.chatId === ctx.getActiveChat().chatId && currentMessage)
      stop();
  });
  onEvent("CONNECTED", () => {
    safe(recoverCompletion);
  });
  onEvent("CHARACTER_MESSAGE_RENDERED", () => decorateMessages());
  cleanups.push(tab.onActivate(() => {
    safe(async () => {
      await refreshPronunciations();
      await refreshMessages();
      await recoverCompletion();
    });
  }));
  const onReturn = () => {
    if (document.visibilityState === "visible")
      safe(recoverCompletion);
  };
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("focus", onReturn);
  cleanups.push(() => {
    document.removeEventListener("visibilitychange", onReturn);
    window.removeEventListener("focus", onReturn);
  });
  const recoveryTimer = setInterval(() => {
    safe(recoverCompletion);
  }, 15000);
  cleanups.push(() => clearInterval(recoveryTimer));
  const action = ctx.ui.registerInputBarAction({ id: "readalong", label: "Readalong", subtitle: "Listen and find your place" });
  cleanups.push(action.onClick(() => {
    tab.activate();
    safe(openWidget);
  }));
  function installEditor() {
    if (editorTab || !permissions.includes("characters"))
      return;
    editorTab = ctx.ui.registerCharacterEditorTab({ id: "readalong-voice", title: "Readalong voice" });
    editorTab.root.classList.add("ra");
    editorTab.root.dataset.raUi = "true";
    const render = () => {
      const state = ctx.ui.characterEditor.getState();
      if (state.open && state.characterId)
        castForm(editorTab.root, `id:${state.characterId}`, characters.find((c) => c.id === state.characterId)?.name ?? "this character", false);
    };
    cleanups.push(ctx.ui.characterEditor.onChange(render), editorTab.onActivate(render));
    render();
  }
  if ("speechSynthesis" in window) {
    const refresh = () => {
      if (settings.provider === "browser") {
        renderVoices();
        renderAssignments();
      }
    };
    speechSynthesis.addEventListener("voiceschanged", refresh);
    cleanups.push(() => speechSynthesis.removeEventListener("voiceschanged", refresh));
  }
  renderPlayer();
  renderOptions();
  renderConfig();
  renderVoices();
  renderAssignments();
  ctx.ready();
  safe(async () => {
    const r = await rpc("init");
    if (disposed)
      return;
    settings = normalizeSettings(r.settings);
    completionInbox.initialize(settings.enabled);
    cacheUserId = typeof r.userId === "string" ? r.userId : "";
    Object.assign(hasKeys, r.hasKeys ?? { openrouter: r.hasKey, local: false });
    permissions = r.permissions;
    ready = true;
    try {
      nativeConnections = await nativeTts.connections();
      if (disposed)
        return;
      const existing = nativeConnections.find((c) => c.provider === "openrouter_tts" && c.model === settings.model) ?? nativeConnections.find((c) => c.provider === "openrouter_tts");
      if (needsPcm(settings) && existing) {
        chooseNative(existing, true);
        await saveSettings();
      } else if (settings.provider === "lumiverse" && !settings.connectionId && nativeConnections.length) {
        chooseNative(existing ?? nativeConnections[0]);
        await saveSettings();
      }
    } catch {}
    renderPlayer();
    renderOptions();
    renderConfig();
    renderVoices();
    renderAssignments();
    installEditor();
    if (!viewChosen)
      showView(settings.provider === "lumiverse" ? settings.connectionId ? "cast" : "connection" : settings.provider === "openrouter" && !hasKeys.openrouter ? "connection" : "cast");
    if (r.cueStatus)
      notice(r.cueStatus, true);
    else
      notice("Ready. New here? Start with Connection, then try a voice.");
    if (permissions.includes("characters")) {
      try {
        const r = await rpc("characters");
        characters = r.characters;
        renderAssignments();
      } catch {}
    }
    initialized = true;
    if (settings.provider === "lumiverse" || permissions.includes("cors_proxy"))
      refreshCatalog().catch(() => {});
    if (permissions.includes("chat_mutation")) {
      await refreshPronunciations();
      await refreshMessages();
      await flushCompletion();
      if (!currentMessage)
        await prepareLatest(false, true);
      await recoverCompletion();
    }
    if (!settings.enabled)
      notice("Readalong is off. Nothing is sent to your voice service.");
  });
  return () => {
    stop(false);
    disposed = true;
    marker.dispose();
    audioPlayer.dispose();
    widgetDragCleanup?.();
    widget?.destroy();
    for (const fn of cleanups)
      fn();
    editorTab?.destroy();
    action.destroy();
    tab.destroy();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Readalong unloaded."));
    }
    pending.clear();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
