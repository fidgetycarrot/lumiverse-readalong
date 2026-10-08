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
    localUrl: str(r.localUrl, DEFAULTS.localUrl, 500),
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULTS.enabled,
    follow: r.follow === true,
    earlyPlayback: r.earlyPlayback !== false,
    promptEmotions: r.promptEmotions !== false,
    useEmotions: r.useEmotions !== false,
    promptPronunciations: r.promptPronunciations !== false,
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
function planSpeech(segments, settings, context) {
  const passages = [];
  let previousKey = "";
  for (const source of segments) {
    let segment = source;
    const characterId = speakerCharacterId(segment.speaker, context.characters, context.characterId);
    const assignment = selectVoice(settings, segment, characterId);
    const narrator = segment.speaker.trim().toLowerCase() === "narrator";
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
  const height = Math.min(minimized ? narrow ? 112 : touch ? 64 : 56 : width < 280 ? 240 : 184, Math.max(1, viewport.height - PAD * 2));
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
function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  if (text)
    node.textContent = text;
  if (className)
    node.className = className;
  return node;
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
function toggle(label, value, change) {
  const row = el("label", "", "ra-toggle"), i = el("input");
  i.type = "checkbox";
  i.checked = value;
  i.onchange = (e) => change(e.currentTarget.checked);
  row.append(i, el("span", label));
  return row;
}
function timeLabel(seconds) {
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function setup(ctx) {
  let settings = normalizeSettings(DEFAULTS), ready = false, initialized = false, disposed = false;
  const hasKeys = { openrouter: false, local: false }, frontendId = crypto.randomUUID();
  const castDrafts = new Map, openCast = new Set;
  let castInitialized = false;
  let canDiagnoseSpeech = false, diagnosing = false, diagnoseButton = null;
  let diagnoseHint = null;
  let models = [{ id: DEFAULTS.model, name: "Google: Gemini 3.8 Flash TTS", voices: GEMINI_VOICES }];
  const nativeTts = createNativeTtsClient(), nativeRequests = new Set;
  let nativeConnections = [], catalogEpoch = 0;
  let characters = [], permissions = [];
  let messages = [], selectedId = "";
  let pronunciationEntries = {}, pronunciationChatId = "", pronunciationEpoch = 0;
  const openPronunciations = new Set;
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
  const widgetPermissionHint = "Enable the UI panels permission (ui_panels) in Readalong’s extension settings to use the floating player. You can play and pause here in the meantime.";
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
  const heading = el("h2", "Readalong");
  const intro = el("p", "Find your place at a glance. Give each character a voice.", "ra-muted");
  const status = el("p", "Loading…", "ra-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const player = el("section", "", "ra-card"), config = el("section", "", "ra-card"), voicesCard = el("section", "", "ra-card"), assignmentsCard = el("section", "", "ra-card"), pronunciationsCard = el("section", "", "ra-card");
  root.append(heading, intro, status, player, config, voicesCard, assignmentsCard, pronunciationsCard);
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
    return select([...inherited ? [{ value: "", label: "Use default voice" }] : [], ...names.map((name) => ({ value: name, label: name }))], value, change);
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
    const header = el("div", "", "ra-row"), title = el("div", "", "ra-widget-heading");
    title.append(el("strong", "Readalong"));
    header.append(title);
    if (audioPlayer.duration) {
      const time = el("span", `${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`, "ra-time");
      title.append(time);
    }
    const close = button("×", () => widget?.setVisible(false));
    close.className = "ra-icon";
    close.setAttribute("aria-label", "Hide floating player");
    close.title = "Hide floating player";
    const resize = button(settings.widgetMinimized ? "↗" : "−", () => safe(() => setWidgetMinimized(!settings.widgetMinimized)));
    resize.className = "ra-icon";
    resize.setAttribute("aria-label", settings.widgetMinimized ? "Expand floating player" : "Minimize floating player");
    resize.title = resize.getAttribute("aria-label");
    resize.setAttribute("aria-expanded", String(!settings.widgetMinimized));
    const caption = el("p", phase === "playing" || phase === "paused" ? `${currentSegments[position]?.speaker || "Voice"} · ${currentPassages[currentPassage]?.voice || ""}` : status.textContent ?? "Choose a message.", "ra-caption");
    caption.title = plainText(currentSegments[position]?.text ?? caption.textContent ?? "");
    const controls = el("div", "", "ra-row ra-controls");
    const playLabel = !settings.enabled ? "Turn on" : playAttempt ? "Starting…" : messageLoad ? "Loading…" : phase === "preparing" ? checkingSavedAudio ? "Loading…" : "Preparing…" : phase === "idle" ? "Load saved" : phase === "paused" ? "Resume" : phase === "playing" ? "Pause" : phase === "finished" ? "Replay" : "Play";
    const play = button(playLabel, () => safe(settings.enabled ? playOrPause : () => setEnabled(true)), true);
    play.title = playLabel;
    play.dataset.raControl = "play";
    play.disabled = !ready || !!playAttempt || !!messageLoad || settings.enabled && (phase === "preparing" || phase === "idle" && !selectedId);
    controls.append(play);
    const stopButton = button("Stop", () => stop());
    stopButton.disabled = phase === "idle";
    controls.append(stopButton, button("Open player", () => tab.activate()));
    const power = button(settings.enabled ? "On" : "Off", () => safe(() => setEnabled(!settings.enabled)));
    power.className = "ra-power";
    power.setAttribute("aria-label", settings.enabled ? "Turn Readalong off" : "Turn Readalong on");
    power.title = power.getAttribute("aria-label");
    const progress = el("progress");
    progress.max = 1;
    progress.value = preparingAudio ? preparedCount / Math.max(1, currentPassages.length) : phase === "finished" ? 1 : phase === "ready" ? 0 : audioPlayer.duration ? audioPlayer.elapsed / audioPlayer.duration : position / Math.max(1, currentSegments.length);
    progress.setAttribute("aria-label", preparingAudio ? "Speech preparation" : "Playback progress");
    if (settings.widgetMinimized) {
      play.textContent = phase === "preparing" ? "…" : phase === "playing" ? "Ⅱ" : phase === "finished" ? "↻" : "▶";
      play.setAttribute("aria-label", playLabel);
      play.classList.add("ra-compact-play");
      const info = el("div", "", "ra-compact-info");
      info.append(el("strong", "Readalong"));
      const detail = el("span", !settings.enabled ? "Off" : audioPlayer.duration && ["playing", "paused", "ready", "finished"].includes(phase) ? `${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}` : playLabel, audioPlayer.duration && settings.enabled && phase !== "preparing" ? "ra-compact-status ra-time" : "ra-compact-status");
      detail.title = status.textContent ?? "";
      info.append(detail);
      patchPlaybackChildren(widget.root, play, info, power, resize, close, progress);
    } else {
      const tools = el("div", "", "ra-row ra-widget-tools");
      tools.append(power, resize, close);
      header.append(tools);
      patchPlaybackChildren(widget.root, header, caption, controls, progress);
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
    const time = widget?.root.querySelector(".ra-time");
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
    notice(currentPassages[0]?.settings.provider === "browser" ? "Finished. Replay reads this passage again." : "Finished. Replay uses the prepared audio.");
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
      notice(waiting ? "Waiting for the remaining audio. Preparation continues; no retry was sent." : "Reading…");
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
      notice(waitingForAudio ? "Waiting for the remaining audio. Preparation continues; no retry was sent." : preparingAudio ? "Reading… Remaining audio is still preparing." : "Reading…");
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
      renderPronunciations();
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
      throw new Error("Choose a saved Lumiverse TTS connection first. Add one in Lumiverse’s voice settings if the list is empty.");
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
      notice("Readalong is on. New assistant replies will prepare automatically.");
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
    renderPronunciations();
    notice(enabled ? "Readalong is on. Preparing the latest reply…" : "Readalong is off. No speech requests will be started.");
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
    notice("Looking for saved audio. No speech requested yet.");
    renderPlayer();
    try {
      const snapshot = normalizeSettings(settings);
      const chatId = ctx.getActiveChat().chatId;
      const context = {
        characters,
        characterId: currentMessage.characterId,
        connections: nativeConnections,
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
            notice("No saved audio for this message. No speech was requested. Choose Prepare message to generate it; charges may apply.");
            return;
          }
          const claim = await rpc("claim_preparation", { key: messageKey, manual: !options.automatic });
          if (token !== playbackId)
            return;
          if (!claim?.allowed) {
            stop(false);
            notice("This message was already prepared or attempted. No speech was requested again. Choose Prepare message to retry; speech charges may apply.");
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
            notice(phase === "playing" ? `Reading… ${count} of ${currentPassages.length} passages ready; preparation continues.` : phase === "paused" ? `Paused. ${count} of ${currentPassages.length} passages ready; preparation continues.` : openingCount ? `Opening audio is ready. Press Play while the rest prepares · ${count} of ${currentPassages.length} passages ready.` : `Preparing the whole message · ${count} of ${currentPassages.length} passages ready…`);
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
      notice(restored ? "Saved audio restored. No speech request or new charge. Press Play." : !saved ? "Audio could not be saved for refresh. It will not regenerate automatically." : phase === "playing" ? "Reading… The whole message is ready." : phase === "paused" ? "Paused. The whole message is ready." : phase === "finished" ? "Finished. Replay uses the prepared audio." : "The whole message is ready. Press Play.");
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
    const snapshot = normalizeSettings({ ...settings, voice, narratorVoice: "", assignments: {}, inheritVoices: false });
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
      notice(settings.enabled ? "Readalong is on. New replies prepare automatically." : "Readalong is off. No speech requests will be started.");
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
    const playerContent = el("section");
    playerContent.append(el("h3", phase === "preparing" ? checkingSavedAudio ? "Looking for saved audio" : "Preparing the whole message" : phase === "ready" ? "Ready to play" : phase === "playing" || phase === "paused" ? "Now reading" : "Listen to a passage"));
    playerContent.append(toggle("Readalong on · prepare replies automatically", settings.enabled, (v) => {
      safe(() => setEnabled(v));
    }), el("p", "When on, new replies prepare automatically and may incur speech charges. Refresh restores saved audio without generating speech. Turning on prepares the latest reply once. Audio waits for Play. Turn off to stop new requests.", "ra-muted"));
    const row = el("div", "", "ra-row");
    if (phase !== "idle") {
      const play = button(playAttempt ? "Starting…" : phase === "paused" ? "Resume" : phase === "playing" ? "Pause" : phase === "finished" ? "Replay" : "Play", () => safe(playOrPause), true);
      play.dataset.raControl = "play";
      play.disabled = phase === "preparing" || !!playAttempt;
      row.append(play, button("Stop", () => stop()));
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
      row.append(read, button("Refresh messages", () => safe(refreshMessages)));
    }
    if (typeof ctx.ui.createFloatWidget === "function")
      row.append(button("Floating player", () => safe(openWidget)));
    if (currentMessage)
      row.append(button("Return to passage", () => marker.follow()));
    playerContent.append(row);
    if (ready && typeof ctx.ui.createFloatWidget === "function" && (widgetError || !permissions.includes("ui_panels")))
      playerContent.append(el("p", widgetError || widgetPermissionHint, "ra-muted"));
    if (phase === "idle" && messages.length)
      playerContent.append(field("Assistant message", select([...messages].reverse().map((m) => ({ value: m.id, label: `${m.name || "Assistant"} · ${plainText(stripCues(m.content)).slice(0, 70)}` })), selectedId, (v) => {
        selectedId = v;
      })));
    if (currentSegments.length) {
      const segment = currentSegments[position], progress = el("progress");
      progress.max = preparingAudio ? currentPassages.length : currentSegments.length;
      progress.value = preparingAudio ? preparedCount : phase === "ready" ? 0 : position + 1;
      progress.setAttribute("aria-label", preparingAudio ? "Speech preparation" : "Playback progress");
      playerContent.append(el("p", `${segment?.speaker || "Voice"} · ${currentPassages[currentPassage]?.voice || ""} · Sentence ${position + 1} of ${currentSegments.length}`, "ra-muted"), progress, el("p", plainText(segment?.text ?? ""), "ra-passage"));
      if (currentMessage)
        playerContent.append(el("p", "The sentence marker estimates your place within continuous audio. Pausing keeps it in place.", "ra-muted"));
    } else
      playerContent.append(el("p", settings.enabled ? "Prepare message reuses matching saved audio. If none is available, it generates speech and charges may apply." : "Readalong is off. Turn it on when you want prepared speech.", "ra-muted"));
    playerContent.append(toggle("Follow the spoken passage as it moves down the page", settings.follow, (v) => {
      settings.follow = v;
      safe(saveSettings);
    }));
    playerContent.append(toggle("Allow Play when about 75% of the message is ready", settings.earlyPlayback, (v) => {
      settings.earlyPlayback = v;
      safe(saveSettings);
    }), el("p", "Needs at least 30 seconds ready in order. You still press Play. The rest prepares using the same requests; playback waits if it catches up. One-file messages become playable when that file finishes.", "ra-muted"));
    const slider = el("input");
    slider.type = "range";
    slider.min = ".5";
    slider.max = "2";
    slider.step = ".1";
    slider.value = String(settings.speed);
    slider.oninput = (e) => {
      const input = e.currentTarget;
      settings.speed = Number(input.value);
      const label = input.parentElement?.querySelector("span");
      if (label)
        label.textContent = `Playback speed · ${settings.speed.toFixed(1)}×`;
      audioPlayer.setSpeed(settings.speed);
    };
    slider.onchange = () => {
      safe(saveSettings);
    };
    const speedLabel = el("span", `Playback speed · ${settings.speed.toFixed(1)}×`), speedField = el("label", "", "ra-field");
    speedField.append(speedLabel, slider);
    const volume = el("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "1";
    volume.step = ".05";
    volume.value = String(settings.volume);
    volume.oninput = (e) => {
      settings.volume = Number(e.currentTarget.value);
      audioPlayer.setVolume(settings.volume);
    };
    volume.onchange = () => {
      safe(saveSettings);
    };
    const controls = el("div", "", "ra-grid");
    controls.append(speedField, field("Volume", volume));
    playerContent.append(controls);
    patchPlaybackChildren(player, ...playerContent.childNodes);
    renderWidget();
  }
  function renderConfig() {
    config.replaceChildren(el("h3", "Speech connection"));
    config.append(field("Provider", select([{ value: "lumiverse", label: "Lumiverse connection · recommended" }, { value: "openrouter", label: "OpenRouter · direct" }, { value: "browser", label: "Browser voices · free" }, { value: "local", label: "Local / OpenAI-compatible" }], settings.provider, (v) => {
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
      renderConfig();
      renderVoices();
      renderAssignments();
      safe(async () => {
        await saveSettings();
        await refreshCatalog();
      });
    })));
    if (settings.provider === "lumiverse") {
      config.append(field("Saved TTS connection", select([{ value: "", label: "Choose a connection" }, ...nativeConnections.map((c) => ({ value: c.id, label: `${c.name} · ${c.provider.replace(/_tts$/, "")}` }))], settings.connectionId, (v) => {
        stop(false);
        const connection = nativeConnections.find((c) => c.id === v);
        if (connection)
          chooseNative(connection);
        else
          settings.connectionId = "";
        renderConfig();
        renderVoices();
        renderAssignments();
        safe(async () => {
          await saveSettings();
          await refreshCatalog();
        });
      })));
      config.append(button("Refresh connections and voices", () => safe(refreshNativeConnections)));
      if (models.length && activeNative())
        config.append(field("Speech model", select(models.map((m) => ({ value: m.id, label: m.name })), settings.model, (v) => {
          stop(false);
          settings.model = v;
          settings.voice = voiceNames()[0] ?? "";
          renderConfig();
          renderVoices();
          renderAssignments();
          safe(saveSettings);
        })));
      config.append(el("p", "Uses your saved Lumiverse TTS connection and key. No separate key or helper app is needed. Add or edit connections in Lumiverse’s voice settings.", "ra-muted"));
      config.append(button("Check connection", () => safe(async () => {
        if (!activeNative())
          throw new Error("Choose a saved TTS connection first.");
        notice("Checking connection…");
        notice(await nativeTts.check(settings.connectionId));
      })));
      if (/gemini-3\.8.*tts/i.test(settings.model))
        config.append(el("p", "Gemini 3.8 supports your preset’s inline vocal sounds and pauses. Separate Readalong emotion directions are not yet supported through this connection.", "ra-muted"));
      diagnoseButton = null;
      diagnoseHint = null;
    }
    if (settings.provider === "openrouter") {
      config.append(field("Speech model", select(models.map((m) => ({ value: m.id, label: m.name })), settings.model, (v) => {
        stop(false);
        settings.model = v;
        settings.voice = voiceNames()[0] ?? "";
        renderConfig();
        renderVoices();
        renderAssignments();
        safe(saveSettings);
      })));
      config.append(button("Refresh models and voices", () => safe(async () => {
        const r = await rpc("models");
        models = r.models;
        if (!models.some((m) => m.id === settings.model))
          models.unshift({ id: settings.model, name: settings.model, voices: [] });
        renderConfig();
        renderVoices();
        renderAssignments();
        notice("Voice lists updated from OpenRouter.");
      })));
    }
    if (settings.provider === "local")
      config.append(field("API base URL", textInput(settings.localUrl, (v) => settings.localUrl = v)), field("Model ID", textInput(settings.model, (v) => settings.model = v)));
    if (settings.provider !== "browser" && settings.provider !== "lumiverse") {
      const provider = settings.provider;
      const key = textInput("", () => {}, "password");
      key.autocomplete = "off";
      key.placeholder = hasKeys[provider] ? "Key saved · leave blank to keep it" : "Paste your API key";
      config.append(field("API key", key), button("Save key", () => safe(async () => {
        if (!key.value.trim())
          throw new Error("Paste a key first.");
        const r = await rpc("save_key", { key: key.value, provider, localUrl: settings.localUrl });
        hasKeys[provider] = r.hasKey;
        key.value = "";
        key.placeholder = "Key saved";
        notice("API key saved securely.");
      })), button("Remove saved key", () => safe(async () => {
        const result = await ctx.ui.showConfirm({ title: "Remove saved key?", message: `Remove the Readalong ${provider === "local" ? "local-provider" : "OpenRouter"} key? Lumiverse’s saved TTS connections are unaffected.`, variant: "danger", confirmLabel: "Remove key" });
        if (!result.confirmed)
          return;
        await rpc("remove_key", { provider, confirmed: true });
        hasKeys[provider] = false;
        key.placeholder = "Paste your API key";
        notice("Saved key removed.");
      })));
      if (provider === "local")
        config.append(el("p", "A local key is bound to this exact server address. Changing the address requires saving a key for it again. Remote servers with keys must use HTTPS.", "ra-muted"));
      config.append(el("p", "Your key stays in encrypted extension storage. Each preview or reading makes a speech request to this connection.", "ra-muted"));
      config.append(button("Check connection", () => safe(async () => {
        notice("Checking connection…");
        const r = await rpc("check_connection", { settings });
        notice(r.message);
      })));
      diagnoseButton = button("Show provider error", () => safe(async () => {
        if (diagnosing)
          return;
        diagnosing = true;
        stop(false);
        showDiagnostics(false);
        notice("Reading the provider response…");
        try {
          const r = await rpc("diagnose_speech");
          notice(r.message);
        } finally {
          diagnosing = false;
          showDiagnostics(canDiagnoseSpeech);
        }
      }));
      diagnoseHint = el("p", "Show provider error repeats the last failed speech request once to read its status and message. If that request succeeds, the provider may charge for speech.", "ra-muted");
      config.append(diagnoseButton, diagnoseHint);
      showDiagnostics(canDiagnoseSpeech);
    } else {
      diagnoseButton = null;
      diagnoseHint = null;
    }
    config.append(toggle("Ask the existing chat model for occasional emotion and speaker cues", settings.promptEmotions, (v) => settings.promptEmotions = v), toggle("Use emotion cues when the speech model supports them", settings.useEmotions, (v) => settings.useEmotions = v), button("Save settings", () => safe(saveSettings), true));
    config.append(el("p", "Emotion cues add a few tokens to normal chat replies. No second LLM is called. Hidden tags remain in the original message.", "ra-muted"));
  }
  function renderVoices() {
    voicesCard.replaceChildren(el("h3", "Choose a voice"));
    const row = el("div", "", "ra-row");
    const listen = button("Listen", () => safe(() => preview(settings.voice)));
    listen.disabled = !settings.enabled;
    row.append(field("Default voice", voiceSelect(settings.voice, (v) => {
      settings.voice = v;
      renderVoices();
      safe(saveSettings);
    })), listen);
    voicesCard.append(row);
    if (settings.provider === "local")
      voicesCard.append(field("Other voice ID", textInput(settings.voice, (v) => settings.voice = v)), el("p", "The listed voices are common Kokoro defaults. Enter a voice ID for another local server.", "ra-muted"));
    const names = voiceNames();
    const search = textInput("", (v) => drawList(v));
    search.placeholder = "Search voices";
    search.setAttribute("aria-label", "Search voices");
    const list = el("div", "", "ra-voice-list");
    const count = el("p", `${names.length} voices${settings.provider === "openrouter" ? " for this model" : ""}. Choose a voice, then listen to a short sample.`, "ra-muted");
    function drawList(query = "") {
      list.replaceChildren();
      for (const name of names.filter((n) => n.toLowerCase().includes(query.toLowerCase()))) {
        const b = button(name, () => {
          settings.voice = name;
          renderVoices();
          safe(saveSettings);
        });
        b.setAttribute("aria-pressed", String(name === settings.voice));
        list.append(b);
      }
    }
    drawList();
    voicesCard.append(count, search, list);
    if (!names.length)
      voicesCard.append(el("p", "This model has no voice list yet. Refresh models, or enter the voice ID below.", "ra-muted"), field("Voice ID", textInput(settings.voice, (v) => settings.voice = v)));
    voicesCard.append(field("Narrator voice", voiceSelect(settings.narratorVoice, (v) => {
      settings.narratorVoice = v;
      safe(saveSettings);
    }, true)));
    if (settings.provider === "lumiverse")
      voicesCard.append(toggle("Use Lumiverse’s saved character and narrator voices when no Readalong voice is assigned", settings.inheritVoices, (v) => {
        settings.inheritVoices = v;
        safe(saveSettings);
      }));
    voicesCard.append(el("p", "Quoted dialogue uses the speaking character; surrounding prose uses the narrator. A speaker cue inside a quote selects its character and ends at the closing quote. Choose different voices to hear the switch.", "ra-muted"));
  }
  function assignmentForm(key, name, container, options) {
    const assignment = options?.draft ?? { ...settings.assignments[key] ?? { voice: "", emotion: "neutral", delivery: "normal" } };
    container.replaceChildren(el("h3", `Voice for ${name}`));
    const update = async () => {
      settings.assignments[key] = { ...assignment };
      await saveSettings();
      if (options)
        options.onSaved();
      else {
        castDrafts.delete(key);
        renderAssignments();
      }
      notice(`Voice saved for ${name}.`);
    };
    container.append(field("Voice", voiceSelect(assignment.voice, (v) => assignment.voice = v, true)));
    if (settings.provider === "local")
      container.append(field("Custom voice ID", textInput(assignment.voice, (v) => assignment.voice = v)));
    const row = el("div", "", "ra-grid");
    row.append(field("Default emotion", select(EMOTIONS.map((v) => ({ value: v, label: v })), assignment.emotion, (v) => assignment.emotion = v)), field("Default delivery", select(DELIVERIES.map((v) => ({ value: v, label: v })), assignment.delivery, (v) => assignment.delivery = v)));
    container.append(row);
    const listen = button("Listen", () => safe(() => preview(assignment.voice || settings.voice, assignment)));
    listen.disabled = !settings.enabled;
    const actions = el("div", "", "ra-row");
    actions.append(listen, button("Save voice", () => safe(update), true), button(options ? "Remove cast voice" : "Use defaults", () => safe(options?.onRemove ?? (async () => {
      delete settings.assignments[key];
      castDrafts.delete(key);
      openCast.delete(key);
      await saveSettings();
      assignmentForm(key, name, container);
      renderAssignments();
    }))));
    container.append(actions);
    const pronunciation = el("details");
    pronunciation.append(el("summary", "Name pronunciation for this story"));
    pronunciationForm(pronunciation, name.split("||")[0].trim(), assignment.voice || settings.voice, assignment);
    container.append(pronunciation);
  }
  function pronunciationForm(container, initialName, voice = settings.voice, assignment, saved) {
    const chatId = ctx.getActiveChat().chatId;
    const known = saved ?? Object.values(pronunciationEntries).find((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase() === initialName.toLowerCase()));
    let name = known?.name ?? initialName, spokenAs = known?.spokenAs ?? "", aliases = (known?.aliases ?? []).join(", ");
    const nameInput = textInput(name, (v) => name = v);
    nameInput.maxLength = 80;
    nameInput.readOnly = !!saved;
    const soundInput = textInput(spokenAs, (v) => spokenAs = v);
    soundInput.maxLength = 100;
    soundInput.placeholder = "For example, Eleese";
    const aliasInput = textInput(aliases, (v) => aliases = v);
    aliasInput.maxLength = 810;
    aliasInput.placeholder = "For example, Elys-04";
    container.append(field("Name in the story", nameInput), field("Pronounce as", soundInput), field("Other spellings or nicknames (comma separated)", aliasInput));
    const candidate = () => {
      const entry = pronunciationEntry({ name, spokenAs, aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean) }, "manual");
      if (!entry)
        throw new Error("Enter a name and its spoken spelling first.");
      if (!chatId || ctx.getActiveChat().chatId !== chatId)
        throw new Error("Select this story again before saving its pronunciation.");
      return entry;
    };
    const test = button("Test pronunciation", () => safe(async () => {
      const entry = candidate();
      await preview(voice, assignment, { text: `${entry.name} arrived. I looked at ${entry.name}. ${entry.name}'s voice was calm.`, entries: normalizePronunciations({ [entry.name]: entry }) });
    }));
    test.disabled = !settings.enabled || !chatId;
    const save = button("Save pronunciation", () => safe(async () => {
      const entry = candidate(), r = await rpc("save_pronunciation", { chatId, entry });
      if (disposed || ctx.getActiveChat().chatId !== chatId)
        return;
      pronunciationEntries = normalizePronunciations(r.entries);
      pronunciationChatId = chatId;
      renderPronunciations();
      renderAssignments();
      notice(`Pronunciation saved for ${entry.name}. Existing audio was not regenerated.`);
    }), true);
    save.disabled = !chatId;
    const actions = el("div", "", "ra-row");
    actions.append(test, save);
    if (saved)
      actions.append(button("Remove pronunciation", () => safe(async () => {
        if (ctx.getActiveChat().chatId !== chatId)
          return;
        const r = await rpc("remove_pronunciation", { chatId, name: saved.name });
        if (disposed || ctx.getActiveChat().chatId !== chatId)
          return;
        pronunciationEntries = normalizePronunciations(r.entries);
        openPronunciations.delete(saved.name);
        renderPronunciations();
        renderAssignments();
        notice(`Pronunciation removed for ${saved.name}. Existing audio was not regenerated.`);
      })));
    container.append(actions, el("p", "Saving changes future speech only. Test pronunciation uses one short speech request and may incur a provider charge.", "ra-muted"));
  }
  function renderPronunciations() {
    pronunciationsCard.replaceChildren(el("h3", "Story pronunciations"));
    pronunciationsCard.append(toggle("Automatically remember new character pronunciations", settings.promptPronunciations, (v) => {
      settings.promptPronunciations = v;
      safe(saveSettings);
    }), el("p", "Readalong asks your existing chat model for a hidden cue when it introduces a new name. The first choice is saved for this chat; your corrections take priority. No preset edit or second LLM is needed. Names and reading markers keep their original spelling.", "ra-muted"));
    if (!ctx.getActiveChat().chatId) {
      pronunciationsCard.append(el("p", "Open a story to manage its pronunciations.", "ra-muted"));
      return;
    }
    const entries = pronunciationChatId === ctx.getActiveChat().chatId ? Object.values(pronunciationEntries) : [];
    pronunciationsCard.append(el("p", `${entries.length} saved pronunciations for this story. Existing recordings change only if you explicitly prepare them again; speech charges may apply.`, "ra-muted"));
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = el("details", "", "ra-cast-entry");
      row.open = openPronunciations.has(entry.name);
      row.dataset.pronunciationName = entry.name;
      row.append(el("summary", `${entry.name} → ${entry.spokenAs} · ${entry.source === "manual" ? "Your correction" : "Automatic"}`));
      row.addEventListener("toggle", () => {
        if (row.isConnected) {
          if (row.open)
            openPronunciations.add(entry.name);
          else
            openPronunciations.delete(entry.name);
        }
      });
      const names = [entry.name, ...entry.aliases].map((n) => n.toLowerCase());
      const character = characters.find((c) => names.includes(c.name.split("||")[0].trim().toLowerCase())), assigned = names.map((n) => settings.assignments[`name:${n}`]).find(Boolean) ?? (character ? settings.assignments[`id:${character.id}`] : undefined);
      pronunciationForm(row, entry.name, assigned?.voice || settings.voice, assigned, entry);
      pronunciationsCard.append(row);
    }
    const add = el("details");
    add.append(el("summary", "Add or correct a name"));
    pronunciationForm(add, "");
    pronunciationsCard.append(add);
  }
  function renderAssignments() {
    assignmentsCard.replaceChildren(el("h3", "Character voices"), el("p", "Build a cast with a separate voice for each character or speaker. Readalong voices override inherited Lumiverse voices; choose compatible voices again after changing provider or model.", "ra-muted"));
    const keys = new Set([...Object.keys(settings.assignments).filter((key) => /^(id|name):/.test(key)), ...castDrafts.keys()]);
    if (!keys.size && !castInitialized) {
      const id = ctx.getActiveChat().characterId ?? characters[0]?.id;
      if (id && characters.some((c) => c.id === id)) {
        const key = `id:${id}`;
        castDrafts.set(key, { voice: "", emotion: "neutral", delivery: "normal" });
        keys.add(key);
      }
    }
    if (!castInitialized && keys.size) {
      openCast.add([...keys][0]);
      castInitialized = true;
    }
    assignmentsCard.append(el("p", `${Object.keys(settings.assignments).filter((key) => /^(id|name):/.test(key)).length} saved cast voices. Add more below. Each row opens independently.`, "ra-muted"));
    for (const key of keys) {
      if (!castDrafts.has(key))
        castDrafts.set(key, { ...settings.assignments[key] });
      const draft = castDrafts.get(key), name = key.startsWith("id:") ? characters.find((c) => c.id === key.slice(3))?.name ?? `Character ${key.slice(3)}` : draft.name ?? key.slice(5);
      const entry = el("details", "", "ra-cast-entry");
      entry.open = openCast.has(key);
      entry.dataset.castKey = key;
      entry.append(el("summary", `${name} · ${settings.assignments[key]?.voice || "Uses defaults"}${!settings.assignments[key] ? " · not saved" : ""}`));
      entry.addEventListener("toggle", () => {
        if (entry.isConnected) {
          if (entry.open)
            openCast.add(key);
          else
            openCast.delete(key);
        }
      });
      const form = el("div", "", "ra-cast-form");
      entry.append(form);
      assignmentsCard.append(entry);
      assignmentForm(key, name, form, { draft, onSaved: () => {
        castDrafts.delete(key);
        renderAssignments();
      }, onRemove: async () => {
        delete settings.assignments[key];
        castDrafts.delete(key);
        openCast.delete(key);
        await saveSettings();
        renderAssignments();
      } });
    }
    function addMember(key, name) {
      if (!keys.has(key) && keys.size >= 500) {
        notice("The cast can contain up to 500 voice assignments.", true);
        return;
      }
      if (!castDrafts.has(key))
        castDrafts.set(key, { ...settings.assignments[key] ?? { voice: "", emotion: "neutral", delivery: "normal" }, ...name ? { name } : {} });
      openCast.add(key);
      castInitialized = true;
      renderAssignments();
    }
    const add = el("details");
    add.append(el("summary", "Add cast member"));
    let characterId = characters.find((c) => c.id === ctx.getActiveChat().characterId)?.id ?? characters[0]?.id ?? "";
    if (characters.length)
      add.append(field("Character from your library", select(characters.map((c) => ({ value: c.id, label: c.name })), characterId, (v) => characterId = v)), button("Add character voice", () => {
        if (characterId)
          addMember(`id:${characterId}`);
      }));
    add.append(button("Refresh characters", () => safe(async () => {
      const r = await rpc("characters");
      characters = r.characters;
      renderAssignments();
    })));
    let speaker = "";
    const speakerInput = textInput("", (v) => speaker = v);
    speakerInput.placeholder = "For example, Jason";
    speakerInput.maxLength = 80;
    add.append(field("Speaker name in the story", speakerInput), button("Add speaker voice", () => {
      const name = speaker.trim();
      if (!name || /[\[\]\r\n]/.test(name) || name.toLowerCase() === "narrator") {
        notice("Enter a speaker name of up to 80 characters. Narrator has its own voice setting.", true);
        return;
      }
      addMember(`name:${name.toLowerCase()}`, name);
    }), el("p", "Speakers do not need a character card. For several people in one reply, use cues such as [speaker:Jason] inside their quotes. The existing chat model can add these when voice cues are enabled; no extra LLM is called.", "ra-muted"));
    assignmentsCard.append(add);
    renderPronunciations();
  }
  function decorateMessages() {
    for (const { messageId, element } of ctx.dom.listMessageElements()) {
      if (bubbleHandles.has(messageId))
        continue;
      const handle = ctx.dom.inject(element, '<div class="ra-bubble" data-ra-ui="true"></div>', "beforeend");
      const target = handle.firstElementChild;
      const read = button("Read aloud", () => safe(() => readId(messageId)));
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
    openPronunciations.clear();
    renderPronunciations();
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
        assignmentForm(`id:${state.characterId}`, characters.find((c) => c.id === state.characterId)?.name ?? "this character", editorTab.root);
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
  renderConfig();
  renderVoices();
  renderAssignments();
  renderPronunciations();
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
    renderConfig();
    renderVoices();
    renderAssignments();
    renderPronunciations();
    installEditor();
    if (r.cueStatus)
      notice(r.cueStatus, true);
    else
      notice("Ready. Choose a voice and listen to a sample.");
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
      notice("Readalong is off. No speech requests will be started.");
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
