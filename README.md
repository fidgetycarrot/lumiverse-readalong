# Readalong for Lumiverse

Listen to assistant passages and find your place at a glance. Readalong marks your estimated sentence within continuous audio, lets you browse and preview speech voices, and saves character voice assignments. Optional emotion and speaker cues come from your existing chat model: **there is no second LLM call**.

Recommended connection: **your saved Lumiverse OpenRouter TTS connection → `google/gemini-3.8-flash-tts` → Kore**. Readalong 0.1.5 reuses Lumiverse’s native TTS endpoint and saved provider key. When upgrading an existing Gemini setup, it automatically selects a matching saved OpenRouter TTS connection if one is available. Readalong fetches OpenRouter's speech model catalog and the full voice list reported for each model. Gemini's 30 studio voices are bundled as a fallback. Voice previews use one short sample. Native connection keys remain entirely in Lumiverse’s server-side encrypted storage. Direct-mode keys use the encrypted, per-user extension enclave. No provider key is returned to the frontend.

Version **0.1.5** automatically prepares the latest assistant reply when Readalong is on and prepares new completed replies in the background. **Playback always waits for your Play click.** The drawer and floating widget have an immediate on/off control; off stops playback and preparation and blocks new speech requests. Native Gemini uses larger same-voice batches and one prepared WAV file, avoiding full-message decoded buffers and the old 256 MiB rejection. The floating player works independently of the drawer and excludes its buttons from host drag handling.

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

**Updating to 0.1.5:** update Readalong from its extension settings and reload it. When on, it automatically prepares the latest assistant reply in the active chat and new replies, so provider charges can begin before Play. Use **Off** in the widget or uncheck **Readalong on** to avoid new speech requests. The manifest requests eight permissions, including `ui_panels` for the floating player. If upgrading from 0.1.3 and it still shows 7/8, enable **UI panels** and reload. Missing widget permission leaves the drawer usable.

## First reading

1. Open the Readalong drawer tab, or use the Readalong input-bar action.
2. Select **Lumiverse connection** and choose the saved OpenRouter TTS connection that already works in Lumiverse. Its existing key is reused. If the list is empty, add a TTS connection in Lumiverse’s voice settings, then click **Refresh connections and voices**.
3. Pick a speech model. Select a default voice and click **Listen** to preview it. Search filters the complete voice list for the chosen model.
4. Leave **Readalong on** checked to automatically prepare the latest assistant reply in this chat and each new completed reply. Wait for Ready, then press **Play** in the floating widget or drawer. It never starts message playback automatically. For an older message, click **Read aloud** or select it and click **Prepare message**.
5. **Pause** keeps your place. **Resume** continues from the same audio position. **Replay** uses the prepared audio without another speech request. **Stop** releases that audio and clears the marker. Return to passage scrolls a mounted passage into view; optional Follow does this at sentence changes.
6. **Off** stops playback, aborts native preparation and prevents new speech requests; work already accepted by the provider may still be billed. **On** prepares the latest reply and future replies. With `ui_panels` granted, the floating player appears when preparing a message or preview. Drag it to a convenient place; hide it with × and reopen it with **Floating player** in the drawer or the Readalong input-bar action. Hiding it leaves playback running. The native Spindle host supplies its drag behavior.

Every voice passage is fetched before Play is enabled, with at most three native requests running at once (two for direct modes). Preparation generates speech for the **entire selected message**, even if you only listen to part of it. Adjacent text with the same effective voice/direction shares a request, up to 12,000 characters for native Gemini and 3,000 for other modes. This reduces repeated provider requests for long narration; real latency still depends on the provider, voice changes and message length.

Prepared audio stays as compact browser audio files. Matching PCM/WAV clips join into one WAV file, so Gemini voice changes play continuously without loading another file or decoding the full message upfront. Other formats use prepared media files with the next voice preloaded; a small media-element handoff can occur at those voice boundaries. The native path has no 25 MiB proxy-response cap and there is no 256 MiB decoded-message cap. Device/browser resources and provider/file-format limits still apply. Prepared files are released on Stop, Off, another reading, chat/message changes or unloading; they are not saved into the chat. Replay reuses the same prepared files without a new provider request.

