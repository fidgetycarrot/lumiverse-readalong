import { test,expect } from 'bun:test';
import { waveHeader,readWave,pcmBlobToWav,prepareClip,joinPrepared,PreparedPlayer } from '../src/prepared-audio';
const wav=(seconds:number,rate=8000)=>new Blob([waveHeader(seconds*rate*2,rate),new Uint8Array(seconds*rate*2)],{type:'audio/wav'});
const clip=async(seconds:number,rate=8000)=>prepareClip({blob:wav(seconds,rate),mime:'audio/wav'},undefined,()=>{throw new Error('PCM must not create a decoder')});
function fixture(startTimeoutMs=10000){
  const audios:any[]=[],created:Blob[]=[],revoked:string[]=[];
  const factory=()=>{let src='';const a:any={currentTime:0,paused:true,volume:1,playbackRate:1,preload:'',onended:null,onerror:null,playCalls:0,loadCalls:0,async play(){a.paused=false;a.playCalls++},pause(){a.paused=true},removeAttribute(name:string){if(name==='src')src=''},load(){a.loadCalls++},get src(){return src},set src(v:string){src=v;a.currentTime=0}};audios.push(a);return a as HTMLAudioElement};
  const player=new PreparedPlayer(factory,{create:b=>{created.push(b);return `blob:test-${created.length}`},revoke:url=>revoked.push(url)},startTimeoutMs);
  return {player,audios,created,revoked};
}
test('PCM preparation reads headers without invoking an audio decoder',async()=>{
  const c=await clip(10);expect(c.duration).toBe(10);expect(c.wave).toEqual({rate:8000,channels:1,bits:16,offset:44,size:160000});
});
test('PCM voices join in order into one WAV file without inter-clip handoffs',async()=>{
  const a=await prepareClip({blob:await pcmBlobToWav(new Blob([new Uint8Array([1,0,2,0])])),mime:'audio/wav'});
  const b=await prepareClip({blob:await pcmBlobToWav(new Blob([new Uint8Array([3,0,4,0])])),mime:'audio/wav'});
  const joined=joinPrepared([a,b]);expect(joined).toHaveLength(1);
  expect(new Uint8Array(await joined[0].blob.slice(44).arrayBuffer())).toEqual(new Uint8Array([1,0,2,0,3,0,4,0]));
});
test('long recordings exceeding the former decoded-memory cap prepare as compact audio files',async()=>{
  const minute=new Blob([new Uint8Array(24000*2*60)]);
  const blob=new Blob([waveHeader(minute.size*40),...Array(40).fill(minute)],{type:'audio/wav'});
  const prepared=await prepareClip({blob,mime:'audio/wav'},undefined,()=>{throw new Error('No full-message decode')});
  expect(prepared.duration).toBe(2400);expect(prepared.duration*48000*4).toBeGreaterThan(256*1024*1024);
  const {player,audios,created}=fixture();player.load([prepared]);expect(player.duration).toBe(2400);expect(created[0].size).toBe(blob.size);expect(audios).toHaveLength(1);
  await player.play();expect(audios[0].playCalls).toBe(1);player.clear();
});
test('one prepared PCM file preserves real passage boundaries and exact pause/resume',async()=>{
  const {player,audios}=fixture();player.load([await clip(10),await clip(20)]);await player.play();audios[0].currentTime=14;
  expect(player.position).toMatchObject({index:1,seconds:4,elapsed:14,duration:30});player.pause();expect(audios[0].paused).toBe(true);
  await player.play();expect(audios[0].currentTime).toBe(14);expect(audios).toHaveLength(1);
  player.setSpeed(1.5);player.setVolume(.3);expect(audios[0].playbackRate).toBe(1.5);expect(audios[0].volume).toBe(.3);
});
test('replay uses the prepared file and clear releases its object URL',async()=>{
  const {player,audios,created,revoked}=fixture();let ended=0;player.onEnded=()=>ended++;
  player.load([await clip(10)]);await player.play();audios[0].onended();expect(ended).toBe(1);expect(player.elapsed).toBe(10);
  await player.play();expect(audios[0].currentTime).toBe(0);expect(created).toHaveLength(1);
  const stale=audios[0].onended;player.clear();stale();expect(ended).toBe(1);expect(revoked).toEqual(['blob:test-1']);expect(player.duration).toBe(0);
});
test('a delayed play promise cannot restart a stopped session',async()=>{
  const {player,audios}=fixture();player.load([await clip(10)]);let resolve!:()=>void;
  audios[0].play=()=>new Promise<void>(r=>resolve=r);const pending=player.play();player.clear();resolve();expect(await pending).toBe(false);
});
test('overlapping Play presses share one local media attempt',async()=>{
  const {player,audios}=fixture();player.load([await clip(10)]);let resolve!:()=>void,calls=0;
  audios[0].play=()=>{calls++;return new Promise<void>(r=>resolve=r)};
  const first=player.play(),second=player.play();expect(first).toBe(second);expect(calls).toBe(1);
  resolve();expect(await first).toBe(true);expect(await second).toBe(true);
});
test('a blocked first Play can be retried using exactly the same prepared file',async()=>{
  const {player,audios,created}=fixture();player.load([await clip(10)]);const file=audios[0].src;
  audios[0].play=async()=>{throw new DOMException('Gesture needed','NotAllowedError')};
  await expect(player.play()).rejects.toThrow('no speech is requested');
  audios[0].play=async()=>{audios[0].paused=false};expect(await player.play()).toBe(true);
  expect(audios[0].src).toBe(file);expect(created).toHaveLength(1);
});
test('Pause cancels a pending Play attempt before it can report a started session',async()=>{
  const {player,audios}=fixture();player.load([await clip(10)]);let resolve!:()=>void;
  audios[0].play=()=>new Promise<void>(r=>resolve=r);const pending=player.play();player.pause();resolve();
  expect(await pending).toBe(false);expect(audios[0].paused).toBe(true);expect(player.hasStarted).toBe(false);
});
test('a media start that never settles times out and can retry the same file locally',async()=>{
  const {player,audios,created,revoked}=fixture(15);player.load([await clip(10)]);const source=audios[0].src;
  audios[0].play=()=>new Promise<void>(()=>{});
  await expect(player.play()).rejects.toThrow('taking too long');
  expect(audios[0].paused).toBe(true);expect(player.hasStarted).toBe(false);
  expect(await player.play()).toBe(true);expect(audios).toHaveLength(2);
  expect(audios[1].src).toBe(source);expect(created).toHaveLength(1);expect(revoked).toHaveLength(0);
  player.clear();
});
test('a real playing event unlocks controls even if the start promise remains pending',async()=>{
  const {player,audios}=fixture(15);player.load([await clip(10)]);
  audios[0].play=()=>new Promise<void>(()=>{});const pending=player.play();audios[0].paused=false;audios[0].onplaying();
  expect(await pending).toBe(true);expect(player.hasStarted).toBe(true);player.pause();expect(audios[0].paused).toBe(true);
});
test('a media error releases a pending start and retains the recording and resume position',async()=>{
  const {player,audios,created}=fixture();player.load([await clip(10)]);await player.play();audios[0].currentTime=4;player.pause();
  audios[0].play=()=>new Promise<void>(()=>{});const pending=player.play();audios[0].onerror();
  await expect(pending).rejects.toThrow('prepared audio');expect(await player.play()).toBe(true);
  expect(player.elapsed).toBe(4);expect(created).toHaveLength(1);expect(audios).toHaveLength(2);player.clear();
});
test('Stop settles a never-ending start immediately rather than leaving stale controls busy',async()=>{
  const {player,audios}=fixture();player.load([await clip(10)]);audios[0].play=()=>new Promise<void>(()=>{});
  const pending=player.play();player.clear();
  expect(await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('still pending'),30))])).toBe(false);
});
test('early playback appends one joined remaining buffer and preserves clock, pause and replay',async()=>{
  const {player,audios,created}=fixture();const clips=[await clip(20),await clip(20),await clip(10),await clip(10)];
  player.begin(clips.slice(0,2));await player.play();audios[0].currentTime=15;player.pause();
  player.append(clips.slice(2));expect(audios[0].paused).toBe(true);expect(player.elapsed).toBe(15);expect(player.duration).toBe(60);
  expect(created).toHaveLength(2);expect(audios).toHaveLength(2);
  await player.play();audios[0].currentTime=40;audios[0].onended();await Promise.resolve();
  expect(player.position).toMatchObject({index:2,elapsed:40,duration:60});
  audios[1].currentTime=20;audios[1].onended();expect(player.elapsed).toBe(60);
  await player.play();expect(player.elapsed).toBe(0);expect(created).toHaveLength(2);player.clear();
});
test('catching up to preparation waits without replaying or declaring the story finished',async()=>{
  const {player,audios}=fixture();let ended=0;const waiting:boolean[]=[];
  player.onEnded=()=>ended++;player.onWaiting=value=>waiting.push(value);
  player.begin([await clip(30)]);await player.play();audios[0].currentTime=30;audios[0].onended();
  expect(ended).toBe(0);expect(waiting).toEqual([true]);
  player.append([await clip(10)]);await Promise.resolve();expect(waiting).toEqual([true,false]);
  expect(player.elapsed).toBe(30);expect(audios[1].playCalls).toBe(1);
  audios[1].currentTime=10;audios[1].onended();expect(ended).toBe(1);expect(player.elapsed).toBe(40);
});
test('pausing while waiting prevents remaining audio from starting until Resume',async()=>{
  const {player,audios}=fixture();player.begin([await clip(30)]);await player.play();audios[0].currentTime=30;audios[0].onended();player.pause();
  player.append([await clip(10)]);expect(audios[1]?.playCalls??0).toBe(0);
  await player.play();expect(player.elapsed).toBe(30);expect(audios[1].playCalls).toBe(1);
});
test('Stop during early playback discards the buffer and never advances a stale end event',async()=>{
  const {player,audios,revoked}=fixture();player.begin([await clip(30)]);await player.play();const stale=audios[0].onended;
  player.clear();stale();expect(player.duration).toBe(0);expect(revoked).toHaveLength(1);expect(audios).toHaveLength(1);
});
test('completion during a pending early Play preserves the original media source and time',async()=>{
  const {player,audios}=fixture();player.begin([await clip(30)]);const source=audios[0].src;let resolve!:()=>void;
  audios[0].play=()=>new Promise<void>(r=>resolve=r);const pending=player.play();audios[0].currentTime=2;
  player.append([await clip(10)]);resolve();expect(await pending).toBe(true);
  expect(audios[0].src).toBe(source);expect(player.elapsed).toBe(2);expect(player.duration).toBe(40);
});
test('a stale opening-buffer ended callback cannot prematurely finish the remaining buffer',async()=>{
  const {player,audios}=fixture();let ended=0;player.onEnded=()=>ended++;
  player.begin([await clip(30)]);player.append([await clip(10)]);await player.play();const firstEnded=audios[0].onended;
  firstEnded();await Promise.resolve();firstEnded();expect(ended).toBe(0);
  audios[1].onended();expect(ended).toBe(1);
});
test('mixed audio files preload the next voice and do not reload it at the boundary',async()=>{
  const {player,audios}=fixture();player.load([await clip(10,8000),await clip(20,16000)]);expect(audios).toHaveLength(2);
  const next=audios[1];await player.play();audios[0].onended();await Promise.resolve();
  expect(next.playCalls).toBe(1);expect(next.loadCalls).toBe(0);expect(player.position.index).toBe(1);player.clear();
});
test('canceled and malformed PCM preparations cannot become playable',async()=>{
  const aborted=new AbortController();aborted.abort();await expect(prepareClip({blob:wav(1),mime:'audio/wav'},aborted.signal)).rejects.toThrow();
  await expect(pcmBlobToWav(new Blob([new Uint8Array(3)]))).rejects.toThrow('incomplete');
  await expect(pcmBlobToWav(new Blob([new Uint8Array(2)]),'audio/pcm;rate=wrong')).rejects.toThrow('unsupported');
  await expect(readWave(new Blob([waveHeader(16000),new Uint8Array(10)]))).rejects.toThrow('incomplete');
});
