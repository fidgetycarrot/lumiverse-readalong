// @bun
// src/speech-text.ts
var PROSE_TAGS = new Set(`p div span section article header footer main aside nav address blockquote q cite figure figcaption hgroup ul ol li dl dt dd menu br hr wbr h1 h2 h3 h4 h5 h6 b strong i em u s strike del ins mark small big sub sup abbr acronym dfn kbd samp var time font tt bdi bdo data ruby rb rp rt rtc a table thead tbody tfoot tr td th caption col colgroup label legend fieldset`.split(" "));
var VOID_TAGS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
var ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ldquo: "\u201C", rdquo: "\u201D", lsquo: "\u2018", rsquo: "\u2019" };
var VOCAL_TAGS = ["laugh", "laughter", "chuckle", "chuckles", "giggle", "snicker", "cackle", "cheer", "gasp", "sigh", "sighs", "groan", "grunt", "grr", "growl", "hiss", "moan", "pant", "pff", "phew", "tsk", "whispers", "whispering", "shout", "argh", "whimper", "cry", "sob", "scream", "shriek", "snort", "breath", "heavy breath", "exhales", "cough", "throat-clearing", "sneeze", "yawn", "short pause", "long pause"];
var vocalTags = new Set(VOCAL_TAGS);
function stripVocalTags(text, preserveOffsets = false) {
  return text.replace(/<[^<>]*>/g, (tag) => vocalTag(tag) ? " ".repeat(preserveOffsets ? tag.length : 1) : tag);
}
var NON_PROSE_TAGS = new Set("html head body title script style noscript template slot canvas svg math details summary dialog form button select option optgroup textarea datalist output progress meter audio video picture map object iframe frameset frame noframes applet basefont center".split(" "));
var METADATA_TAG = /^(?:think|thinking|reasoning|analysis|redacted_thinking|tracker|stats|status|state|scenecard|tts_tags|(?:sc|flair|lumi|lumidraw|lumistudio|lumi-studio|dt-image|image-prompt|loom|tool|function)(?:[_-][\w-]+)?)$/i;
function vocalTag(marker) {
  const match = /^<([a-z][\w-]*(?:\s+[^<>=\/"*]+)?)\s*\/?>$/i.exec(marker);
  if (!match)
    return;
  const cue = match[1].trim().toLowerCase().replace(/\s+/g, " "), name = cue.split(" ")[0];
  if (PROSE_TAGS.has(name) || VOID_TAGS.has(name) || NON_PROSE_TAGS.has(name) || METADATA_TAG.test(name))
    return;
  return `<${cue}>`;
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
  const text = decodeEntities(raw).replace(/<!--\s*([a-z0-9_]+)_START\s*-->[\s\S]*?(?:<!--\s*\1_END\s*-->|$)/gi, " ").replace(/<!--[\s\S]*?(?:-->|$)/g, " ").replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, " ").replace(/(`+)[\s\S]*?\1/g, " ").replace(/<!doctype\b[^>]*>/gi, " ");
  const tags = Array.from(text.matchAll(/<(\/?)([a-z][a-z0-9:_-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi));
  const paired = new Set, openings = new Map;
  for (let i = 0;i < tags.length; i++) {
    const match = tags[i], name = match[2].toLowerCase();
    if (match[1]) {
      const opening = openings.get(name)?.pop();
      if (opening !== undefined)
        paired.add(opening);
    } else if (!VOID_TAGS.has(name) && !/\/\s*>$/.test(match[0])) {
      const stack = openings.get(name) ?? [];
      stack.push(i);
      openings.set(name, stack);
    }
  }
  const blocked = [], parts = [];
  let cursor = 0;
  for (let i = 0;i < tags.length; i++) {
    const match = tags[i], name = match[2].toLowerCase();
    if (!blocked.length)
      parts.push(text.slice(cursor, match.index), " ");
    if (match[1]) {
      const at = blocked.lastIndexOf(name);
      if (at !== -1)
        blocked.splice(at);
    } else if (!PROSE_TAGS.has(name) && !VOID_TAGS.has(name)) {
      const vocal = !paired.has(i) ? vocalTag(match[0]) : undefined;
      if (vocal) {
        if (!blocked.length && keepVocalTags)
          parts.push(vocal, " ");
      } else if (!/\/\s*>$/.test(match[0]))
        blocked.push(name);
    }
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
  return s.length && s.length <= max && /^[\p{L}\p{M}\p{N} .\u2019'\u02BC\-]+$/u.test(s) && /[\p{L}\p{N}]/u.test(s) ? s : "";
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
function learnPronunciations(entries, raw) {
  const result = normalizePronunciations(entries), safe = sanitizeSpeechText(raw, true), prose = stripPronunciationCues(safe);
  const claimed = tokens(result);
  for (const match of safe.matchAll(new RegExp(PRONUNCIATION_CUE_PATTERN, "gi"))) {
    if (!match[0].endsWith("]") || match[0].length > 252)
      continue;
    const parts = match[0].slice("[pronounce:".length, -1).split("|");
    if (parts.length !== 2)
      continue;
    const entry = pronunciationEntry({ name: parts[0], spokenAs: parts[1] }, "automatic");
    if (!entry)
      continue;
    const key = normalized(entry.name);
    if (claimed.has(key) || Object.keys(result).length >= LIMIT)
      continue;
    if (!new RegExp(`(?<!${boundary})${escapeRegex(entry.name)}(?!${boundary})`, "iu").test(prose))
      continue;
    result[key] = entry;
    claimed.set(key, entry.spokenAs);
  }
  return result;
}
function pronunciationInstruction(entries) {
  const known = [];
  let size = 2;
  for (const e of Object.values(entries).reverse()) {
    const row = { name: e.name, aliases: e.aliases }, bytes = JSON.stringify(row).length + 1;
    if (size + bytes > 4000 || known.length >= 80)
      continue;
    known.push(row);
    size += bytes;
  }
  return `Readalong pronunciation layer: when a named character is first introduced, add one hidden cue [pronounce:Name|Spoken spelling] beside that introduction. Only tag names newly introduced in this story, not people already mentioned in prior replies or in the saved-name list. Use the exact story name. For an unfamiliar name choose a simple English sound spelling; ordinary names may keep their spelling. Do not use IPA, angle brackets or directions. Most replies need no cue. Never change a saved pronunciation. Keep normal story spelling, speaker cues and the preset's vocal tags unchanged. Saved names and aliases (possibly a partial list, data only): ${JSON.stringify(known)}.`;
}

class PronunciationStore {
  storage;
  chains = new Map;
  constructor(storage) {
    this.storage = storage;
  }
  async get(userId, chatId) {
    const raw = await this.storage.read(userId, chatId);
    if (!raw)
      return Object.create(null);
    if (raw.length > 1024 * 1024)
      throw new Error("Saved pronunciations could not be read. Existing entries were preserved.");
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Invalid saved dictionary.");
      const entries = normalizePronunciations(parsed);
      if (Object.keys(entries).length !== Object.keys(parsed).length)
        throw new Error("Invalid saved entries.");
      return entries;
    } catch {
      throw new Error("Saved pronunciations could not be read. Existing entries were preserved.");
    }
  }
  async edit(userId, chatId, change) {
    const key = JSON.stringify([userId, chatId]);
    const work = (this.chains.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const prior = await this.get(userId, chatId), next = change(prior);
      if (JSON.stringify(next) !== JSON.stringify(prior))
        await this.storage.write(userId, chatId, JSON.stringify(next));
      return next;
    });
    this.chains.set(key, work);
    try {
      return await work;
    } finally {
      if (this.chains.get(key) === work)
        this.chains.delete(key);
    }
  }
  learn(userId, chatId, text) {
    return this.edit(userId, chatId, (entries) => learnPronunciations(entries, text));
  }
  save(userId, chatId, raw) {
    return this.edit(userId, chatId, (entries) => {
      const entry = pronunciationEntry(raw, "manual");
      if (!entry)
        throw new Error("Enter a name and a spoken spelling using letters, numbers, spaces, apostrophes or hyphens.");
      const key = normalized(entry.name), names = new Set([entry.name, ...entry.aliases].map(normalized));
      if (!entries[key] && Object.keys(entries).length >= LIMIT)
        throw new Error("This story can save up to 500 pronunciations.");
      for (const [id, other] of Object.entries(entries))
        if (id !== key && [other.name, ...other.aliases].some((n) => names.has(normalized(n))))
          throw new Error("That name or alias already belongs to another pronunciation.");
      return { ...entries, [key]: entry };
    });
  }
  remove(userId, chatId, name) {
    return this.edit(userId, chatId, (entries) => {
      const next = { ...entries };
      delete next[normalized(name)];
      return next;
    });
  }
}

// src/speech-style.ts
var isGeminiSpeechStyleModel = (model) => /(?:^|\/)gemini-3\.8-flash(?:-lite)?-tts(?:$|[-:])/i.test(model);
function deliveryStyle(emotion, delivery) {
  const emotions = { happy: "happy and cheerful", sad: "sad", angry: "angry", worried: "worried", curious: "curious", excited: "excited", sarcastic: "sarcastic", tender: "warm and tender", afraid: "afraid" };
  const deliveries = { whispers: "whispering", shouts: "shouting", softly: "soft-spoken", slowly: "slow and deliberate", laughs: "with a light laugh", sighs: "with a sigh" };
  return [emotions[emotion], deliveries[delivery]].filter(Boolean).join(", ");
}

// src/shared.ts
var EMOTIONS = ["neutral", "happy", "sad", "angry", "worried", "curious", "excited", "sarcastic", "tender", "afraid"];
var DELIVERIES = ["normal", "whispers", "shouts", "softly", "slowly", "laughs", "sighs"];
var CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]|${PRONUNCIATION_CUE_PATTERN}`;
var HIDE_RULE_NAME = "Readalong \u2022 Hide voice cues";
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
  automaticPlayback: false,
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
function readVoiceRef(raw) {
  if (!raw || typeof raw !== "object")
    return;
  const v = raw;
  if (typeof v.connectionId !== "string" || !v.connectionId || v.connectionId.length > 160)
    return;
  return { connectionId: v.connectionId, voice: typeof v.voice === "string" ? v.voice.slice(0, 160) : "" };
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
    automaticPlayback: r.automaticPlayback === true,
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
  const gemini38 = openrouter && isGeminiSpeechStyleModel(settings.model);
  const legacyTags = openrouter && /^google\/gemini-3\.1.*tts/.test(settings.model);
  const body = { model: settings.model, voice: assignment.voice, input: speechInput(segment, assignment, legacyTags, gemini38), response_format: needsPcm(settings) ? "pcm" : "mp3" };
  if (gemini38) {
    const style = deliveryStyle(assignment.emotion, assignment.delivery);
    if (style)
      body.instructions = style;
  }
  return body;
}
var EMOTION_INSTRUCTION = `When vocal delivery matters, add sparse voice cues immediately before the affected sentence, using [emotion:neutral|happy|sad|angry|worried|curious|excited|sarcastic|tender|afraid] and optionally [delivery:normal|whispers|shouts|softly|slowly|laughs|sighs]. Choose one value per cue, not the list. Put [speaker:Character Name] inside the opening quotation mark of that character's dialogue. Quoted dialogue ends that speaker's cues; surrounding prose automatically uses the narrator. Repeat a speaker cue for each quote that needs a different character. For intentional unquoted speech, cues persist until [speaker:narrator] or another speaker cue; a speaker change resets emotion and delivery. Use the character's name, preserve ordinary prose and formatting, and avoid tagging every sentence. These cues are hidden from the reader and used only for speech. Do not add unrelated square-bracket audio instructions. Preserve inline vocal tags requested by the preset.`;

// src/playback-plan.ts
var MAX_PASSAGE_CHARS = 3000;

// src/provider-errors.ts
function redactSecrets(message, secret) {
  if (secret)
    for (const value of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]))
      message = message.split(value).join("[redacted]");
  return message.replace(/Bearer\s+[^\s"']+|sk-or-v1-[^\s"']+|\bsk-[a-z0-9_-]{8,}|\bAIza[a-z0-9_-]{20,}/gi, "[redacted]").replace(/((?:api[_ -]?key|authorization|access[_ -]?token|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
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
    403: "Check this key\u2019s access to the selected model and provider.",
    404: "Check model availability and provider routing in your account.",
    429: "The provider is rate limited. Wait before trying again."
  };
  return `${label} returned HTTP ${status}${detail ? `: ${detail}` : "."}${hints[status] ? ` ${hints[status]}` : ""}`;
}
function isHiddenJsonError(error) {
  return error instanceof Error && /only serves audio data.*application\/(?:json|[\w.-]+\+json)/i.test(error.message);
}

