# Readalong for Lumiverse

Listen to assistant passages and find your place at a glance. Readalong marks your estimated sentence within continuous audio, lets you browse and preview speech voices, and saves character voice assignments. Optional emotion and speaker cues come from your existing chat model: **there is no second LLM call**.

Recommended connection: **your saved Lumiverse OpenRouter TTS connection → `google/gemini-3.8-flash-tts` → Kore**. Readalong 0.2.1 reuses Lumiverse’s native TTS endpoint and saved provider key. When upgrading an existing Gemini setup, it automatically selects a matching saved OpenRouter TTS connection if one is available. Readalong fetches OpenRouter's speech model catalog and the full voice list reported for each model. Gemini's 30 studio voices are bundled as a fallback. Voice previews use one short sample. Native connection keys remain entirely in Lumiverse’s server-side encrypted storage. Direct-mode keys use the encrypted, per-user extension enclave. No provider key is returned to the frontend.

Version **0.2.2** fixes playback controls being replaced during clock, marker and preparation updates, and guards overlapping Play and Prepare clicks. **Play, Resume and Replay never start a speech request.** If nothing is loaded, the widget offers **Load saved**; missing audio requires the separate **Prepare message** action. A browser-blocked Play can be retried locally with the same audio.

The new **Allow Play when about 75% of the message is ready** option is on by default. It enables Play when an unbroken opening buffer covers at least 75% of the passage text and 30 seconds of audio. You still choose when to press Play. Preparation continues using the same planned requests, with no extra splitting, analysis or synthesis. Later passages completing first do not count toward the opening buffer. Short and single-file messages wait for full preparation. Turn this option off to keep full preparation before playback. Phone/tablet controls and saved placement from 0.2.1 remain supported.

Public-beta protections remain: fresh installs start **off**, direct keys are protected from error echoes, and local-provider keys are bound to their exact saved server address. Empty or failed key saves do not remove a saved key; removal requires confirmation. Existing settings, voices, and on/off choices are preserved. See [the security review and privacy notes](SECURITY.md) for what was checked and its limits.

The **Character voices** section now has separate expandable rows and **Add cast member** controls. Add library characters or named speakers without cards, save an independent voice for each, and keep narration separate. The floating player minimizes to a compact bar and remembers its position and selected mode.

Readalong also supports Gemini 3.8 inline vocal events from presets such as Threadbare, preserving the entire dialogue after standalone `<gasp>`, `<sigh>`, `<heavy breath>` and pause tokens. Only recognized attribute-free vocal tokens are preserved for Gemini 3.8; they are hidden from the player/marker and omitted for unsupported models. It also excludes entire scene cards, flair choices, image prompts (`<dt-image>`), tool/control blocks and comment-delimited UI cards from speech. It keeps ordinary HTML prose. A speaker cue on quoted dialogue ends at the closing quote, so the following narration returns to its assigned voice without requiring a reset cue. It also saves prepared audio locally and restores it after an app refresh without generating speech again. Refresh and chat switching never start paid preparation when saved audio is missing. New completed replies prepare automatically while on; explicitly turning on prepares only the latest reply, once. **Playback always waits for your Play click.** The drawer and floating widget have an immediate on/off control; off stops playback and preparation and blocks new speech requests. Native Gemini uses larger same-voice batches and joined prepared WAV files, avoiding full-message decoded buffers and the old 256 MiB rejection. The floating player works independently of the drawer and excludes its buttons from host drag handling.

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

**Updating to 0.2.2:** update Readalong from its extension settings and reload it. Play now uses existing audio only, rapid presses are guarded, and longer multi-passage messages can be played while the remainder prepares. The widget retains its phone/touch sizing, saved position and live resize behavior. Existing cast assignments, on/off preference, player position and matching prepared audio are preserved. Add people under **Character voices → Add cast member**. The update never regenerates old audio automatically. A legacy direct local-provider key is retained, but must be pasted and saved once more to authorize its exact server address; native Lumiverse connections and direct OpenRouter keys need no re-entry. The manifest still requests eight permissions, including `ui_panels` for the floating player. If upgrading from 0.1.3 and it still shows 7/8, enable **UI panels** and reload. Missing widget permission leaves the drawer usable.

## First reading

