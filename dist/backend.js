// @bun
// src/shared.ts
var EMOTIONS = ["neutral", "happy", "sad", "angry", "worried", "curious", "excited", "sarcastic", "tender", "afraid"];
var DELIVERIES = ["normal", "whispers", "shouts", "softly", "slowly", "laughs", "sighs"];
var CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]`;
var HIDE_RULE_NAME = "Readalong \u2022 Hide voice cues";
var DEFAULTS = {
  provider: "openrouter",
  model: "google/gemini-3.8-flash-tts",
  voice: "Kore",
  narratorVoice: "",
  localUrl: "http://localhost:8880/v1",
  autoPlay: false,
  follow: false,
  promptEmotions: true,
  useEmotions: true,
  speed: 1,
  volume: 0.85,
  assignments: {}
};
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
    provider: ["openrouter", "browser", "local"].includes(r.provider ?? "") ? r.provider : DEFAULTS.provider,
    model: str(r.model, DEFAULTS.model),
    voice: str(r.voice, DEFAULTS.voice),
    narratorVoice: str(r.narratorVoice, ""),
    localUrl: str(r.localUrl, DEFAULTS.localUrl, 500),
    autoPlay: r.autoPlay === true,
    follow: r.follow === true,
    promptEmotions: r.promptEmotions !== false,
    useEmotions: r.useEmotions !== false,
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
function speechRequest(settings, segment, characterId) {
  const assignment = selectVoice(settings, segment, characterId);
  const openrouter = settings.provider === "openrouter";
  const gemini38 = openrouter && /^google\/gemini-3\.8.*tts/.test(settings.model);
  const legacyTags = openrouter && /^google\/gemini-3\.1.*tts/.test(settings.model);
  const body = { model: settings.model, voice: assignment.voice, input: speechInput(segment, assignment, legacyTags), response_format: "mp3" };
  if (gemini38) {
    const emotions = { happy: "happy and cheerful", sad: "sad", angry: "angry", worried: "worried", curious: "curious", excited: "excited", sarcastic: "sarcastic", tender: "warm and tender", afraid: "afraid" };
    const deliveries = { whispers: "whispering", shouts: "shouting", softly: "soft-spoken", slowly: "slow and deliberate", laughs: "with a light laugh", sighs: "with a sigh" };
    const style = [emotions[assignment.emotion], deliveries[assignment.delivery]].filter(Boolean).join(", ");
    if (style)
      body.provider = { options: { "google-ai-studio": { speech_metadata: { style } } } };
  }
  return body;
}
var EMOTION_INSTRUCTION = `When vocal delivery matters, add sparse voice cues immediately before the affected sentence, using [emotion:neutral|happy|sad|angry|worried|curious|excited|sarcastic|tender|afraid] and optionally [delivery:normal|whispers|shouts|softly|slowly|laughs|sighs]. Choose one value per cue, not the list. For a speaker change use [speaker:Character Name], or [speaker:narrator] for narration. Cues persist until changed; a speaker change resets emotion and delivery. Use the exact character name, preserve ordinary prose and formatting, and avoid tagging every sentence. These cues are hidden from the reader and used only for speech. Do not add any other bracketed audio instructions.`;

// src/backend.ts
var settingsByUser = new Map;
var loadingByUser = new Map;
var busy = new Map;
var canceled = new Map;
var saveChains = new Map;
var activeGenerations = new Map;
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
    const rule = { name: HIDE_RULE_NAME, find_regex: CUE_PATTERN, replace_string: "", flags: "gi", placement: ["ai_output"], target: "display", scope: "global", disabled: false, folder: "Readalong", description: "Hides emotion, delivery, and speaker cues only in display; original text remains available to speech." };
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
async function speechModels() {
  const r = await spindle.cors("https://openrouter.ai/api/v1/models?output_modalities=speech");
  if (r.status !== 200)
    throw new Error(`Could not load speech models (${r.status}).`);
  const body = JSON.parse(r.body);
  models = (body.data ?? []).filter((m) => m.architecture?.output_modalities?.includes("speech")).map((m) => ({ id: m.id, name: m.name, voices: Array.isArray(m.supported_voices) ? m.supported_voices : [] }));
  return models;
}
function validLocalUrl(input) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Use an HTTP(S) API base URL without credentials, query, or fragment.");
  return url.href.replace(/\/$/, "");
}
async function synthesize(segment, settings, userId, characterId) {
  const openrouter = settings.provider === "openrouter";
  const key = await spindle.enclave.get(openrouter ? "openrouter_key" : "local_key", userId);
  if (openrouter && !key)
    throw new Error("Add your OpenRouter API key in Readalong settings.");
  const base = openrouter ? "https://openrouter.ai/api/v1" : validLocalUrl(settings.localUrl);
  const headers = { "Content-Type": "application/json" };
  if (key)
    headers.Authorization = `Bearer ${key}`;
  if (openrouter)
    headers["X-Title"] = "Lumiverse Readalong";
  const result = await spindle.cors(`${base}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(speechRequest(settings, segment, characterId)),
    responseType: "arraybuffer",
    mediaType: "audio"
  });
  if (result.status < 200 || result.status >= 300)
    throw new Error(`Speech request failed (${result.status}). Check model, voice, key, and available credit.`);
  if (result.encoding !== "base64" || !result.body)
    throw new Error("The speech provider returned no playable audio.");
  return { audio: result.body, mime: result.headers["content-type"] || "audio/mpeg" };
}
spindle.onFrontendMessage(async (payload, userId, sessionId) => {
  if (!payload || typeof payload !== "object")
    return;
  const p = payload;
  if (typeof p.requestId !== "string" || p.requestId.length > 100)
    return;
  const reply = (data) => send({ type: "reply", requestId: p.requestId, data }, userId, sessionId);
  try {
    const settings = await load(userId);
    if (p.type === "init") {
      let cueStatus = "";
      try {
        await ensureHideRule(userId);
      } catch (e) {
        cueStatus = e instanceof Error ? e.message : "Could not install the display rule.";
      }
      reply({ settings, hasKey: await spindle.enclave.has("openrouter_key", userId), cueStatus, permissions: await spindle.permissions.getGranted() });
    } else if (p.type === "save") {
      reply({ settings: await save(userId, p.settings) });
    } else if (p.type === "save_key") {
      if (typeof p.key !== "string" || p.key.length > 4000)
        throw new Error("Invalid API key.");
      const name = p.provider === "local" ? "local_key" : "openrouter_key";
      if (p.key.trim())
        await spindle.enclave.put(name, p.key.trim(), userId);
      else
        await spindle.enclave.delete(name, userId);
      reply({ hasKey: await spindle.enclave.has(name, userId) });
    } else if (p.type === "models") {
      reply({ models: await speechModels() });
    } else if (p.type === "characters") {
      const characters = [];
      for (let offset = 0;; offset += 200) {
        const { data, total } = await spindle.characters.list({ limit: 200, offset, userId });
        characters.push(...data.map((c) => ({ id: c.id, name: c.name })));
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
      const m = all.find((m) => m.id === p.messageId);
      if (!m)
        throw new Error("Message no longer exists.");
      reply({ message: messageInfo(m) });
    } else if (p.type === "cancel") {
      const scope = `${userId}:${sessionId ?? ""}`;
      canceled.set(scope, (canceled.get(scope) ?? 0) + 1);
      reply({});
    } else if (p.type === "speech") {
      const scope = `${userId}:${sessionId ?? ""}`;
      if ((busy.get(scope) ?? 0) >= 2)
        throw new Error("Speech is already being prepared. Try again shortly.");
      const s = p.segment;
      if (!s || typeof s.text !== "string" || s.text.length > 1200 || !s.text.trim())
        throw new Error("Invalid speech passage.");
      const segment = { text: s.text, speaker: typeof s.speaker === "string" ? s.speaker.slice(0, 80) : "", emotion: typeof s.emotion === "string" ? s.emotion : "", delivery: typeof s.delivery === "string" ? s.delivery : "" };
      const version = canceled.get(scope) ?? 0;
      busy.set(scope, (busy.get(scope) ?? 0) + 1);
      try {
        const playbackSettings = p.previewSettings ? normalizeSettings(p.previewSettings) : settings;
        const audio = await synthesize(segment, playbackSettings, userId, typeof p.characterId === "string" ? p.characterId : undefined);
        if ((canceled.get(scope) ?? 0) !== version)
          throw new Error("Speech canceled.");
        reply(audio);
      } finally {
        busy.set(scope, Math.max(0, (busy.get(scope) ?? 1) - 1));
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Readalong request failed.";
    send({ type: "reply", requestId: p.requestId, error: message.replace(/Bearer\s+\S+|sk-or-v1-\S+/gi, "[redacted]") }, userId, sessionId);
  }
});
spindle.registerInterceptor(async (messages, context) => {
  const settings = await load(context.userId);
  if (!settings.promptEmotions || !spindle.permissions.has("regex_scripts"))
    return messages;
  await ensureHideRule(context.userId);
  return [{ role: "system", content: EMOTION_INSTRUCTION }, ...messages];
}, { priority: 90 });
spindle.on("GENERATION_STARTED", (p) => {
  activeGenerations.set(p.generationId, { characterId: p.characterId, characterName: p.characterName });
});
spindle.on("GENERATION_ENDED", (p, userId) => {
  const info = activeGenerations.get(p.generationId);
  activeGenerations.delete(p.generationId);
  if (userId && p.messageId && p.content && !p.error && p.generationType !== "impersonate")
    send({ type: "new_message", chatId: p.chatId, message: { id: p.messageId, content: p.content, name: info?.characterName ?? "", isUser: false, characterId: info?.characterId } }, userId);
});
spindle.on("GENERATION_STOPPED", (p) => {
  activeGenerations.delete(p.generationId);
});
spindle.log.info("Readalong loaded. OpenRouter Gemini speech; no secondary LLM.");