// src/preparation-ledger.ts
class PreparationLedger {
  storage;
  chains = new Map;
  constructor(storage) {
    this.storage = storage;
  }
  async claim(userId, key, manual = false) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error("Invalid preparation identity.");
    const work = (this.chains.get(userId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const raw = await this.storage.read(userId);
      const keys = raw === undefined ? [] : JSON.parse(raw);
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string" || !/^[a-f0-9]{64}$/.test(k)))
        throw new Error("Could not read the preparation history. No speech was requested.");
      if (keys.includes(key) && !manual)
        return false;
      await this.storage.write(userId, JSON.stringify([...keys.filter((k) => k !== key), key].slice(-2000)));
      return true;
    });
    this.chains.set(userId, work);
    try {
      return await work;
    } finally {
      if (this.chains.get(userId) === work)
        this.chains.delete(userId);
    }
  }
}

// src/auto-preparation.ts
class CompletionRegistry {
  now;
  ttl;
  limit;
  entries = new Map;
  constructor(now = Date.now, ttl = 24 * 60 * 60 * 1000, limit = 1000) {
    this.now = now;
    this.ttl = ttl;
    this.limit = limit;
  }
  remember(userId, ticket) {
    const key = JSON.stringify([userId, ticket.chatId]), prior = this.entries.get(key);
    if (prior && prior.ticket.completedAt > ticket.completedAt)
      return;
    const metadata = {
      chatId: ticket.chatId,
      messageId: ticket.messageId,
      generationId: ticket.generationId,
      completedAt: ticket.completedAt,
      ...ticket.characterId ? { characterId: ticket.characterId } : {},
      ...ticket.name ? { name: ticket.name } : {}
    };
    this.entries.delete(key);
    this.entries.set(key, { userId, ticket: metadata });
    for (const [id, value] of this.entries)
      if (value.ticket.completedAt < this.now() - this.ttl)
        this.entries.delete(id);
    while (this.entries.size > this.limit)
      this.entries.delete(this.entries.keys().next().value);
  }
  latest(userId, chatId, since) {
    const entry = this.entries.get(JSON.stringify([userId, chatId]));
    return entry && entry.ticket.completedAt >= Math.max(since, this.now() - this.ttl) ? entry.ticket : undefined;
  }
}

