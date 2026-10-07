import { test,expect } from 'bun:test';
import { waveHeader,readWave,pcmBlobToWav,prepareClip,joinPrepared,PreparedPlayer } from '../src/prepared-audio';
const wav=(seconds:number,rate=8000)=>new Blob([waveHeader(seconds*rate*2,rate),new Uint8Array(seconds*rate*2)],{type:'audio/wav'});
const clip=async(seconds:number,rate=8000)=>prepareClip({blob:wav(seconds,rate),mime:'audio/wav'},undefined,()=>{throw new Error('PCM must not create a decoder')});
function fixture(){
  const audios:any[]=[],created:Blob[]=[],revoked:string[]=[];
  const factory=()=>{let src='';const a:any={currentTime:0,paused:true,volume:1,playbackRate:1,preload:'',onended:null,onerror:null,playCalls:0,loadCalls:0,async play(){a.paused=false;a.playCalls++},pause(){a.paused=true},removeAttribute(name:string){if(name==='src')src=''},load(){a.loadCalls++},get src(){return src},set src(v:string){src=v;a.currentTime=0}};audios.push(a);return a as HTMLAudioElement};
  const player=new PreparedPlayer(factory,{create:b=>{created.push(b);return `blob:test-${created.length}`},revoke:url=>revoked.push(url)});
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
