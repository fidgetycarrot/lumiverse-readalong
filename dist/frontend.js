// src/shared.ts
var EMOTIONS = ["neutral", "happy", "sad", "angry", "worried", "curious", "excited", "sarcastic", "tender", "afraid"];
var DELIVERIES = ["normal", "whispers", "shouts", "softly", "slowly", "laughs", "sighs"];
var GEMINI_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"];
var CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]`;
var DEFAULTS = {
  provider: "openrouter",
  connectionId: "",
  model: "google/gemini-3.8-flash-tts",
  voice: "Kore",
  narratorVoice: "",
  localUrl: "http://localhost:8880/v1",
  autoPlay: false,
  follow: false,
  promptEmotions: true,
  useEmotions: true,
  inheritVoices: true,
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
  const str = (v, fallback, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : fallback;
  const assignments = {};
  if (r.assignments && typeof r.assignments === "object")
    for (const [key, v] of Object.entries(r.assignments).slice(0, 500)) {
      if (!v || typeof v !== "object" || ["__proto__", "constructor", "prototype"].includes(key))
        continue;
      assignments[key.slice(0, 200)] = { voice: str(v.voice, "", 160), emotion: enumValue(v.emotion, EMOTIONS, "neutral"), delivery: enumValue(v.delivery, DELIVERIES, "normal") };
    }
  return {
    connectionId: str(r.connectionId, "", 160),
    provider: ["lumiverse", "openrouter", "browser", "local"].includes(r.provider ?? "") ? r.provider : DEFAULTS.provider,
    model: str(r.model, DEFAULTS.model),
    voice: str(r.voice, DEFAULTS.voice),
    narratorVoice: str(r.narratorVoice, ""),
    localUrl: str(r.localUrl, DEFAULTS.localUrl, 500),
    autoPlay: r.autoPlay === true,
    follow: r.follow === true,
    promptEmotions: r.promptEmotions !== false,
    useEmotions: r.useEmotions !== false,
    inheritVoices: r.inheritVoices !== false,
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
function plainText(text) {
  return text.replace(/```[^]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, " ").replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-+]\s+|\d+\.\s+)/gm, "").replace(/[*_`~]/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function splitSentences(text) {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text), (s) => s.segment.trim()).filter(Boolean).flatMap((s) => s.length <= 650 ? [s] : s.match(/.{1,600}(?:\s|$)|.{1,600}/gu).map((x) => x.trim()).filter(Boolean));
}
function parseSegments(raw, defaultSpeaker = "", rules = DEFAULT_SPEECH_RULES) {
  raw = raw.replace(/```[^]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"');
  const cue = new RegExp(`\\[(emotion|delivery|speaker):([^\\]\\r\\n]{1,80})\\]`, "gi");
  const pieces = [];
  let speaker = defaultSpeaker, explicitSpeaker = false, emotion = "", delivery = "";
  const classify = (text, action) => {
    let offset = 0, prefix = "", appended = false;
    const append = (prose) => {
      if (!explicitSpeaker && action === "skip")
        return;
      const text = plainText(prose);
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
    classify(raw.slice(match.index, match.index + match[0].length), match[1] === undefined ? rules.quoted : rules.asterisked);
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
function speechInput(segment, assignment, supportsTags) {
  if (!supportsTags)
    return segment.text;
  const emotionTag = { happy: "happy", sad: "sad", angry: "angry", worried: "worried", curious: "curious", excited: "excited", sarcastic: "sarcastic", tender: "warmly", afraid: "scared" };
  const cues = [];
  if (emotionTag[assignment.emotion])
    cues.push(`[${emotionTag[assignment.emotion]}]`);
  if (assignment.delivery !== "normal")
    cues.push(`[${assignment.delivery}]`);
  return [...cues, segment.text].join(" ");
}
function needsPcm(settings) {
  return settings.provider === "openrouter" && /^google\/gemini-.*tts/i.test(settings.model);
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

// src/audio.ts
var MAX_AUDIO_BYTES = 25 * 1024 * 1024;
function pcmToWav(pcm, contentType = "audio/pcm") {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (pcm.length >= 44 && new TextDecoder().decode(pcm.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(pcm.subarray(8, 12)) === "WAVE")
    return pcm;
  if (!["audio/pcm", "audio/x-pcm"].includes(mime))
    throw new Error("OpenRouter returned an unsupported audio format. Expected Gemini PCM audio.");
  const parameter = (name, fallback) => {
    const match = contentType.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*"?([^;"\\s]+)`, "i"));
    return match ? Number(match[1]) : fallback;
  };
  const rate = parameter("rate", 24000), channels = parameter("channels", 1);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || channels !== 1)
    throw new Error("OpenRouter returned unsupported PCM sample settings.");
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_AUDIO_BYTES)
    throw new Error("OpenRouter returned empty, incomplete, or oversized PCM audio.");
  const wav = new Uint8Array(pcm.length + 44), view = new DataView(wav.buffer);
  const text = (offset, value) => {
    for (let i = 0;i < value.length; i++)
      wav[offset + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, pcm.length + 36, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

// src/provider-errors.ts
function redactSecrets(message, secret) {
  if (secret)
    message = message.split(secret).join("[redacted]");
  return message.replace(/Bearer\s+[^\s"']+|sk-or-v1-[^\s"']+/gi, "[redacted]");
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
    text: speechInput(segment, assignment, legacyTags),
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
      throw new Error(providerError("Lumiverse TTS", response.status, text));
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Lumiverse returned an unexpected TTS response.");
    }
    if (typeof data.error === "string")
      throw new Error(redactSecrets(data.error.slice(0, 600)));
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
        throw new Error(typeof result.message === "string" ? redactSecrets(result.message.slice(0, 600)) : "Lumiverse could not connect to this TTS provider.");
      return "Lumiverse accepts this saved TTS connection. Click Listen to test a voice. No speech was generated.";
    },
    async speech(connection, settings, segment, characterId, signal) {
      const body = nativeSpeechRequest(connection, settings, segment, characterId);
      const response = await request("/tts/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      const mime = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || mime.includes("json")) {
        const text = new TextDecoder().decode(await boundedBytes(response, 64 * 1024));
        throw new Error(providerError("Lumiverse TTS", response.status, text));
      }
      const bytes = await boundedBytes(response, 25 * 1024 * 1024);
      if (!bytes.length)
        throw new Error("Lumiverse returned no speech audio.");
      if (mime.startsWith("audio/pcm") || mime.startsWith("audio/x-pcm"))
        return { bytes: pcmToWav(bytes, mime), mime: "audio/wav" };
      if (!mime.startsWith("audio/") && !mime.startsWith("application/ogg"))
        throw new Error("Lumiverse returned an unsupported speech response.");
      return { bytes, mime };
    }
  };
}

// src/playback-plan.ts
var MAX_PASSAGE_CHARS = 3000;
function planSpeech(segments, settings, context) {
  const passages = [];
  let previousKey = "";
  for (const segment of segments) {
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
    const styleSupported = /gemini-3\.1.*tts|gpt-4o-mini-tts/i.test(snapshot.model) && snapshot.provider !== "browser";
    const emotion = styleSupported ? assignment.emotion : "neutral", delivery = styleSupported ? assignment.delivery : "normal";
    const key = JSON.stringify([snapshot.provider, snapshot.connectionId, snapshot.model, snapshot.voice, emotion, delivery]);
    const last = passages.at(-1);
    if (last && previousKey === key && last.segment.text.length + segment.text.length + 1 <= MAX_PASSAGE_CHARS) {
      last.segment.text += " " + segment.text;
      last.segments.push(segment);
    } else
      passages.push({ segment: { ...segment, emotion, delivery }, segments: [segment], settings: snapshot, voice: snapshot.voice });
    previousKey = key;
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
  const weights = passage.segments.map((s) => Math.max(1, s.text.replace(/[^\p{L}\p{N}]/gu, "").length) + 12 * splitSentences(s.text).length);
  const target = Math.max(0, Math.min(0.999999, fraction)) * weights.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0;i < weights.length; i++) {
    sum += weights[i];
    if (target < sum)
      return i;
  }
  return weights.length - 1;
}

// src/playback.ts
class BufferedPlayer {
  factory;
  context = null;
  gain = null;
  buffers = [];
  starts = [];
  sources = [];
  offset = 0;
  anchor = 0;
  speed = 1;
  volume = 0.85;
  running = false;
  generation = 0;
  primed = false;
  onEnded = () => {};
  constructor(factory = () => {
    const Constructor = window.AudioContext ?? window.webkitAudioContext;
    if (!Constructor)
      throw new Error("This browser does not support continuous audio playback. Try Browser voices.");
    return new Constructor;
  }) {
    this.factory = factory;
  }
  ensure() {
    if (!this.context) {
      this.context = this.factory();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }
  unlock() {
    const c = this.ensure();
    c.resume().catch(() => {});
    if (this.primed)
      return;
    const source = c.createBufferSource();
    source.buffer = c.createBuffer(1, 1, c.sampleRate);
    source.connect(this.gain);
    source.start();
    this.primed = true;
  }
  async decode(data) {
    const bytes = data.bytes ?? Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    try {
      const buffer = await this.ensure().decodeAudioData(bytes.slice().buffer);
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0)
        throw new Error;
      return buffer;
    } catch {
      throw new Error("The speech provider returned audio this browser cannot play.");
    }
  }
  load(buffers) {
    this.clear();
    let offset = 0;
    this.buffers = buffers;
    this.starts = buffers.map((b) => {
      const start = offset;
      offset += b.duration;
      return start;
    });
  }
  get duration() {
    return this.buffers.reduce((sum, b) => sum + b.duration, 0);
  }
  get elapsed() {
    return Math.min(this.duration, this.offset + (this.running ? Math.max(0, this.ensure().currentTime - this.anchor) * this.speed : 0));
  }
  get position() {
    const elapsed = this.elapsed;
    let index = 0;
    while (index + 1 < this.starts.length && this.starts[index + 1] <= elapsed + 0.0000001)
      index++;
    const seconds = Math.max(0, elapsed - (this.starts[index] ?? 0)), duration = this.buffers[index]?.duration ?? 0;
    return { index, seconds, fraction: duration ? Math.min(1, seconds / duration) : 0, elapsed, duration: this.duration };
  }
  unschedule() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources = [];
  }
  schedule() {
    const c = this.ensure(), generation = ++this.generation;
    this.anchor = c.currentTime + 0.025;
    this.running = true;
    for (let i = 0;i < this.buffers.length; i++) {
      const buffer = this.buffers[i], start = this.starts[i], end = start + buffer.duration;
      if (end <= this.offset)
        continue;
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = this.speed;
      source.connect(this.gain);
      if (i === this.buffers.length - 1)
        source.onended = () => {
          if (generation !== this.generation)
            return;
          this.offset = this.duration;
          this.running = false;
          this.unschedule();
          this.onEnded();
        };
      this.sources.push(source);
      source.start(this.anchor + Math.max(0, start - this.offset) / this.speed, Math.max(0, this.offset - start));
    }
  }
  async play() {
    if (!this.buffers.length)
      throw new Error("Prepare a message first.");
    const generation = this.generation, c = this.ensure();
    await c.resume();
    if (generation !== this.generation)
      return false;
    if (c.state !== "running")
      throw new Error("Press Play to allow audio.");
    if (this.running)
      return true;
    if (this.offset >= this.duration)
      this.offset = 0;
    this.schedule();
    return true;
  }
  pause() {
    this.offset = this.elapsed;
    this.running = false;
    this.generation++;
    this.unschedule();
  }
  setSpeed(speed) {
    const running = this.running;
    this.pause();
    this.speed = Math.max(0.5, Math.min(2, speed));
    if (running)
      this.schedule();
  }
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain)
      this.gain.gain.value = this.volume;
  }
  rewind() {
    this.pause();
    this.offset = 0;
  }
  clear() {
    this.pause();
    this.offset = 0;
    this.buffers = [];
    this.starts = [];
  }
  dispose() {
    this.clear();
    this.context?.close().catch(() => {});
    this.context = null;
    this.gain = null;
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
.ra-bubble{display:flex;gap:8px;align-items:center;padding:5px 0;font-size:12px}.ra-bubble button{padding:5px 9px;font-size:12px;}.ra details>summary{cursor:pointer;font-size:13px;margin:8px 0;}
.ra-mini{font:13px/1.4 system-ui,sans-serif;color:var(--lumiverse-text,#eee);padding:12px;background:var(--lumiverse-bg,#202026);height:100%;box-sizing:border-box;}
.ra-mini .ra-row{display:flex;gap:7px;align-items:center}.ra-mini .ra-caption{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:7px 0;color:var(--lumiverse-text-muted,#aaa);}
.ra-mini button{font:inherit;border:1px solid var(--lumiverse-border,#555);border-radius:7px;background:var(--lumiverse-fill,#292932);color:inherit;padding:6px 10px;cursor:pointer;}
.ra-mini button:disabled{opacity:.5;cursor:default}.ra-mini .ra-primary{background:var(--lumiverse-primary,#ac8b4f);color:var(--lumiverse-on-primary,#fff);}
.ra-mini .ra-close{margin-left:auto;padding:2px 7px;}.ra-mini progress{width:100%;height:4px;accent-color:#e7b24c;}
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
  b.onclick = () => {
    action();
  };
  return b;
}
function field(label, input) {
  const l = el("label", "", "ra-field");
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
  s.onchange = () => change(s.value);
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
  i.onchange = () => change(i.checked);
  row.append(i, el("span", label));
  return row;
}
function timeLabel(seconds) {
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function setup(ctx) {
  let settings = normalizeSettings(DEFAULTS), hasKey = false, ready = false, disposed = false;
  let canDiagnoseSpeech = false, diagnosing = false, diagnoseButton = null;
  let diagnoseHint = null;
  let models = [{ id: DEFAULTS.model, name: "Google: Gemini 3.8 Flash TTS", voices: GEMINI_VOICES }];
  const nativeTts = createNativeTtsClient(), nativeRequests = new Set;
  let nativeConnections = [], catalogEpoch = 0;
  let characters = [], permissions = [];
  let messages = [], selectedId = "";
  let playbackId = 0, playing = false, paused = false, currentMessage = null;
  let phase = "idle";
  let utterance = null;
  const audioPlayer = new BufferedPlayer;
  let currentPassages = [], preparedCount = 0, currentPassage = 0;
  let readingAbort = null, clockTimer = null;
  let browserQueueActive = false, browserResume = null;
  let widget = null;
  let currentSegments = [], position = 0, markedPosition = -1;
  let playbackSettler = null;
  const pending = new Map;
  const cleanups = [], bubbleHandles = new Map;
  const primeAudio = () => {
    try {
      audioPlayer.unlock();
      removePrimer();
    } catch {}
  };
  const removePrimer = () => {
    document.removeEventListener("pointerdown", primeAudio, true);
    document.removeEventListener("keydown", primeAudio, true);
  };
  document.addEventListener("pointerdown", primeAudio, { capture: true, passive: true });
  document.addEventListener("keydown", primeAudio, true);
  cleanups.push(removePrimer);
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
  const player = el("section", "", "ra-card"), config = el("section", "", "ra-card"), voicesCard = el("section", "", "ra-card"), assignmentsCard = el("section", "", "ra-card");
  root.append(heading, intro, status, player, config, voicesCard, assignmentsCard);
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
      ctx.sendToBackend({ type, requestId, ...payload });
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
    } else if (payload?.type === "new_message" && ready && settings.autoPlay && payload.chatId === ctx.getActiveChat().chatId && (phase === "idle" || phase === "finished")) {
      safe(async () => {
        await startMessage(payload.message, true);
      });
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
    stopClock();
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
    if (!widget && typeof ctx.ui.createFloatWidget === "function") {
      const width = Math.min(320, Math.max(240, window.innerWidth - 24));
      widget = ctx.ui.createFloatWidget({ width, height: 146, initialPosition: { x: Math.max(12, window.innerWidth - width - 24), y: Math.max(12, window.innerHeight - 220) }, snapToEdge: true, tooltip: "Readalong · drag to move" });
      widget.root.classList.add("ra-mini");
      widget.root.dataset.raUi = "true";
      widget.root.setAttribute("aria-label", "Readalong floating player");
    }
    widget?.setVisible(true);
    renderWidget();
  }
  function renderWidget() {
    if (!widget || disposed)
      return;
    const header = el("div", "", "ra-row");
    header.append(el("strong", "Readalong"));
    if (audioPlayer.duration) {
      const time = el("span", `${timeLabel(audioPlayer.elapsed)} / ${timeLabel(audioPlayer.duration)}`, "ra-time");
      header.append(time);
    }
    const close = button("×", () => widget?.setVisible(false));
    close.className = "ra-close";
    close.setAttribute("aria-label", "Hide floating player");
    header.append(close);
    const caption = el("p", phase === "playing" || phase === "paused" ? `${currentSegments[position]?.speaker || "Voice"} · ${currentPassages[currentPassage]?.voice || ""}` : status.textContent ?? "Choose a message.", "ra-caption");
    caption.title = currentSegments[position]?.text ?? caption.textContent ?? "";
    const controls = el("div", "", "ra-row");
    const play = button(phase === "paused" ? "Resume" : phase === "playing" ? "Pause" : phase === "finished" ? "Replay" : "Play", () => safe(playOrPause), true);
    play.disabled = phase === "preparing" || phase === "idle";
    controls.append(play);
    const stopButton = button("Stop", () => stop());
    stopButton.disabled = phase === "idle";
    controls.append(stopButton, button("Open player", () => tab.activate()));
    const progress = el("progress");
    progress.max = 1;
    progress.value = phase === "preparing" ? preparedCount / Math.max(1, currentPassages.length) : phase === "finished" ? 1 : phase === "ready" ? 0 : audioPlayer.duration ? audioPlayer.elapsed / audioPlayer.duration : position / Math.max(1, currentSegments.length);
    progress.setAttribute("aria-label", phase === "preparing" ? "Speech preparation" : "Playback progress");
    widget.root.replaceChildren(header, caption, controls, progress);
  }
  function markSentence(passageIndex, sentenceIndex) {
    const next = currentPassages.slice(0, passageIndex).reduce((sum, p) => sum + p.segments.length, 0) + sentenceIndex;
    if (next === markedPosition && currentPassage === passageIndex)
      return;
    currentPassage = passageIndex;
    position = next;
    markedPosition = next;
    if (currentMessage) {
      marker.mark(() => contentRoot(currentMessage.id), currentSegments[position].text);
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
    if (progress)
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
  async function playOrPause() {
    if (phase === "preparing" || phase === "idle")
      return;
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
    audioPlayer.unlock();
    const started = await audioPlayer.play();
    if (token !== playbackId || !started)
      return;
    playing = true;
    phase = "playing";
    notice("Reading…");
    updateClock();
    renderPlayer();
    stopClock();
    clockTimer = setInterval(updateClock, 100);
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
      return await nativeTts.speech(connection, snapshot, segment, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(70000), ...signal ? [signal] : []]));
    } finally {
      nativeRequests.delete(controller);
    }
  }
  async function startMessage(message, autoStart = false) {
    stop(false);
    const token = playbackId;
    readingAbort = new AbortController;
    const signal = readingAbort.signal;
    currentMessage = { ...message, characterId: message.characterId ?? speakerCharacterId(message.name, characters, ctx.getActiveChat().characterId ?? undefined) };
    phase = "preparing";
    preparedCount = 0;
    showWidget();
    notice("Preparing the whole message…");
    renderPlayer();
    try {
      const snapshot = normalizeSettings(settings);
      const context = { characters, characterId: currentMessage.characterId, connections: nativeConnections };
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
      let decodedBytes = 0;
      if (snapshot.provider !== "browser") {
        const buffers = await prepareAll(currentPassages, async (p, _index, requestSignal) => {
          const data = await prepareSpeech(p.segment, p.settings, requestSignal);
          requestSignal.throwIfAborted();
          const buffer = await audioPlayer.decode(data);
          requestSignal.throwIfAborted();
          decodedBytes += buffer.length * buffer.numberOfChannels * 4;
          if (decodedBytes > 256 * 1024 * 1024)
            throw new Error("This message is too long to hold in memory. Read a shorter message.");
          return buffer;
        }, signal, (count) => {
          if (token === playbackId) {
            preparedCount = count;
            notice(`Preparing the whole message · ${count} of ${currentPassages.length} passages ready…`);
            renderPlayer();
          }
        }, snapshot.provider === "lumiverse" ? 3 : 2);
        if (token !== playbackId)
          return;
        audioPlayer.load(buffers);
        audioPlayer.setSpeed(settings.speed);
        audioPlayer.setVolume(settings.volume);
      }
      if (token !== playbackId)
        return;
      phase = "ready";
      notice("The whole message is ready. Press Play.");
      renderPlayer();
      if (autoStart)
        await playOrPause();
    } catch (e) {
      if (token === playbackId) {
        stop(false);
        throw e;
      }
    }
  }
  async function preview(voice, assignment) {
    stop(false);
    const token = playbackId;
    readingAbort = new AbortController;
    if (settings.provider !== "browser")
      audioPlayer.unlock();
    const segment = { text: "The door was open. I took a breath, and stepped into the light.", speaker: "Preview", emotion: assignment?.emotion ?? "neutral", delivery: assignment?.delivery ?? "normal" };
    const snapshot = normalizeSettings({ ...settings, voice, narratorVoice: "", assignments: {}, inheritVoices: false });
    currentPassages = planSpeech([segment], snapshot, { characters: [] });
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
        const buffer = await audioPlayer.decode(data);
        if (token !== playbackId)
          return;
        audioPlayer.load([buffer]);
        audioPlayer.setSpeed(settings.speed);
        audioPlayer.setVolume(settings.volume);
      }
      if (token !== playbackId)
        return;
      phase = "ready";
      await playOrPause();
    } catch (e) {
      if (token === playbackId) {
        stop(false);
        throw e;
      }
    }
  }
  async function saveSettings() {
    const r = await rpc("save", { settings });
    settings = normalizeSettings(r.settings);
    notice("Settings saved.");
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
  async function readId(id) {
    const chatId = ctx.getActiveChat().chatId;
    if (!chatId)
      throw new Error("Open a chat first.");
    const r = await rpc("message", { chatId, messageId: id });
    if (ctx.getActiveChat().chatId !== chatId)
      return;
    await startMessage(r.message);
  }
  function renderPlayer() {
    player.replaceChildren(el("h3", phase === "preparing" ? "Preparing the whole message" : phase === "ready" ? "Ready to play" : phase === "playing" || phase === "paused" ? "Now reading" : "Listen to a passage"));
    const row = el("div", "", "ra-row");
    if (phase !== "idle") {
      const play = button(phase === "paused" ? "Resume" : phase === "playing" ? "Pause" : phase === "finished" ? "Replay" : "Play", () => safe(playOrPause), true);
      play.disabled = phase === "preparing";
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
      read.disabled = !ready;
      row.append(read, button("Refresh messages", () => safe(refreshMessages)));
    }
    if (typeof ctx.ui.createFloatWidget === "function")
      row.append(button("Floating player", showWidget));
    if (currentMessage)
      row.append(button("Return to passage", () => marker.follow()));
    player.append(row);
    if (phase === "idle" && messages.length)
      player.append(field("Assistant message", select([...messages].reverse().map((m) => ({ value: m.id, label: `${m.name || "Assistant"} · ${plainText(stripCues(m.content)).slice(0, 70)}` })), selectedId, (v) => {
        selectedId = v;
      })));
    if (currentSegments.length) {
      const segment = currentSegments[position], progress = el("progress");
      progress.max = phase === "preparing" ? currentPassages.length : currentSegments.length;
      progress.value = phase === "preparing" ? preparedCount : phase === "ready" ? 0 : position + 1;
      player.append(el("p", `${segment?.speaker || "Voice"} · ${currentPassages[currentPassage]?.voice || ""} · Sentence ${position + 1} of ${currentSegments.length}`, "ra-muted"), progress, el("p", segment?.text ?? "", "ra-passage"));
      if (currentMessage)
        player.append(el("p", "The sentence marker estimates your place within continuous audio. Pausing keeps it in place.", "ra-muted"));
    } else
      player.append(el("p", "Prepare the whole message, then press Play. Narration and dialogue use their assigned voices.", "ra-muted"));
    player.append(toggle("Follow the spoken passage as it moves down the page", settings.follow, (v) => {
      settings.follow = v;
      safe(saveSettings);
    }));
    const slider = el("input");
    slider.type = "range";
    slider.min = ".5";
    slider.max = "2";
    slider.step = ".1";
    slider.value = String(settings.speed);
    slider.oninput = () => {
      settings.speed = Number(slider.value);
      speedLabel.textContent = `Playback speed · ${settings.speed.toFixed(1)}×`;
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
    volume.oninput = () => {
      settings.volume = Number(volume.value);
      audioPlayer.setVolume(settings.volume);
    };
    volume.onchange = () => {
      safe(saveSettings);
    };
    const controls = el("div", "", "ra-grid");
    controls.append(speedField, field("Volume", volume));
    player.append(controls);
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
        config.append(el("p", "Gemini 3.8 reads clean dialogue through this connection. Lumiverse’s current TTS endpoint does not pass its per-sentence emotion directions.", "ra-muted"));
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
      const key = textInput("", () => {}, "password");
      key.autocomplete = "off";
      key.placeholder = settings.provider === "openrouter" && hasKey ? "Key saved · leave blank to keep it" : "Paste your API key";
      config.append(field("API key", key), button("Save key", () => safe(async () => {
        if (!key.value.trim())
          throw new Error("Paste a key first.");
        const r = await rpc("save_key", { key: key.value, provider: settings.provider });
        hasKey = r.hasKey;
        key.value = "";
        key.placeholder = "Key saved";
        notice("API key saved securely.");
      })), button("Remove saved key", () => safe(async () => {
        await rpc("save_key", { key: "", provider: settings.provider });
        hasKey = false;
        key.placeholder = "Paste your API key";
        notice("Saved key removed.");
      })));
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
    config.append(toggle("Automatically read new replies after they finish", settings.autoPlay, (v) => settings.autoPlay = v), toggle("Ask the existing chat model for occasional emotion and speaker cues", settings.promptEmotions, (v) => settings.promptEmotions = v), toggle("Use emotion cues when the speech model supports them", settings.useEmotions, (v) => settings.useEmotions = v), button("Save settings", () => safe(saveSettings), true));
    config.append(el("p", "Emotion cues add a few tokens to normal chat replies. No second LLM is called. Hidden tags remain in the original message.", "ra-muted"));
  }
  function renderVoices() {
    voicesCard.replaceChildren(el("h3", "Choose a voice"));
    const row = el("div", "", "ra-row");
    row.append(field("Default voice", voiceSelect(settings.voice, (v) => {
      settings.voice = v;
      renderVoices();
      safe(saveSettings);
    })), button("Listen", () => safe(() => preview(settings.voice))));
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
    voicesCard.append(el("p", "Quoted dialogue uses the speaking character; surrounding prose uses the narrator. Speaker cues override this detection. Choose different voices to hear the switch.", "ra-muted"));
  }
  function assignmentForm(key, name, container) {
    const assignment = { ...settings.assignments[key] ?? { voice: "", emotion: "neutral", delivery: "normal" } };
    container.replaceChildren(el("h3", `Voice for ${name}`));
    const update = async () => {
      settings.assignments[key] = assignment;
      await saveSettings();
    };
    container.append(field("Voice", voiceSelect(assignment.voice, (v) => assignment.voice = v, true)));
    if (settings.provider === "local")
      container.append(field("Custom voice ID", textInput(assignment.voice, (v) => assignment.voice = v)));
    const row = el("div", "", "ra-grid");
    row.append(field("Default emotion", select(EMOTIONS.map((v) => ({ value: v, label: v })), assignment.emotion, (v) => assignment.emotion = v)), field("Default delivery", select(DELIVERIES.map((v) => ({ value: v, label: v })), assignment.delivery, (v) => assignment.delivery = v)));
    container.append(row);
    const actions = el("div", "", "ra-row");
    actions.append(button("Listen", () => safe(() => preview(assignment.voice || settings.voice, assignment))), button("Save voice", () => safe(update), true), button("Use defaults", () => safe(async () => {
      delete settings.assignments[key];
      await saveSettings();
      assignmentForm(key, name, container);
    })));
    container.append(actions);
  }
  function renderAssignments() {
    assignmentsCard.replaceChildren(el("h3", "Character voices"), el("p", "Readalong assignments use this speech connection and override inherited Lumiverse voices. Choose a voice again after changing provider or model.", "ra-muted"));
    const sub = el("div");
    let character = characters[0];
    if (characters.length)
      assignmentsCard.append(field("Character", select(characters.map((c) => ({ value: c.id, label: c.name })), character?.id ?? "", (v) => {
        character = characters.find((c) => c.id === v);
        if (character)
          assignmentForm(`id:${character.id}`, character.name, sub);
      })));
    assignmentsCard.append(button("Refresh characters", () => safe(async () => {
      const r = await rpc("characters");
      characters = r.characters;
      renderAssignments();
    })), sub);
    if (character)
      assignmentForm(`id:${character.id}`, character.name, sub);
    const details = el("details");
    details.append(el("summary", "Add a voice for a speaker mentioned in a passage"));
    let speaker = "";
    const speakerInput = textInput("", (v) => speaker = v);
    speakerInput.placeholder = "Exact speaker name";
    const named = el("div");
    details.append(field("Speaker name", speakerInput), button("Choose voice", () => {
      if (speaker.trim())
        assignmentForm(`name:${speaker.trim().toLowerCase()}`, speaker.trim(), named);
    }), named);
    assignmentsCard.append(details);
  }
  function decorateMessages() {
    for (const { messageId, element } of ctx.dom.listMessageElements()) {
      if (bubbleHandles.has(messageId))
        continue;
      const handle = ctx.dom.inject(element, '<div class="ra-bubble" data-ra-ui="true"></div>', "beforeend");
      const target = handle.firstElementChild;
      target.append(button("Read aloud", () => safe(() => readId(messageId))));
      bubbleHandles.set(messageId, handle);
    }
  }
  function onEvent(name, fn) {
    cleanups.push(ctx.events.on(name, (p) => fn(p)));
  }
  onEvent("CHAT_SWITCHED", () => {
    stop(false);
    messages = [];
    selectedId = "";
    for (const handle of bubbleHandles.values())
      ctx.dom.uninject(handle);
    bubbleHandles.clear();
    notice("Choose a message in this chat.");
    safe(refreshMessages);
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
    if (p?.chatId === ctx.getActiveChat().chatId && currentMessage)
      stop(false);
  });
  onEvent("GENERATION_STOPPED", (p) => {
    if (p?.chatId === ctx.getActiveChat().chatId && currentMessage)
      stop();
  });
  onEvent("CHARACTER_MESSAGE_RENDERED", () => decorateMessages());
  cleanups.push(tab.onActivate(() => {
    safe(refreshMessages);
  }));
  const action = ctx.ui.registerInputBarAction({ id: "readalong", label: "Readalong", subtitle: "Listen and find your place" });
  cleanups.push(action.onClick(() => {
    showWidget();
    tab.activate();
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
  ctx.ready();
  safe(async () => {
    const r = await rpc("init");
    if (disposed)
      return;
    settings = normalizeSettings(r.settings);
    hasKey = r.hasKey;
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
    if (settings.provider === "lumiverse" || permissions.includes("cors_proxy")) {
      try {
        await refreshCatalog();
      } catch {
        notice("Could not refresh the voice list. Check the saved connection and try Refresh again.", true);
      }
    }
    if (permissions.includes("chat_mutation"))
      await refreshMessages();
  });
  return () => {
    stop(false);
    disposed = true;
    marker.dispose();
    audioPlayer.dispose();
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