// src/audio-cache.ts
async function preparationHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

// src/backend.ts
var pronunciationPath = async (chatId) => `pronunciations-${await preparationHash([chatId])}.json`;
var pronunciations = new PronunciationStore({
  read: async (userId, chatId) => {
    const path = await pronunciationPath(chatId);
    return await spindle.userStorage.exists(path, userId) ? spindle.userStorage.read(path, userId) : undefined;
  },
  write: async (userId, chatId, value) => spindle.userStorage.write(await pronunciationPath(chatId), value, userId)
});
var preparationLedger = new PreparationLedger({
  read: async (userId) => await spindle.userStorage.exists("preparations.json", userId) ? spindle.userStorage.read("preparations.json", userId) : undefined,
  write: (userId, value) => spindle.userStorage.write("preparations.json", value, userId)
});
var settingsByUser = new Map;
var loadingByUser = new Map;
var busy = new Map;
var canceled = new Map;
var saveChains = new Map;
var activeGenerations = new Map;
var completions = new CompletionRegistry;
var failedSpeech = new Map;
var DIAGNOSTIC_TTL = 10 * 60 * 1000;
var LOCAL_CREDENTIALS = "local_credentials_v1";
async function keyStorage(work) {
  try {
    return await work();
  } catch {
    throw new Error("Could not access encrypted key storage. Check Lumiverse\u2019s credential settings. Existing keys were not intentionally removed.");
  }
}
async function keyStatus(userId) {
  return { openrouter: await keyStorage(() => spindle.enclave.has("openrouter_key", userId)), local: await keyStorage(async () => await spindle.enclave.has(LOCAL_CREDENTIALS, userId) || await spindle.enclave.has("local_key", userId)) };
}
function keyProvider(value) {
  if (value !== "openrouter" && value !== "local")
    throw new Error("Choose a direct speech provider first.");
  return value;
}
var models = [];
function send(payload, userId, sessionId) {
  spindle.sendToFrontend(payload, userId, sessionId ? { frontendSessionId: sessionId } : undefined);
}
async function load(userId) {
  if (settingsByUser.has(userId))
    return settingsByUser.get(userId);
  if (loadingByUser.has(userId))
    return loadingByUser.get(userId);
  const promise = (async () => {
    let raw = DEFAULTS;
    if (await spindle.userStorage.exists("settings.json", userId))
      raw = JSON.parse(await spindle.userStorage.read("settings.json", userId));
    const value = normalizeSettings(raw);
    settingsByUser.set(userId, value);
    return value;
  })();
  loadingByUser.set(userId, promise);
  try {
    return await promise;
  } finally {
    loadingByUser.delete(userId);
  }
}
async function save(userId, raw) {
  const value = normalizeSettings(raw);
  const chain = (saveChains.get(userId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await spindle.userStorage.write("settings.json", JSON.stringify(value), userId);
    settingsByUser.set(userId, value);
  });
  saveChains.set(userId, chain);
  await chain;
  if (saveChains.get(userId) === chain)
    saveChains.delete(userId);
  return value;
}
var ruleLocks = new Map;
async function ensureHideRule(userId) {
  if (!spindle.permissions.has("regex_scripts"))
    throw new Error("Grant the regex_scripts permission to hide emotion cues.");
  if (ruleLocks.has(userId))
    return ruleLocks.get(userId);
  const promise = (async () => {
    const { data } = await spindle.regex_scripts.list({ userId, limit: 200 });
    const prior = data.find((r) => r.name === HIDE_RULE_NAME && r.can_mutate);
    const rule = { name: HIDE_RULE_NAME, find_regex: CUE_PATTERN, replace_string: "", flags: "gi", placement: ["ai_output"], target: "display", scope: "global", disabled: false, folder: "Readalong", description: "Hides emotion, delivery, speaker and pronunciation cues in display; original messages stay unchanged." };
    if (prior)
      await spindle.regex_scripts.update(prior.id, rule, userId);
    else
      await spindle.regex_scripts.create(rule, userId);
  })();
  ruleLocks.set(userId, promise);
  try {
    await promise;
  } catch (e) {
    ruleLocks.delete(userId);
    throw e;
  }
}
function messageInfo(m, characterId) {
  return { id: m.id, content: m.content, name: m.name, isUser: m.is_user, characterId };
}
async function ownMessages(chatId, userId) {
  const chat = await spindle.chats.get(chatId, userId);
  if (!chat)
    throw new Error("Chat not found for this user.");
  return spindle.chat.getMessages(chatId);
}
async function requireChat(chatId, userId) {
  if (typeof chatId !== "string" || !chatId || chatId.length > 200 || !await spindle.chats.get(chatId, userId))
    throw new Error("Chat not found for this user.");
  return chatId;
}
async function speechModels() {
  const r = await spindle.cors("https://openrouter.ai/api/v1/models?output_modalities=speech");
  if (r.status !== 200)
    throw new Error(`Could not load speech models (${r.status}).`);
  const body = JSON.parse(r.body);
  models = (body.data ?? []).filter((m) => m.architecture?.output_modalities?.includes("speech")).map((m) => ({ id: m.id, name: m.name, voices: Array.isArray(m.supported_voices) ? m.supported_voices : [] }));
  return models;
}
function validLocalUrl(input, withKey = false) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Use an HTTP(S) API base URL without credentials, query, or fragment.");
  if (withKey && url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("A remote server with an API key must use HTTPS. HTTP is allowed only for a loopback speech server.");
  return url.href.replace(/\/$/, "");
}
async function speechConnection(settings, userId) {
  if (settings.provider === "lumiverse" || settings.provider === "browser")
    throw new Error("This voice connection is played through the Lumiverse frontend.");
  const openrouter = settings.provider === "openrouter";
  const base = openrouter ? "https://openrouter.ai/api/v1" : validLocalUrl(settings.localUrl);
  let key = null;
  if (openrouter)
    key = await keyStorage(() => spindle.enclave.get("openrouter_key", userId));
  else {
    const raw = await keyStorage(() => spindle.enclave.get(LOCAL_CREDENTIALS, userId));
    if (raw) {
      let saved;
      try {
        saved = JSON.parse(raw);
      } catch {
        throw new Error("Saved local credentials could not be read. Save the local key again.");
      }
      if (typeof saved.key !== "string" || saved.base !== base)
        throw new Error("This local key belongs to another server address. Save a key for this address before making requests.");
      key = saved.key;
      validLocalUrl(base, true);
    } else if (await keyStorage(() => spindle.enclave.has("local_key", userId)))
      throw new Error("Your existing local key is preserved. Save it again once to authorize this server address. No request was sent.");
  }
  if (openrouter && !key)
    throw new Error("Add your OpenRouter API key in Readalong settings.");
  const headers = { "Content-Type": "application/json" };
  if (key)
    headers.Authorization = `Bearer ${key}`;
  if (openrouter)
    headers["X-Title"] = "Lumiverse Readalong";
  return { base, headers, key, label: openrouter ? "OpenRouter" : "Speech provider" };
}
async function credentialRequest(url, options, key) {
  try {
    return await spindle.cors(url, options);
  } catch (e) {
    throw new Error(redactSecrets(e instanceof Error ? e.message : "Speech provider request failed.", key));
  }
}
async function checkConnection(settings, userId) {
  if (settings.provider === "browser")
    throw new Error("Browser voices do not need an API connection check.");
  const { base, headers, key, label } = await speechConnection(settings, userId);
  const result = await credentialRequest(`${base}/${settings.provider === "openrouter" ? "key" : "models"}`, { headers }, key);
  if (result.status < 200 || result.status >= 300)
    throw new Error(providerError(label, result.status, result.body, key));
  if (settings.provider === "openrouter") {
    const data = JSON.parse(result.body)?.data;
    if (!data || typeof data !== "object")
      throw new Error("OpenRouter returned an unexpected key-check response.");
    if (typeof data.limit === "number" && typeof data.limit_remaining === "number" && data.limit_remaining <= 0)
      throw new Error("This OpenRouter key has reached its spending limit. Update the limit or save another key.");
    return { message: "OpenRouter accepts your saved key. Model/provider access and available credit can still affect speech requests. No speech was generated." };
  }
  return { message: "The speech server accepted the model-list request. No speech was generated." };
}
async function synthesize(segment, settings, userId, characterId) {
  if (needsPcm(settings))
    throw new Error("For Gemini voices, select Lumiverse connection in Readalong and choose your saved OpenRouter TTS connection. No speech request was sent.");
  const { base, headers, key, label } = await speechConnection(settings, userId);
  const result = await credentialRequest(`${base}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(speechRequest(settings, segment, characterId)),
    responseType: "arraybuffer",
    mediaType: "audio"
  }, key);
  if (result.status < 200 || result.status >= 300)
    throw new Error(providerError(label, result.status, result.encoding === "base64" ? "" : result.body, key));
  if (result.encoding !== "base64" || !result.body)
    throw new Error("The speech provider returned no playable audio.");
  return { audio: result.body, mime: result.headers["content-type"] || "audio/mpeg" };
}
async function diagnoseSpeech(scope, userId) {
  const failed = failedSpeech.get(scope);
  failedSpeech.delete(scope);
  if (!failed || Date.now() - failed.at > DIAGNOSTIC_TTL)
    throw new Error("No recent failed speech request in this tab. Try a voice preview first.");
  const { base, headers, key, label } = await speechConnection(failed.settings, userId);
  const result = await credentialRequest(`${base}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(speechRequest(failed.settings, failed.segment, failed.characterId)),
    responseType: "text"
  }, key);
  const mime = result.headers?.["content-type"]?.toLowerCase() ?? "";
  if (result.status < 200 || result.status >= 300 || mime.includes("json"))
    throw new Error(providerError(label, result.status, result.body, key));
  if (mime.startsWith("audio/"))
    return { message: "The provider returned audio on this diagnostic attempt. Click Listen to try playback again." };
  throw new Error(`${label} returned an unexpected response (HTTP ${result.status}, ${mime || "no content type"}).`);
}
spindle.onFrontendMessage(async (payload, userId, sessionId) => {
  if (!payload || typeof payload !== "object")
    return;
  const p = payload;
  if (typeof p.requestId !== "string" || p.requestId.length > 100)
    return;
  const frontendId = typeof p.frontendId === "string" && /^[a-z0-9-]{1,100}$/i.test(p.frontendId) ? p.frontendId : undefined;
  const scope = `${userId}:${sessionId ?? frontendId ?? ""}`;
  const reply = (data) => send({ type: "reply", requestId: p.requestId, data, canDiagnoseSpeech: failedSpeech.has(scope) }, userId, sessionId);
  try {
    const settings = await load(userId);
    if (p.type === "init") {
      let cueStatus = "";
      try {
        await ensureHideRule(userId);
      } catch (e) {
        cueStatus = e instanceof Error ? e.message : "Could not install the display rule.";
      }
      const hasKeys = await keyStatus(userId);
      reply({ settings, userId, hasKey: hasKeys.openrouter, hasKeys, cueStatus, permissions: await spindle.permissions.getGranted() });
    } else if (p.type === "pronunciations" || p.type === "save_pronunciation" || p.type === "remove_pronunciation") {
      const chatId = await requireChat(p.chatId, userId);
      if (p.type === "save_pronunciation")
        reply({ entries: await pronunciations.save(userId, chatId, p.entry) });
      else if (p.type === "remove_pronunciation") {
        if (typeof p.name !== "string" || p.name.length > 80)
          throw new Error("Select a saved pronunciation.");
        reply({ entries: await pronunciations.remove(userId, chatId, p.name) });
      } else {
        let entries = await pronunciations.get(userId, chatId);
        if (settings.enabled && settings.promptPronunciations && typeof p.messageId === "string") {
          const all = await ownMessages(chatId, userId), message = all.find((m) => m.id === p.messageId && !m.is_user);
          if (message)
            entries = await pronunciations.learn(userId, chatId, message.content);
        }
        reply({ entries });
      }
    } else if (p.type === "latest_completion") {
      if (typeof p.chatId !== "string" || typeof p.since !== "number" || !Number.isFinite(p.since))
        throw new Error("Invalid completion lookup.");
      reply({
        completion: settings.enabled ? completions.latest(userId, p.chatId, p.since) ?? null : null,
        generating: [...activeGenerations.values()].some((g) => g.userId === userId && g.chatId === p.chatId)
      });
    } else if (p.type === "claim_preparation") {
      if (!settings.enabled)
        throw new Error("Readalong is off. Turn it on to request speech.");
      if (typeof p.key !== "string")
        throw new Error("Invalid preparation identity.");
      reply({ allowed: await preparationLedger.claim(userId, p.key, p.manual === true) });
    } else if (p.type === "save") {
      const saved = await save(userId, p.settings);
      for (const [id, failed] of failedSpeech)
        if (id.startsWith(`${userId}:`) && (saved.provider !== failed.settings.provider || saved.model !== failed.settings.model || saved.localUrl !== failed.settings.localUrl))
          failedSpeech.delete(id);
      reply({ settings: saved });
    } else if (p.type === "save_key") {
      if (typeof p.key !== "string" || !p.key.trim() || p.key.length > 4000)
        throw new Error("Paste a nonempty API key. Saving an empty field never removes a key.");
      const provider = keyProvider(p.provider), key = p.key.trim();
      if (provider === "local") {
        const base = validLocalUrl(typeof p.localUrl === "string" ? p.localUrl : settings.localUrl, true);
        await keyStorage(() => spindle.enclave.put(LOCAL_CREDENTIALS, JSON.stringify({ key, base }), userId));
      } else
        await keyStorage(() => spindle.enclave.put("openrouter_key", key, userId));
      for (const id of failedSpeech.keys())
        if (id.startsWith(`${userId}:`))
          failedSpeech.delete(id);
      reply({ hasKey: true });
    } else if (p.type === "remove_key") {
      const provider = keyProvider(p.provider);
      if (p.confirmed !== true)
        throw new Error("Confirm key removal first.");
      for (const name of provider === "local" ? [LOCAL_CREDENTIALS, "local_key"] : ["openrouter_key"])
        await keyStorage(() => spindle.enclave.delete(name, userId));
      for (const id of failedSpeech.keys())
        if (id.startsWith(`${userId}:`))
          failedSpeech.delete(id);
      reply({ hasKey: false });
    } else if (p.type === "models") {
      reply({ models: await speechModels() });
    } else if (p.type === "check_connection") {
      reply(await checkConnection(p.settings ? normalizeSettings(p.settings) : settings, userId));
    } else if (p.type === "diagnose_speech") {
      if (!settings.enabled)
        throw new Error("Readalong is off. Turn it on to request speech.");
      if (!sessionId && !frontendId)
        throw new Error("Reload Readalong before using diagnostics. No request was sent.");
      reply(await diagnoseSpeech(scope, userId));
    } else if (p.type === "characters") {
      const characters = [];
      for (let offset = 0;; offset += 200) {
        const { data, total } = await spindle.characters.list({ limit: 200, offset, userId });
        characters.push(...data.map((c) => ({ id: c.id, name: c.name, ttsVoice: readVoiceRef(c.extensions?.ttsVoice) })));
        if (data.length < 200 || characters.length >= total)
          break;
      }
      reply({ characters });
    } else if (p.type === "messages") {
      if (typeof p.chatId !== "string")
        throw new Error("Select a chat first.");
      const all = await ownMessages(p.chatId, userId);
      reply({ messages: all.filter((m) => !m.is_user).slice(-100).map((m) => messageInfo(m)) });
    } else if (p.type === "message") {
      if (typeof p.chatId !== "string" || typeof p.messageId !== "string")
        throw new Error("No message selected.");
      const all = await ownMessages(p.chatId, userId);
      if (p.latestOnly === true && all.filter((m) => !m.is_user).at(-1)?.id !== p.messageId) {
        reply({ message: null });
        return;
      }
      const m = all.find((m) => m.id === p.messageId);
      if (!m)
        throw new Error("Message no longer exists.");
      reply({ message: messageInfo(m) });
    } else if (p.type === "cancel") {
      canceled.set(scope, (canceled.get(scope) ?? 0) + 1);
      reply({});
    } else if (p.type === "speech") {
      if (!settings.enabled)
        throw new Error("Readalong is off. Turn it on to request speech.");
      if ((busy.get(scope) ?? 0) >= 2)
        throw new Error("Speech is already being prepared. Try again shortly.");
      const s = p.segment;
      if (!s || typeof s.text !== "string" || s.text.length > MAX_PASSAGE_CHARS || !s.text.trim())
        throw new Error("Invalid speech passage.");
      const segment = { text: s.text, speaker: typeof s.speaker === "string" ? s.speaker.slice(0, 80) : "", emotion: typeof s.emotion === "string" ? s.emotion : "", delivery: typeof s.delivery === "string" ? s.delivery : "" };
      const version = canceled.get(scope) ?? 0;
      busy.set(scope, (busy.get(scope) ?? 0) + 1);
      const playbackSettings = p.previewSettings ? normalizeSettings(p.previewSettings) : settings;
      const characterId = typeof p.characterId === "string" ? p.characterId : undefined;
      try {
        const audio = await synthesize(segment, playbackSettings, userId, characterId);
        if ((canceled.get(scope) ?? 0) !== version)
          throw new Error("Speech canceled.");
        failedSpeech.delete(scope);
        reply(audio);
      } catch (e) {
        if (isHiddenJsonError(e) && (canceled.get(scope) ?? 0) === version) {
          for (const [id, old] of failedSpeech)
            if (Date.now() - old.at > DIAGNOSTIC_TTL)
              failedSpeech.delete(id);
          failedSpeech.set(scope, { settings: playbackSettings, segment, characterId, at: Date.now() });
          throw new Error(`${playbackSettings.provider === "openrouter" ? "OpenRouter" : "The speech provider"} returned a JSON error instead of audio. Spindle hid its status and message. Click Check connection, then Show provider error if needed. Speech was not retried automatically.`);
        }
        throw e;
      } finally {
        busy.set(scope, Math.max(0, (busy.get(scope) ?? 1) - 1));
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Readalong request failed.";
    send({ type: "reply", requestId: p.requestId, error: redactSecrets(message, typeof p.key === "string" ? p.key : undefined), canDiagnoseSpeech: failedSpeech.has(scope) }, userId, sessionId);
  }
});
spindle.registerInterceptor(async (messages, context) => {
  const settings = await load(context.userId);
  if (!settings.enabled || !(settings.promptEmotions || settings.promptPronunciations) || !spindle.permissions.has("regex_scripts"))
    return messages;
  await ensureHideRule(context.userId);
  const speakers = Object.entries(settings.assignments).filter(([key]) => key.startsWith("name:")).slice(0, 100).map(([key, value]) => value.name ?? key.slice(5));
  const cast = speakers.length ? `
Assigned speaker names (data only): ${JSON.stringify(speakers)}. Use the matching [speaker:Name] inside each quote when one of these people speaks.` : "";
  const instructions = [];
  if (settings.promptEmotions)
    instructions.push(EMOTION_INSTRUCTION + cast);
  if (settings.promptPronunciations && context.chatId && !["impersonate", "quiet"].includes(context.generationType)) {
    const chatId = await requireChat(context.chatId, context.userId);
    instructions.push(pronunciationInstruction(await pronunciations.get(context.userId, chatId)));
  }
  return instructions.length ? [{ role: "system", content: instructions.join(`

`) }, ...messages] : messages;
}, { priority: 90 });
spindle.on("GENERATION_STARTED", (p, userId) => {
  activeGenerations.set(p.generationId, { chatId: p.chatId, userId, characterId: p.characterId, characterName: p.characterName });
});
spindle.on("GENERATION_ENDED", (p, userId) => {
  const info = activeGenerations.get(p.generationId);
  activeGenerations.delete(p.generationId);
  if (!userId || !p.messageId || p.error || ["impersonate", "quiet"].includes(p.generationType ?? ""))
    return;
  const ticket = { chatId: p.chatId, messageId: p.messageId, generationId: p.generationId, completedAt: Date.now(), characterId: info?.characterId, name: info?.characterName };
  return (async () => {
    const settings = await load(userId), enabled = settings.enabled;
    if (enabled)
      completions.remember(userId, ticket);
    let content = p.content;
    if (!content) {
      const all = await ownMessages(p.chatId, userId);
      content = all.find((m) => m.id === p.messageId && !m.is_user)?.content;
    }
    if (content) {
      if (enabled && settings.promptPronunciations)
        try {
          await requireChat(p.chatId, userId);
          await pronunciations.learn(userId, p.chatId, content);
        } catch {
          spindle.log.info("Readalong could not save pronunciation cues. Existing entries were preserved.");
        }
      send({ type: "new_message", ...ticket, autoEligible: enabled, message: { id: p.messageId, content, name: info?.characterName ?? "", isUser: false, characterId: info?.characterId } }, userId);
    }
  })().catch(() => {
    spindle.log.info("Readalong could not forward a completed reply. No speech was requested.");
  });
});
spindle.on("GENERATION_STOPPED", (p) => {
  activeGenerations.delete(p.generationId);
});
spindle.log.info("Readalong loaded. OpenRouter Gemini speech; no secondary LLM.");