1. Open the Readalong drawer tab, or use the Readalong input-bar action.
2. Select **Lumiverse connection** and choose the saved OpenRouter TTS connection that already works in Lumiverse. Its existing key is reused. If the list is empty, add a TTS connection in Lumiverse’s voice settings, then click **Refresh connections and voices**.
3. Pick a speech model. Select a default voice and click **Listen** to preview it. Search filters the complete voice list for the chosen model.
4. Readalong starts **off** on a fresh install. Check **Readalong on** when you want to prepare the latest reply and each new completed reply. Preparation may incur provider charges before Play. An app refresh or chat switch restores matching saved audio without a speech request; when none is saved, the existing message waits for your manual choice. Wait for Ready, then press **Play** in the floating widget or drawer. It never starts message playback automatically. For an older message, click **Read aloud** or select it and click **Prepare message**.
5. **Pause** keeps your place. **Resume** continues from the same audio position. **Replay** uses the prepared audio without another speech request. **Stop** releases the loaded playback file and clears the marker; its saved local copy can be restored. Return to passage scrolls a mounted passage into view; optional Follow does this at sentence changes.
6. **Off** stops playback, aborts native preparation and prevents new speech requests; work already accepted by the provider may still be billed. **On** restores saved audio or prepares only the latest reply if it has not been attempted before, then prepares future replies. An interrupted, failed, or previously prepared message with no saved audio requires an explicit manual preparation choice; charges may apply. With `ui_panels` granted, the floating player appears when preparing a message or preview. Drag it to a convenient place; minimize it with **−** and expand it with **↗**, or hide it with × and reopen it with **Floating player** in the drawer or the Readalong input-bar action. Hiding it leaves playback running. The native Spindle host supplies its drag behavior.

Every voice passage is fetched before Play is enabled, with at most three native requests running at once (two for direct modes). Preparation generates speech for the **entire selected message**, even if you only listen to part of it. Adjacent text with the same effective voice/direction shares a request, up to 12,000 characters for native Gemini and 3,000 for other modes. This reduces repeated provider requests for long narration; real latency still depends on the provider, voice changes and message length.

Prepared audio stays as compact browser audio files. Matching PCM/WAV clips join into one WAV file, so Gemini voice changes play continuously without loading another file or decoding the full message upfront. Other formats use prepared media files with the next voice preloaded; a small media-element handoff can occur at those voice boundaries. The native path has no 25 MiB proxy-response cap and there is no 256 MiB decoded-message cap. Device/browser resources and provider/file-format limits still apply. Loaded playback files are released on Stop, Off, another reading, chat/message changes or unloading; they are not saved into the chat. Completed message audio is also saved in this browser profile, scoped to the authenticated Lumiverse user, with up to three recent recordings and 256 MiB per user. This is a disk-cache budget, not a playback or message-length cap. If a recording is too large to save or browser storage fails, it can still play in the current session; refreshing never regenerates it automatically. Cache identities include the message text and effective speech requests, so changing text, model, or voice cannot replay a mismatched recording. Speed and volume changes reuse saved speech. Voice previews are not cached. Replay reuses the same prepared files without a new provider request.

A separate server-side, per-user history remembers the last 2,000 preparation attempts before speech starts. Duplicate completion events, multiple tabs, interrupted preparation, and missing or evicted audio cannot automatically claim the same recorded attempt again. Manual **Prepare message**, **Read aloud**, or an idle widget’s **Play latest** reuses matching saved audio first; if no matching file remains, that explicit action can request speech again and incur charges. Audio caches stay on this device and are not synchronized between devices. Refreshing always uses restore-only behavior, even after clearing browser storage or upgrading from a version that did not save audio.

The sentence marker is an **estimate within each continuous voice passage**; voice-passage boundaries follow the actual audio clock. There are no alignment timestamps or extra alignment/LLM calls. Browser voices use native boundary events when available and cannot be synthesized into a reusable audio buffer; replay speaks again locally.

Gemini speech is requested as PCM and wrapped in a WAV container for playback, using the same approach as Lumiverse’s Google speech provider. No helper app or Lumiverse patch is needed. **Check connection** tests the saved connection without generating speech; **Listen** makes one speech request. Native provider errors appear immediately, without a second diagnostic speech request. Stop aborts native requests and stops playback, although OpenRouter may still charge for work already started.

For a free first test, select Browser voices. Browser voice availability depends on the device/browser, and emotion directions are not applied in that mode. The local/OpenAI-compatible option requests MP3 from an `/audio/speech` endpoint; common Kokoro voice IDs are shown, with a custom voice field for other servers.

