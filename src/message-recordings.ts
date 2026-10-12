/**
 * Finished readings saved onto the message in Lumiverse (an audio attachment),
 * so another device can play them without paying again. Idea from Chat Voice
 * (WanderingMonk8/custom_voice). This store remembers which attachment holds
 * which reading, and how to split it back into its parts.
 */
export interface MessageRecording {
  messageKey: string; key: string;
  audioId: string; chatId: string; messageId: string; swipeId?: number;
  /** Byte size of each part's sound data inside the joined WAV, in order. */
  sizes: number[]; wave: { rate: number; channels: number; bits: number };
  plan: unknown; savedAt: number;
}
export interface RecordingStorage { read(userId: string): Promise<string | undefined>; write(userId: string, value: string): Promise<void> }
export const DEFAULT_KEEP = 30, MAX_KEEP = 200;
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9_-]{1,100}$/;

/** A record from the frontend or from storage, or undefined if anything is off. */
export function readMessageRecording(raw: unknown): MessageRecording | undefined {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as Record<string, any>;
  if (!HASH.test(r.messageKey) || !HASH.test(r.key) || !ID.test(r.audioId) || !ID.test(r.chatId) || !ID.test(r.messageId)) return;
  if (r.swipeId !== undefined && !(Number.isInteger(r.swipeId) && r.swipeId >= 0)) return;
  if (!Array.isArray(r.sizes) || !r.sizes.length || r.sizes.length > 2000 || r.sizes.some((n: unknown) => !Number.isInteger(n) || (n as number) <= 0)) return;
  const w = r.wave;
  if (!w || ![8, 16, 24, 32].includes(w.bits) || !Number.isInteger(w.rate) || w.rate < 8000 || w.rate > 192000 || !Number.isInteger(w.channels) || w.channels < 1 || w.channels > 8) return;
  if (r.sizes.some((n: number) => n % (w.channels * w.bits / 8))) return;
  if (!r.plan || typeof r.plan !== 'object' || JSON.stringify(r.plan).length > 2_000_000) return;
  return { messageKey: r.messageKey, key: r.key, audioId: r.audioId, chatId: r.chatId, messageId: r.messageId, ...(r.swipeId !== undefined ? { swipeId: r.swipeId } : {}),
    sizes: r.sizes, wave: { rate: w.rate, channels: w.channels, bits: w.bits }, plan: r.plan, savedAt: typeof r.savedAt === 'number' ? r.savedAt : Date.now() };
}

export class RecordingStore {
  private chains = new Map<string, Promise<unknown>>();
  constructor(private storage: RecordingStorage) {}
  private async all(userId: string): Promise<Record<string, MessageRecording>> {
    const raw = await this.storage.read(userId);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw), result: Record<string, MessageRecording> = {};
      for (const value of Object.values(parsed ?? {})) { const record = readMessageRecording(value); if (record) result[record.messageKey] = record }
      return result;
    } catch { return {} }
  }
  private edit<T>(userId: string, change: (records: Record<string, MessageRecording>) => T): Promise<T> {
    const work = (this.chains.get(userId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const records = await this.all(userId), result = change(records);
      await this.storage.write(userId, JSON.stringify(records));
      return result;
    });
    this.chains.set(userId, work);
    return work.finally(() => { if (this.chains.get(userId) === work) this.chains.delete(userId) }) as Promise<T>;
  }
  async get(userId: string, messageKey: string) { return (await this.all(userId))[messageKey] }
  /** Remember a saved reading. Returns older ones over the limit, for their attachments to be removed. */
  remember(userId: string, record: MessageRecording, keep = DEFAULT_KEEP): Promise<MessageRecording[]> {
    return this.edit(userId, records => {
      const prior = records[record.messageKey];
      records[record.messageKey] = { ...record, savedAt: Date.now() };
      const replaced = prior && prior.audioId !== record.audioId ? [prior] : [];
      const newest = Object.values(records).sort((a, b) => b.savedAt - a.savedAt);
      const expired = newest.slice(Math.max(1, Math.min(MAX_KEEP, keep)));
      for (const old of expired) delete records[old.messageKey];
      return [...replaced, ...expired];
    });
  }
  forget(userId: string, messageKey: string) { return this.edit(userId, records => { delete records[messageKey] }) }
}

/** Split a downloaded joined WAV back into the parts it was made from. */
export function splitRecording(blob: Blob, record: Pick<MessageRecording, 'sizes' | 'wave'>) {
  const total = record.sizes.reduce((sum, n) => sum + n, 0);
  if (blob.size !== 44 + total) return;
  const bytesPerSecond = record.wave.rate * record.wave.channels * record.wave.bits / 8;
  let offset = 44;
  return record.sizes.map(size => {
    const clip = { blob, duration: size / bytesPerSecond, wave: { ...record.wave, offset, size } };
    offset += size;
    return clip;
  });
}
