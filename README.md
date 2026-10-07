# Readalong for Lumiverse

Listen to assistant passages and find your place at a glance. Readalong highlights the sentence currently playing, lets you browse and preview speech voices, and saves character voice assignments. Optional emotion and speaker cues come from your existing chat model: **there is no second LLM call**.

Default connection: **OpenRouter → `google/gemini-3.8-flash-tts` → Kore**. Readalong fetches OpenRouter's speech model catalog and the full voice list reported for each model. Gemini's 30 studio voices are bundled as a fallback. Voice previews use one short sample. Your OpenRouter key is saved in Lumiverse's encrypted, per-user extension enclave and is never included in settings files or sent back to the frontend.

## Install

Use a current Lumiverse 1.2.0 or newer build with Spindle. This package includes prebuilt frontend and backend bundles.

**From GitHub:**

1. Open Extensions → Add Extension → Install from Source.
2. Enter `https://github.com/fidgetycarrot/lumiverse-readalong`.
3. Install, enable Readalong, and grant its requested permissions. The privileged CORS proxy permission needs owner/admin approval in Lumiverse.

**From the downloaded package, without GitHub:**

1. Extract the `lumiverse-readalong` folder into your Lumiverse server's configured data directory, under `extensions/`. The file should be at `data/extensions/lumiverse-readalong/spindle.json` for a standard installation.
2. As the owner/admin, open Extensions → Add Extension → Import Local. Lumiverse normalizes the folder to the extension identifier `readalong`.
3. Enable Readalong and grant its requested permissions.