Turn off Lumiverse’s built-in automatic TTS while Readalong is on to avoid generating and paying for the same reply twice. New installs start off and always wait for manual Play; the on/off choice is saved per user. Updating an existing install preserves its choice. Old Readalong autoplay settings no longer start message playback.

## Earlier playback and charges

The preparation bar counts completed voice passages, which may finish out of order. Early Play also checks that the beginning is ready in order and contains enough audio. It therefore may remain unavailable at 75% on the bar. It can help a long reading with several voice passages, but a message requested as one audio file still needs that whole file first; this feature does not stream provider tokens or a partially received file.

The opening and remaining PCM buffers are joined separately for an early start, with one media-player handoff between them. If you wait for full preparation before playing, compatible PCM is joined into the usual single file. Early playback does not retain full decoded buffers. If playback catches up, it waits for the already-running preparation, without issuing a retry. Pausing while waiting prevents the remaining audio from starting until Resume. Stop or Off cancels preparation and playback; a failed remaining request stops the session and requires an explicit manual preparation to retry. Only complete recordings enter the refresh cache.

Play, Pause, Resume, Replay, minimizing and loading saved audio never authorize synthesis. Automatic preparation while on, explicitly turning on for a new unattempted reply, **Prepare message**, voice **Listen** samples and explicit diagnostics can generate billed speech. A failed local Play does not repeat that provider work. Two rapid Prepare presses in the same player are guarded; manually preparing again later remains an intentional retry. Provider work already accepted may still be billed after Stop/Off. The attempt history and cache protections are retained, including their documented limits.

## Troubleshooting

**Play needs two presses:** update to **0.2.2** and reload. Playback controls now stay connected during sentence/progress updates. Starting playback is guarded against overlapping presses and calls the media player directly inside the click. If your browser still blocks sound, the message says so; pressing Play again reuses the prepared recording without a provider request. **Load saved** is intentionally a loading action followed by Play, so its first click does not generate or start audio.

**Scene cards, choices or image prompts are read aloud:** update to **0.2.2** and reload. Custom XML blocks are omitted together with their contents before any voice cues are parsed; recognized standalone Gemini vocal tokens are handled separately. This includes `<flair>`, `<flair-choice>`, `<scenecard>`, `<sc-*>`, `<dt-image>` and `<lumidraw-parse>`. The original message and other extensions remain unchanged.

**Narration sounds like the character:** update to **0.2.2**, choose distinct voices, and click **Save voice** for the character. A speaker cue in dialogue now ends at its closing quote. For example, Autonoe narration and Fenrir dialogue are sent as separate voice passages through the same native connection. Already prepared recordings require a manual preparation to reflect changed voices; charges may apply. Native speech-detection preferences still apply, including treating undecorated text as speech if you explicitly selected that rule in Lumiverse.

**Refreshing prepares the same message again:** update to **0.2.2** and reload. Refresh now restores saved audio and sends no speech requests. If old audio was discarded, click **Prepare message** only when you want to pay to generate it again. Turning off/on also avoids automatically retrying a previously recorded preparation attempt.

**Gemini says it only supports PCM, or the transparent proxy rejects the response:** update to **0.2.2**, select **Lumiverse connection**, choose your working saved OpenRouter TTS connection, and click **Listen**. The upgrade selects an existing OpenRouter connection automatically for older Gemini settings where possible.

**`PERMISSION_DENIED:ui_panels`, even with 7/7 granted:** version 0.1.3 omitted the widget permission from its manifest. Update to **0.2.2**; the extension now requests eight permissions. Enable `ui_panels` if it is not granted, then reload Readalong or click **Floating player** to refresh its grants. You can prepare, play, and pause in the drawer while the widget permission is unavailable.

**The widget appears inactive:** the widget now shows Preparing while it is working, Play when ready, and a Turn on action while off. Its buttons no longer bubble pointer-down into the host’s drag handler. Update to **0.2.2** and reload.

**“This message is too long to hold in memory”:** update to **0.2.2**. Native Gemini now uses compact prepared files instead of keeping a full-message decoded audio queue. Its old 256 MiB rejection is removed.

**No saved connections:** add a TTS connection in Lumiverse’s voice settings, then refresh the Readalong connection list. Readalong never creates, changes, or deletes native connection profiles or keys.