The sentence marker is an **estimate within each continuous voice passage**; voice-passage boundaries follow the actual audio clock. There are no alignment timestamps or extra alignment/LLM calls. Browser voices use native boundary events when available and cannot be synthesized into a reusable audio buffer; replay speaks again locally.

Gemini speech is requested as PCM and wrapped in a WAV container for playback, using the same approach as Lumiverse’s Google speech provider. No helper app or Lumiverse patch is needed. **Check connection** tests the saved connection without generating speech; **Listen** makes one speech request. Native provider errors appear immediately, without a second diagnostic speech request. Stop aborts native requests and stops playback, although OpenRouter may still charge for work already started.

For a free first test, select Browser voices. Browser voice availability depends on the device/browser, and emotion directions are not applied in that mode. The local/OpenAI-compatible option requests MP3 from an `/audio/speech` endpoint; common Kokoro voice IDs are shown, with a custom voice field for other servers.

Turn off Lumiverse’s built-in automatic TTS while Readalong is on to avoid generating and paying for the same reply twice. Readalong is on by default and always waits for manual Play; its off switch is saved per user. Old Readalong autoplay settings no longer start message playback.

## Troubleshooting

**Gemini says it only supports PCM, or the transparent proxy rejects the response:** update to **0.1.5**, select **Lumiverse connection**, choose your working saved OpenRouter TTS connection, and click **Listen**. The upgrade selects an existing OpenRouter connection automatically for older Gemini settings where possible.

**`PERMISSION_DENIED:ui_panels`, even with 7/7 granted:** version 0.1.3 omitted the widget permission from its manifest. Update to **0.1.5**; the extension now requests eight permissions. Enable `ui_panels` if it is not granted, then reload Readalong or click **Floating player** to refresh its grants. You can prepare, play, and pause in the drawer while the widget permission is unavailable.

**The widget appears inactive:** the widget now shows Preparing while it is working, Play when ready, and a Turn on action while off. Its buttons no longer bubble pointer-down into the host’s drag handler. Update to **0.1.5** and reload.

**“This message is too long to hold in memory”:** update to **0.1.5**. Native Gemini now uses compact prepared files instead of keeping a full-message decoded audio queue. Its old 256 MiB rejection is removed.

**No saved connections:** add a TTS connection in Lumiverse’s voice settings, then refresh the Readalong connection list. Readalong never creates, changes, or deletes native connection profiles or keys.

**Native speech fails:** its provider status/message appears on the first request. Check connection performs the native provider’s key/connection test, without speech. A successful check does not guarantee credit, model access, or synthesis success.

**Direct MP3 speech returns JSON:** Spindle may hide the original status and error body. Click Check connection, then Show provider error if needed. This explicit diagnostic repeats the last failed speech request once; if that request succeeds, normal speech charges may apply. It never retries automatically. The diagnostic is limited to the originating user/tab and expires after ten minutes.


## Character voices

Choose a character in the Readalong panel, select a voice, preview it, and Save voice. The character editor also gets a **Readalong voice** tab with the same controls. Assignments are tied to the character ID and survive chat changes. You can separately choose a narrator voice. Choosing distinct narrator and character voices makes the switch audible.

With **Lumiverse connection**, unassigned voices inherit Lumiverse’s per-chat overrides, character-card `ttsVoice`, and global narrator voice where the saved connections are available. Readalong assignments take precedence. Turn off **Use Lumiverse’s saved character and narrator voices** to use only Readalong settings. Inherited voices may use different saved TTS connections; Readalong does not modify them. Its speed control applies to the prepared playback; per-voice native speed overrides are not imported.

Without speaker cues, straight, curly, and guillemet double quotes are treated as dialogue from the message’s character, and surrounding prose as narration. Native Lumiverse speech-detection rules are respected when available, including skipped asterisked actions. Otherwise asterisked prose uses the narrator. Multiple characters speaking in the same message need explicit `[speaker:Name]` cues; quotation marks alone do not identify which character spoke.

Speaker cues also pick up a saved character voice when the name matches one character in your library. For speakers without a character card, expand “Add a voice for a speaker mentioned in a passage” and enter the exact name. A matching `[speaker:Name]` cue will select that assignment. In the absence of a speaker assignment, the message's character voice or the default voice is used. If changing speech provider/model, choose compatible voice assignments again.

## Emotion cues

