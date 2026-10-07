const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export function pcmToWav(pcm: Uint8Array, contentType = 'audio/pcm'): Uint8Array {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  // Some providers already return a WAV despite the requested PCM format.
  if (pcm.length >= 44 && new TextDecoder().decode(pcm.subarray(0,4)) === 'RIFF' && new TextDecoder().decode(pcm.subarray(8,12)) === 'WAVE') return pcm;
  if (!['audio/pcm','audio/x-pcm'].includes(mime)) throw new Error('OpenRouter returned an unsupported audio format. Expected Gemini PCM audio.');
  const parameter = (name:string, fallback:number) => {
    const match = contentType.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*"?([^;"\\s]+)`, 'i'));
    return match ? Number(match[1]) : fallback;
  };
  // OpenRouter Gemini PCM is signed 16-bit little-endian, 24 kHz mono.
  const rate = parameter('rate',24000), channels = parameter('channels',1);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || channels !== 1) throw new Error('OpenRouter returned unsupported PCM sample settings.');
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_AUDIO_BYTES) throw new Error('OpenRouter returned empty, incomplete, or oversized PCM audio.');
  const wav = new Uint8Array(pcm.length + 44), view = new DataView(wav.buffer);
  const text = (offset:number, value:string) => { for(let i=0;i<value.length;i++) wav[offset+i]=value.charCodeAt(i) };
  text(0,'RIFF');view.setUint32(4,pcm.length+36,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,pcm.length,true);wav.set(pcm,44);
  return wav;
}