**Native speech fails:** its HTTP status and a safe guidance message appear on the first request. Raw upstream error prose is not displayed because it could contain a saved credential. Check connection performs the native provider’s key/connection test, without speech. A successful check does not guarantee credit, model access, or synthesis success.

**Direct MP3 speech returns JSON:** Spindle may hide the original status and error body. Click Check connection, then Show provider error if needed. This explicit diagnostic repeats the last failed speech request once; if that request succeeds, normal speech charges may apply. It never retries automatically. The diagnostic is limited to the originating user/tab and expires after ten minutes.


## Character voices

Each cast member has a separate expandable row. Under **Character voices → Add cast member**, select **Character from your library** and click **Add character voice**, or enter a **Speaker name in the story** and click **Add speaker voice**. Open the row, choose its voice, preview it while Readalong is on, and click **Save voice**. Repeat for the rest of your cast. Adding or saving cast voices does not synthesize speech; **Listen** does. Remove one assignment with **Remove cast voice** without changing the others.

Library assignments are tied to character IDs and survive chat changes. Named assignments are matched case-insensitively to the exact speaker name; their original capitalization is kept for display. Up to 500 assignments can be saved per user. The character editor still has a **Readalong voice** tab. Choose a separate narrator voice so the switch is audible.

With **Lumiverse connection**, unassigned voices inherit Lumiverse’s per-chat overrides, character-card `ttsVoice`, and global narrator voice where the saved connections are available. Readalong assignments take precedence. Turn off **Use Lumiverse’s saved character and narrator voices** to use only Readalong settings. Inherited voices may use different saved TTS connections; Readalong does not modify them. Its speed control applies to the prepared playback; per-voice native speed overrides are not imported.

Without speaker cues, straight, curly, and guillemet double quotes are treated as dialogue from the message’s character, and surrounding prose as narration. Native Lumiverse speech-detection rules are respected when available, including skipped asterisked actions. Otherwise asterisked prose uses the narrator. Multiple characters speaking in the same message need explicit `[speaker:Name]` cues inside the relevant quote; quotation marks alone do not identify which character spoke. A quoted speaker cue ends at the closing quote and resets its emotion/delivery, so surrounding narration cannot inherit the character voice. Repeat the cue for another quote from a different character. Intentional unquoted speech still keeps a speaker cue until the next speaker cue or quoted span ends; use `[speaker:narrator]` to resume narration explicitly in that case.

Speaker cues also pick up a saved character voice when the name matches one character in your library. For speakers without a character card, use **Add cast member → Speaker name in the story** and enter the exact name. A matching `[speaker:Name]` cue will select that assignment before falling back to the message’s main character. With voice prompting enabled, Readalong adds up to 100 assigned speaker names to the existing chat prompt so the model can use matching cues. There is no additional LLM call; these names add a small number of input tokens. A model can still miss or misattribute a cue. In the absence of a speaker assignment, the message's character voice or the default voice is used. If changing speech provider/model, choose compatible voice assignments again.

## Emotion cues

Readalong can add a compact instruction to the chat generation already being made. It asks the model for sparse cues such as:

```text
“[speaker:Mara][emotion:worried][delivery:whispers] Are you sure we should go inside?”
The lantern trembled in her hand.
```

While Readalong is off, no new cue instructions are added. A display-only regex hides these cues from assistant messages. They remain in the original stored text for speech, and normal bracketed prose remains untouched. Emotion and delivery persist within the affected speech until changed; a speaker change or the end of a quote resets them. For Gemini 3.8, native playback receives dialogue with recognized inline vocal tokens intact. **Lumiverse’s current native OpenRouter TTS adapter does not forward per-sentence `speech_metadata`**, so Gemini 3.8 emotion/delivery cues currently have no effect through that connection. They remain hidden and saved for future support. Native Gemini 3.1 uses approved inline audio tags; OpenAI mini-TTS models receive separate style instructions where their native adapter supports them. Other models get clean dialogue with Gemini vocal tokens omitted. Instructions do not guarantee a particular performance.

Supported emotions: neutral, happy, sad, angry, worried, curious, excited, sarcastic, tender, afraid.

Supported delivery directions: normal, whispers, shouts, softly, slowly, laughs, sighs.

You can disable prompting for new cues independently of using existing cues. Voices also have default emotion/delivery options. Audio-tag performance depends on the chosen model and voice; instructions do not guarantee a particular performance.