A GitHub source is needed for automatic remote updates. Source and prebuilt bundles are available at [fidgetycarrot/lumiverse-readalong](https://github.com/fidgetycarrot/lumiverse-readalong).

## First reading

1. Open the Readalong drawer tab, or use the Readalong input-bar action.
2. Leave the provider on OpenRouter, paste your OpenRouter API key, and choose Save key.
3. Pick a speech model. Select a default voice and click **Listen** to preview it. Search filters the complete voice list for the chosen model.
4. Open a chat. Click **Read aloud** on a message, or choose an assistant message in the Readalong player and click **Read message**.
5. Pause keeps the current sentence highlighted. Resume continues the same clip. Stop clears the marker. Return to passage scrolls a mounted passage into view; optional Follow does this at sentence changes.

For a free first test, select Browser voices. Browser voice availability depends on the device/browser, and emotion directions are not applied in that mode. The local/OpenAI-compatible option requests MP3 from an `/audio/speech` endpoint; common Kokoro voice IDs are shown, with a custom voice field for other servers.

Turn off Lumiverse's built-in TTS autoplay if using Readalong's autoplay, so the two players do not speak at once. This extension's autoplay is off initially.

## Character voices

Choose a character in the Readalong panel, select a voice, preview it, and Save voice. The character editor also gets a **Voice** tab with the same controls. Assignments are tied to the character ID and survive chat changes. You can separately choose a narrator voice.

Speaker cues also pick up a saved character voice when the name matches one character in your library. For speakers without a character card, expand “Add a voice for a speaker mentioned in a passage” and enter the exact name. A matching `[speaker:Name]` cue will select that assignment. In the absence of a speaker assignment, the message's character voice or the default voice is used. If changing speech provider/model, choose compatible voice assignments again.

## Emotion cues

Readalong can add a compact instruction to the chat generation already being made. It asks the model for sparse cues such as:

```text
[speaker:Mara][emotion:worried][delivery:whispers]
“Are you sure we should go inside?”
[speaker:narrator]
The lantern trembled in her hand.
```

A display-only regex hides these cues from assistant messages. They remain in the original stored text for speech, and normal bracketed prose remains untouched. Emotion and delivery persist until changed; a speaker change resets them. For Gemini 3.8, the extension sends clean dialogue and passes delivery guidance as `provider.options.google-ai-studio.speech_metadata.style`, as documented by OpenRouter. For Gemini 3.1 it translates approved cues to audio tags. Other models get clean dialogue without unsupported control cues. Providers that do not honor the style metadata still receive clean speech text.

Supported emotions: neutral, happy, sad, angry, worried, curious, excited, sarcastic, tender, afraid.

Supported delivery directions: normal, whispers, shouts, softly, slowly, laughs, sighs.

You can disable prompting for new cues independently of using existing cues. Voices also have default emotion/delivery options. Audio-tag performance depends on the chosen model and voice; instructions do not guarantee a particular performance.

The owned regex rule is named **Readalong • Hide voice cues**, under the Readalong folder. Disable/remove that display rule if you want tags to become visible again. Existing messages do not need to be rewritten. If the hide-rule permission is unavailable, Readalong reports it and does not inject emotion instructions.

## What this version does and does not guarantee

- Highlights whole sentences based on actual clip playback. It does **not** estimate individual word timings. OpenRouter's speech endpoint does not document alignment timestamps.
- Synthesizes one sentence ahead for smoother transitions. Stop prevents further queued playback, but a request already sent to the provider cannot be canceled through Spindle's buffered CORS API and may still be billed.
- Reads completed messages. Live token-by-token narration is not enabled in this first version.
- Leaves the host's message text nodes and stored message content intact. Uses browser CSS Highlights, with an overlay fallback.
- Re-finds text after message DOM changes. Uses the currently verified Lumiverse message-content anchor; unusual display regex transformations, HTML islands, collapsed/virtualized messages, or complex formatting can prevent an inline match. The player always shows the current spoken sentence as a fallback. It does not automatically open a collapsed message or remount an offscreen virtualized message.
- Skips fenced code and images, reads link labels, and removes common Markdown decoration. Heavy custom rendering may differ from the spoken source.
- Uses ordinary speech synthesis only. No voice cloning, transcription, forced alignment, or additional analysis service is invoked.

## Permissions

| Permission | Purpose |
|---|---|
| `generation` | Detect completed replies for optional autoplay and identify the speaking character. |
| `interceptor` | Add optional voice-cue instructions to the existing generation. |
| `chat_mutation` | Read selected chat messages; no message writes are performed. |
| `chats` | Verify that each requested chat belongs to the requesting user before reading it. |
| `characters` | List characters and add the native character-editor Voice tab. |
| `regex_scripts` | Install the extension-owned display-only cue filter. |
| `cors_proxy` | Fetch voice/model lists and speech from OpenRouter or the selected local endpoint. |

Settings and keys are isolated per user even in operator installs. Responses to explicit frontend requests are routed back to the originating frontend session where the host supports session routing.

## Development and validation

```sh
npm ci
npm run check
npm test
npm run build
```

Requires Bun for builds/tests. Types are pinned to `lumiverse-spindle-types@0.6.39`. Runtime bundles have no third-party runtime dependencies.

Verified against the current Lumiverse source and Spindle types. All 23 parser/provider/session tests pass. Browser UI checks used a mock speech connection and covered voice search, model-specific lists, previews, actual audio-element playback, sentence markers, pause/resume, stop, chat changes, and unloading. The backend bundle also passed Lumiverse's current static extension scanner. Live OpenRouter synthesis still needs testing in your Lumiverse instance with your key; the development checks did not make paid speech requests.

OpenRouter requests use its documented OpenAI-compatible `/api/v1/audio/speech` endpoint with `response_format: "mp3"`. If a selected provider ignores that format and returns raw PCM, Spindle's transparent media proxy may reject it; use a provider that honors MP3 output. No direct-network bypass is used.

API references: [Spindle documentation](https://docs.lumiverse.chat/), [OpenRouter speech API](https://openrouter.ai/docs/guides/overview/multimodal/tts), [Gemini 3.8 Flash TTS](https://openrouter.ai/google/gemini-3.8-flash-tts/).