Readalong can add a compact instruction to the chat generation already being made. It asks the model for sparse cues such as:

```text
[speaker:Mara][emotion:worried][delivery:whispers]
“Are you sure we should go inside?”
[speaker:narrator]
The lantern trembled in her hand.
```

While Readalong is off, no new cue instructions are added. A display-only regex hides these cues from assistant messages. They remain in the original stored text for speech, and normal bracketed prose remains untouched. Emotion and delivery persist until changed; a speaker change resets them. For Gemini 3.8, native playback receives clean dialogue. **Lumiverse’s current native OpenRouter TTS adapter does not forward per-sentence `speech_metadata`**, so Gemini 3.8 emotion/delivery cues currently have no effect through that connection. They remain hidden and saved for future support. Native Gemini 3.1 uses approved inline audio tags; OpenAI mini-TTS models receive separate style instructions where their native adapter supports them. Other models get clean dialogue. Instructions do not guarantee a particular performance.

Supported emotions: neutral, happy, sad, angry, worried, curious, excited, sarcastic, tender, afraid.

Supported delivery directions: normal, whispers, shouts, softly, slowly, laughs, sighs.

You can disable prompting for new cues independently of using existing cues. Voices also have default emotion/delivery options. Audio-tag performance depends on the chosen model and voice; instructions do not guarantee a particular performance.

The owned regex rule is named **Readalong • Hide voice cues**, under the Readalong folder. Disable/remove that display rule if you want tags to become visible again. Existing messages do not need to be rewritten. If the hide-rule permission is unavailable, Readalong reports it and does not inject emotion instructions.

## What this version does and does not guarantee

- Highlights an estimated sentence within a continuous voice passage. It does not provide word alignment. OpenRouter's speech endpoint does not document alignment timestamps; voice changes follow real audio boundaries.
- Automatically prepares completed replies while on and waits for manual Play. Coalesces same-voice text and joins compatible PCM files for continuous Gemini playback. Other file formats preload the next voice. Stop aborts native synthesis and prevents further requests from being dispatched; direct requests already sent through Spindle’s buffered CORS API cannot be canceled. Providers may still bill for work already started.
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
| `ui_panels` | Create the movable floating playback widget; drawer playback remains usable without it. |

Settings and keys are isolated per user even in operator installs. Responses to explicit frontend requests are routed back to the originating frontend session where the host supports session routing.

## Development and validation

```sh
npm ci
npm run check
npm test
npm run build
```

Requires Bun for builds/tests. Types are pinned to `lumiverse-spindle-types@0.6.39`. Runtime bundles have no third-party runtime dependencies.

Verified against the current Lumiverse source and Spindle types. All 81 parser/provider/session/playback tests pass, including the prepared-file player, ordered PCM joins, real voice boundaries, exact pause/resume, replay without synthesis, cancellation, on/off request blocking, larger native batches, and a 40-minute recording that exceeds the former decoded-memory budget. Browser checks used mock speech: automatic preparation on load/new replies, manual playback, duplicate completion suppression, widget Play/Pause and power controls, a 25-minute file larger than the former native response cap, off preventing requests, provider errors, missing widget permission and cleanup. The backend bundle passes Lumiverse’s static extension scanner. No paid speech requests were made. Real OpenRouter preparation speed still needs verification in your Lumiverse instance with your key.

Native mode uses Lumiverse’s session-authenticated `/api/v1/tts-connections`, `/api/v1/settings/voiceSettings` (read-only voice/detection preferences), and `/api/v1/tts/synthesize` routes, the same routes as its built-in voice player. Gemini on OpenRouter requests `pcm`; Readalong preserves the 16-bit mono samples and adds a WAV header (24 kHz by default, or the response’s rate parameter). Other native providers retain their configured output format. The public OpenRouter catalog supplies complete model-specific voice lists instead of the host’s shorter curated list. Direct OpenRouter mode remains available for MP3 models; it refuses Gemini speech before sending a paid request and directs you to a saved Lumiverse connection. The host’s CORS media guard remains unchanged.

API references: [Spindle documentation](https://docs.lumiverse.chat/), [OpenRouter speech API](https://openrouter.ai/docs/guides/overview/multimodal/tts), [Gemini 3.8 Flash TTS](https://openrouter.ai/google/gemini-3.8-flash-tts/).