The owned regex rule is named **Readalong • Hide voice cues**, under the Readalong folder. Disable/remove that display rule if you want tags to become visible again. Existing messages do not need to be rewritten. If the hide-rule permission is unavailable, Readalong reports it and does not inject emotion instructions.

## Preset vocal tags (Threadbare / Gemini 3.8)

Threadbare's optional `tts_tags_on` layer uses Gemini's documented angle-bracket vocal-event format. Keep it enabled when you want momentary sounds and pauses. Readalong passes recognized tokens such as `<gasp>`, `<laugh>`, `<sigh>`, `<heavy breath>`, `<throat-clearing>`, `<short pause>` and `<long pause>` in their original position within dialogue to Gemini 3.8 TTS. It also accepts the documented aliases `<laughter>`, `<chuckles>`, `<sighs>` and `<whispering>`. Standard prose/font wrappers are removed while keeping their words and vocal tokens. The outer `<tts_tags>` instruction block remains non-story metadata and is never spoken if it appears in a message.

These are standalone vocal events, so they never consume the rest of a message as an unclosed XML block. Tokens inside scene cards, image prompts, code or hidden UI blocks remain excluded. Only names on the vocal-event list are recognized, with no attributes; general custom tags remain blocked. Readalong does not change your preset, macros or `tts_tags_on` flag and does not generate new vocal events itself.

The player and estimated sentence marker use the words with vocal tokens removed. Gemini receives the tokens in the normal speech request, without another model/analysis call or one request per sound. Existing voice batching, manual Play, local caching and refresh safeguards still apply. Browser voices and other speech models omit these Gemini-specific tokens while preserving the surrounding dialogue. A standalone vocal-only segment is skipped for unsupported models.

