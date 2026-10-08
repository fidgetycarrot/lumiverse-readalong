# Readalong security and privacy notes

Review date: 2026-10-08. Applies to Readalong **0.2.0–0.2.3**. The 0.2.3 update recovers missed completion notifications and preserves the reviewed playback and credential protections. This is a source review and automated/mock verification, not an independent security certification or a guarantee against every possible compromise.

## Where credentials go

The recommended **Lumiverse connection** mode uses the host's authenticated, same-origin TTS API. Readalong sends a connection ID, text, model and voice. It does not retrieve, replace or delete that connection's API key. The inspected Lumiverse host keeps native keys encrypted on the server; it sends them to the provider configured in the saved connection. The extension projects connection responses to non-credential fields only and does not display raw native provider error prose.

In direct OpenRouter/local modes, a key you paste travels through Lumiverse's authenticated extension messaging to its encrypted enclave. It is not stored in Readalong settings, localStorage, audio caches, chat messages, source bundles or outgoing UI replies. The input clears after a successful save and never prefills with the stored key. Ordinary users need a secure HTTPS connection to a remote Lumiverse server; a local desktop/loopback installation uses the host's local transport.

Direct OpenRouter credentials are sent only to the fixed `https://openrouter.ai/api/v1` endpoint. A direct local-provider credential is stored together with its exact normalized API base URL in one encrypted record. Changing host, port or path blocks use of that key until a key is explicitly saved for the new address. URLs cannot contain embedded credentials, query parameters or fragments. Remote keyed endpoints require HTTPS; HTTP is allowed only for loopback names/addresses. A legacy local key is preserved but requires explicit re-entry to bind it to a server.

The inspected host CORS proxy strips authorization on redirects to a different origin. This depends on Lumiverse's implementation; use a current host and a speech endpoint you trust. The server you authorize necessarily receives your key. A malicious provider, compromised host, administrator, malicious extension or same-origin script, stolen session, browser inspection, or loss of the host's encryption key falls outside an extension's protection.

## User separation and key retention

Readalong uses the authenticated user ID supplied by Spindle for enclave reads/writes, settings, character access and preparation history. It ignores a user ID supplied in a frontend payload. Before reading chat messages it verifies chat ownership for that user, including in operator installations. Lumiverse namespaces enclave values by extension and user.

Normal startup, refresh, updates, on/off changes and provider/model changes do not delete keys. An empty key save is rejected; a replacement uses one enclave write and does not delete the old key first. Mock tests verify that a failed write leaves the previous key usable. Removing a direct key requires the explicit **Remove saved key** confirmation, and affects only that user's Readalong key. Uninstalling, deleting host data/accounts, losing credentials/encryption material or a host/storage failure may still make credentials unavailable. Back up Lumiverse according to its own guidance; an extension cannot guarantee recovery from host data loss.

Direct errors redact the known credential and common encoded/escaped forms before reaching the UI. Enclave failures return a fixed message. Native errors are mapped to fixed guidance rather than echoing unknown host credentials. Diagnostic speech repeats occur only after a user's explicit click, are scoped to the requesting user/tab and expire after ten minutes. Diagnostics can be billed if synthesis succeeds.

## Story and audio privacy

Cloud or remote synthesis sends the selected passage to the chosen speech provider, together with voice/model choices and any supported vocal cues. Provider retention and billing policies apply. There is no analytics service, voice cloning, additional emotion-analysis model or telemetry endpoint. The public OpenRouter catalog may be fetched to list models/voices. Optional cue prompting adds instructions and assigned speaker names to the existing chat generation.

Completed audio is cached in this browser profile, scoped by authenticated user ID, for up to three recent recordings and 256 MiB per user. It can contain private story content. This cache is ordinary browser storage, **not an encrypted vault** or a defense against someone who controls that browser profile, developer tools, or the same origin. It is not exported with the extension, synced by Readalong or placed in chat messages. Extension settings and the server's attempt history stay in per-user Lumiverse storage.

Fresh installs start **off**. Turn on explicitly to prepare the latest unattempted reply and future replies. Speech preparation can be charged before Play, and accepted provider work can still be billed after Off/Stop. Refresh and chat switching restore matching cached audio without initiating speech; missing audio waits for a manual choice. Play/Resume/Replay and Load saved cannot initiate speech. Starting before full preparation uses the same requests; only complete recordings are cached. Failed local playback retries reuse existing audio. Rapid Play/Prepare presses in one player are guarded, but explicit later Prepare retries can still be billed. While on, local completion checks can recover a reply completed during the current enabled session. These checks make no provider requests themselves. The server holds only completion metadata (IDs, time and speaker reference) in memory, scoped to the authenticated event owner, with a 24-hour lifetime and 1,000-entry limit. Refresh, chat switching and Off/On reset the recovery window; completion metadata does not authorize historical catch-up or a retry. The server remembers recent preparation attempts to suppress automatic duplicate requests. The history is bounded to 2,000 attempts, and cannot provide a perpetual, cross-device billing guarantee. Disable built-in automatic TTS if you do not want both players preparing the same reply.

## Review evidence and limits

- Reviewed frontend/backend credential flows, authenticated user scoping, native request targets, error handling, persistence, packaging and permission use.
- Compared host behavior with the locally inspected Lumiverse source at commit `7398fa5f4fc73eaee1aaa767804312765e84ea79` and Spindle types `0.6.39`. Host behavior can change independently of this extension.
- Automated tests cover forged-user payloads, other-user credential isolation, blank/failed replacement saves, confirmed removal, URL binding, remote HTTPS, retained legacy credentials, arbitrary secret formats in errors, native error sanitization, initial opt-in and multiple cast voices. Browser checks use synthetic passages, fake credentials and mock speech only.
- Scanned 77 distinct historical repository blobs through 0.1.9, plus the 0.2.0, 0.2.1, 0.2.2 and 0.2.3 release files, for common OpenRouter/OpenAI/Google key and private-key patterns. No credential matches were found. Pattern scanning cannot identify every possible secret format; test fixtures contain deliberately fake keys.
- The distributable contains source, tests, documentation, manifest and prebuilt bundles only. It excludes local settings, keys, audio caches, host databases, test harness data, `.env` files and dependency directories. Builds have no third-party runtime dependency.

No real user credential or paid provider request was used for this review. Acoustic quality and real-provider performance remain separate from these checks. A reasonable release label is **public beta**, with these limits visible to testers.

## Reporting a security concern

Do not put API keys, authorization headers, private chat excerpts, or unredacted logs in public issues or Discord. Share the extension/host versions and a sanitized description first. Revoke a suspected exposed key through its provider. Repository security reports can use GitHub's private reporting option if the owner has enabled it; otherwise contact the maintainer privately before publishing sensitive details.
