import { test,expect } from 'bun:test';
import { BufferedPlayer } from '../src/playback';
function fixture() {
  const sources:any[]=[];
  const context={currentTime:10,state:'running',sampleRate:24000,destination:{},createGain:()=>({gain:{value:1},connect(){}}),createBuffer:()=>({duration:0}),decodeAudioData:async()=>buffer(2),createBufferSource:()=>{const node={buffer:null,playbackRate:{value:1},onended:null as (()=>void)|null,connect(){},disconnect(){},startAt:0,offset:0,stopped:false,start(when=0,offset=0){this.startAt=when;this.offset=offset},stop(){this.stopped=true}};sources.push(node);return node},resume:async()=>{},close:async()=>{context.state='closed'}};
  const player=new BufferedPlayer(()=>context as unknown as AudioContext);
  return {player,context,sources};
}
function buffer(duration:number){return {duration,length:duration*24000,numberOfChannels:1} as AudioBuffer}
test('the full audio queue schedules gapless voice changes against one audio clock',async()=>{
  const {player,context,sources}=fixture();player.load([buffer(10),buffer(20),buffer(5)]);
  expect(sources).toHaveLength(0);await player.play();
  expect(sources.map(s=>s.startAt)).toEqual([10.025,20.025,40.025]);
  context.currentTime=20.025;expect(player.position.index).toBe(1);expect(player.position.seconds).toBeCloseTo(0);
  expect(player.duration).toBe(35);
});
test('pause preserves the exact audio offset and resume does not regenerate or restart the passage',async()=>{
  const {player,context,sources}=fixture();player.load([buffer(10),buffer(20)]);await player.play();
  context.currentTime=14.025;player.pause();context.currentTime=24.025;
  expect(player.elapsed).toBeCloseTo(4);expect(sources.every(s=>s.stopped)).toBe(true);
  await player.play();expect(sources[2].offset).toBeCloseTo(4);expect(sources[3].startAt-sources[2].startAt).toBeCloseTo(6);
});
test('speed changes reschedule all later boundaries without gaps or overlap',async()=>{
  const {player,context,sources}=fixture();player.load([buffer(10),buffer(20)]);await player.play();context.currentTime=12.025;
  player.setSpeed(2);expect(player.elapsed).toBeCloseTo(2);
  expect(sources[2].offset).toBeCloseTo(2);expect(sources[3].startAt-sources[2].startAt).toBeCloseTo(4);
  expect(sources.slice(2).every(s=>s.playbackRate.value===2)).toBe(true);
});
test('stop ignores late completion callbacks and releases cached buffers',async()=>{
  const {player,sources}=fixture();let ended=0;player.onEnded=()=>ended++;player.load([buffer(10)]);await player.play();const callback=sources[0].onended!;
  player.clear();callback();expect(ended).toBe(0);expect(player.duration).toBe(0);
});
test('replay reuses the same prepared buffers',async()=>{
  const {player,sources}=fixture();let ended=0;player.onEnded=()=>ended++;const prepared=buffer(10);player.load([prepared]);await player.play();sources[0].onended!();
  expect(ended).toBe(1);await player.play();expect(sources[1].buffer).toBe(prepared);expect(sources[1].offset).toBe(0);
});
test('a stopped session cannot start when a delayed audio unlock resolves',async()=>{
  const {player,context,sources}=fixture();let resume!:()=>void;context.resume=()=>new Promise<void>(r=>resume=r);
  player.load([buffer(10)]);const pending=player.play();player.clear();resume();expect(await pending).toBe(false);expect(sources).toHaveLength(0);
});
test('decode failures are reported before Play can become ready',async()=>{
  const {player,context}=fixture();context.decodeAudioData=async()=>{throw new Error('Invalid')};
  await expect(player.decode({bytes:new Uint8Array([1,2,3]),mime:'audio/wav'})).rejects.toThrow('cannot play');
});