Vocal bursts are distinct from sustained style instructions. Gemini supports the preset's momentary-event format, but the currently inspected Lumiverse OpenRouter adapter still does not forward Readalong's separate emotion/delivery metadata. A preset label does not guarantee the resulting performance; real acoustic output depends on Gemini. Native request contents and mock playback were verified without making a paid provider call. [Google's vocal-event documentation](https://ai.google.dev/gemini-api/docs/speech-generation#vocal-bursts-and-non-speech-sounds).

## What this version does and does not guarantee

- Highlights an estimated sentence within a continuous voice passage. It does not provide word alignment. OpenRouter's speech endpoint does not document alignment timestamps; voice changes follow real audio boundaries.
- Automatically prepares completed replies while on and waits for manual Play. Coalesces same-voice text and joins compatible PCM files. An early start uses one joined opening buffer followed by one joined remaining buffer; with full preparation, compatible PCM remains one file. Other file formats preload the next voice. Stop aborts native synthesis and prevents further requests from being dispatched; direct requests already sent through Spindle’s buffered CORS API cannot be canceled. Providers may still bill for work already started.
- Reads completed messages. Live token-by-token narration is not enabled in this first version.
- Leaves the host's message text nodes and stored message content intact. Uses browser CSS Highlights, with an overlay fallback.
- Re-finds text after message DOM changes. Uses the currently verified Lumiverse message-content anchor; unusual display regex transformations, HTML islands, collapsed/virtualized messages, or complex formatting can prevent an inline match. The player always shows the current spoken sentence as a fallback. It does not automatically open a collapsed message or remount an offscreen virtualized message.
- Skips code, images, entire custom XML/HTML metadata blocks and comment-delimited utility cards. Reads standard HTML prose and link labels and removes common Markdown decoration. Plain untagged metadata cannot be distinguished reliably from story prose; heavy custom rendering may still differ from the spoken source.
- Uses ordinary speech synthesis only. No voice cloning, transcription, forced alignment, or additional analysis service is invoked.

## Permissions

| Permission | Purpose |
|---|---|
| `generation` | Detect completed replies for automatic preparation and identify the speaking character. |
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

Verified against the current Lumiverse source and Spindle types. All 150 parser/provider/session/playback/cache/security/layout tests pass, including Threadbare vocal-tag preservation and exact provider input, font wrappers, multiword/alias tags, marker matching, long token boundaries, unsupported-model stripping, scene/flair/image-prompt exclusion, nested and incomplete metadata, speaker-cue isolation, native Autonoe/Fenrir requests with a character-card title, the prepared-file player, ordered PCM joins, real voice boundaries, exact pause/resume, replay without synthesis, cancellation, on/off request blocking, larger native batches, and a 40-minute recording that exceeds the former decoded-memory budget. Browser checks used mock speech: minimizing during preparation, minimizing/expanding during playback, compact pause/resume, power and hide controls, saved compact mode and dragged position after refresh without new speech requests, and Threadbare vocal events in the outgoing Gemini text with clean player captions, narrator/character voice transitions and no added request count from tags, restored audio after refresh with no added speech requests, safe startup without a cache, missing-cache refresh and off/on without a retry, new-reply automatic preparation, manual playback, duplicate completion suppression, widget Play/Pause and power controls, a 25-minute file larger than the former native response cap, off preventing requests, provider errors, missing widget permission and cleanup. Security tests also cover cross-user key access, safe failed/empty key saves, confirmed deletion, local-address binding and HTTPS rules, arbitrary key redaction, native error sanitization, opt-in defaults, and multiple named cast voices. The backend bundle passes Lumiverse’s static extension scanner. No paid speech requests were made. Real OpenRouter preparation speed still needs verification in your Lumiverse instance with your key.

### Screen-size checks (0.2.1)

Browser tests resized a mock Lumiverse app live through the following CSS-pixel viewports. Both compact and expanded controls remained on screen, their button centers were usable, and mode buttons did not start dragging:

| Layout | Width × height |
|---|---|
| Small phone | 320 × 568 |
| Phone | 360 × 800 |
| Phone | 393 × 852 |
| Large phone | 412 × 915 |
| Landscape phone | 800 × 360 |
| Tablet | 768 × 1024 |
| Small window | 640 × 480 |
| Laptop | 1366 × 768 |
| Desktop | 1920 × 1080 |
| Enlarged UI layout | 240 × 533 |

Additional checks covered actual pointer dragging, saved position after refresh, saved compact/expanded mode, large-screen placement clamped for a phone and restored on return, Play/Pause/Resume, keyboard activation, minimizing/expanding during playback, hide/reopen preserving pause, Open player, Stop, Off/On, cache restoration without synthesis, and cleanup followed by resizing. One synthetic message made three mock synthesis requests; UI actions and refresh made no additional synthesis requests. No paid provider calls were made.

These are browser and mock-host checks, **not physical Android-device certification**. Pointer presses were exercised with browser automation; real finger gestures, Android browser audio policies, background playback and browser/keyboard chrome still require a device test. The host's touch pointer handling was inspected, and coarse-pointer layout selection is covered in the layout tests. The extension also works with mouse input on a small screen.

Native mode uses Lumiverse’s session-authenticated `/api/v1/tts-connections`, `/api/v1/settings/voiceSettings` (read-only voice/detection preferences), and `/api/v1/tts/synthesize` routes, the same routes as its built-in voice player. Gemini on OpenRouter requests `pcm`; Readalong preserves the 16-bit mono samples and adds a WAV header (24 kHz by default, or the response’s rate parameter). Other native providers retain their configured output format. The public OpenRouter catalog supplies complete model-specific voice lists instead of the host’s shorter curated list. Direct OpenRouter mode remains available for MP3 models; it refuses Gemini speech before sending a paid request and directs you to a saved Lumiverse connection. The host’s CORS media guard remains unchanged.

API references: [Spindle documentation](https://docs.lumiverse.chat/), [OpenRouter speech API](https://openrouter.ai/docs/guides/overview/multimodal/tts), [Gemini 3.8 Flash TTS](https://openrouter.ai/google/gemini-3.8-flash-tts/).

### Playback checks (0.2.2)

New tests cover shared pending Play attempts, local retry after a browser block, cancellation during a pending Play, ordered 75%/30-second readiness, missing openings, one-file behavior, two joined early buffers, exact pause/resume, replay, waiting for preparation, paused waiting and stale ended events after Stop. Browser checks with real media elements and synthetic audio verified a blocked first Play followed by successful local retry, two rapid presses with a delayed Play promise, one synthesis batch after a double Prepare click, stable widget button identity through sentence updates, an early start at three of four ready passages, continued preparation while playing, waiting and automatic continuation at the buffer end, minimizing during preparation/playback, missing-cache Load saved without synthesis, and cache restoration. No paid provider request was used. Real speech latency and browser/device playback policies still need testing in the installed app.
