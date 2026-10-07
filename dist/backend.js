// @bun
// src/shared.ts
var EMOTIONS = ["neutral", "happy", "sad", "angry", "worried", "curious", "excited", "sarcastic", "tender", "afraid"];
var DELIVERIES = ["normal", "whispers", "shouts", "softly", "slowly", "laughs", "sighs"];
var CUE_PATTERN = String.raw`\[(?:emotion|delivery|speaker):[^\]\r\n]{1,80}\]`;
var HIDE_RULE_NAME = "Readalong \u2022 Hide voice cues";
var DEFAULTS = {
  provider: "openrouter",
  connectionId: "",
  model: "google/gemini-3.8-flash-tts",
  voice: "Kore",
  narratorVoice: "",
  localUrl: "http://localhost:8880/v1",
  enabled: true,
  follow: false,
  promptEmotions: true,
  useEmotions: true,
  inheritVoices: true,
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
    enabled: r.enabled !== false,
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
function speechRequest(settings, segment, characterId) {
  const assignment = selectVoice(settings, segment, characterId);
  const openrouter = settings.provider === "openrouter";
  const gemini38 = openrouter && /^google\/gemini-3\.8.*tts/.test(settings.model);
  const legacyTags = openrouter && /^google\/gemini-3\.1.*tts/.test(settings.model);
  const body = { model: settings.model, voice: assignment.voice, input: speechInput(segment, assignment, legacyTags), response_format: needsPcm(settings) ? "pcm" : "mp3" };
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

// src/playback-plan.ts
var MAX_PASSAGE_CHARS = 3000;

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
    403: "Check this key\u2019s access to the selected model and provider.",
    404: "Check model availability and provider routing in your account.",
    429: "The provider is rate limited. Wait before trying again."
  };
  return `${label} returned HTTP ${status}${detail ? `: ${detail}` : "."}${hints[status] ? ` ${hints[status]}` : ""}`;
}
function isHiddenJsonError(error) {
  return error instanceof Error && /only serves audio data.*application\/(?:json|[\w.-]+\+json)/i.test(error.message);
}

// src/backend.ts
var settingsByUser = new Map;
var loadingByUser = new Map;
var busy = new Map;
var canceled = new Map;
var saveChains = new Map;
var activeGenerations = new Map;
var failedSpeech = new Map;
var DIAGNOSTIC_TTL = 10 * 60 * 1000;
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
async function speechConnection(settings, userId) {
  if (settings.provider === "lumiverse" || settings.provider === "browser")
    throw new Error("This voice connection is played through the Lumiverse frontend.");
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
  return { base, headers, key, label: openrouter ? "OpenRouter" : "Speech provider" };
}
async function checkConnection(settings, userId) {
  if (settings.provider === "browser")
    throw new Error("Browser voices do not need an API connection check.");
  const { base, headers, key, label } = await speechConnection(settings, userId);
  const result = await spindle.cors(`${base}/${settings.provider === "openrouter" ? "key" : "models"}`, { headers });
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
  const result = await spindle.cors(`${base}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(speechRequest(settings, segment, characterId)),
    responseType: "arraybuffer",
    mediaType: "audio"
  });
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
  const result = await spindle.cors(`${base}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(speechRequest(failed.settings, failed.segment, failed.characterId)),
    responseType: "text"
  });
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
  const scope = `${userId}:${sessionId ?? ""}`;
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
      reply({ settings, hasKey: await spindle.enclave.has("openrouter_key", userId), cueStatus, permissions: await spindle.permissions.getGranted() });
    } else if (p.type === "save") {
      const saved = await save(userId, p.settings);
      for (const [id, failed] of failedSpeech)
        if (id.startsWith(`${userId}:`) && (saved.provider !== failed.settings.provider || saved.model !== failed.settings.model || saved.localUrl !== failed.settings.localUrl))
          failedSpeech.delete(id);
      reply({ settings: saved });
    } else if (p.type === "save_key") {
      if (typeof p.key !== "string" || p.key.length > 4000)
        throw new Error("Invalid API key.");
      const name = p.provider === "local" ? "local_key" : "openrouter_key";
      if (p.key.trim())
        await spindle.enclave.put(name, p.key.trim(), userId);
      else
        await spindle.enclave.delete(name, userId);
      for (const id of failedSpeech.keys())
        if (id.startsWith(`${userId}:`))
          failedSpeech.delete(id);
      reply({ hasKey: await spindle.enclave.has(name, userId) });
    } else if (p.type === "models") {
      reply({ models: await speechModels() });
    } else if (p.type === "check_connection") {
      reply(await checkConnection(p.settings ? normalizeSettings(p.settings) : settings, userId));
    } else if (p.type === "diagnose_speech") {
      if (!settings.enabled)
        throw new Error("Readalong is off. Turn it on to request speech.");
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
    send({ type: "reply", requestId: p.requestId, error: redactSecrets(message), canDiagnoseSpeech: failedSpeech.has(scope) }, userId, sessionId);
  }
});
spindle.registerInterceptor(async (messages, context) => {
  const settings = await load(context.userId);
  if (!settings.enabled || !settings.promptEmotions || !spindle.permissions.has("regex_scripts"))
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
