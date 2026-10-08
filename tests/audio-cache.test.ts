import {describe,test,expect} from 'bun:test';
import {IDBFactory} from 'fake-indexeddb';
import {AudioCache,preparationHash} from '../src/audio-cache';
import {pcmBlobToWav,prepareClip} from '../src/prepared-audio';

async function clip(sample=1){const pcm=new Uint8Array(480);new DataView(pcm.buffer).setInt16(0,sample,true);return prepareClip({blob:await pcmBlobToWav(new Blob([pcm])),mime:'audio/wav'})}
describe('persistent prepared audio',()=>{
  test('a fresh player session restores identical PCM, duration and voice-boundary metadata',async()=>{
    const factory=new IDBFactory(),first=new AudioCache(factory,'refresh');
    const clips=[await clip(123),await clip(456)];
    expect(await first.put('one','message',clips)).toBe(true);
    const restored=await new AudioCache(factory,'refresh').get('one','message');
    expect(restored).toHaveLength(2);expect(restored!.map(c=>c.duration)).toEqual(clips.map(c=>c.duration));
    for(let i=0;i<2;i++){expect(restored![i].wave).toEqual(clips[i].wave);expect(await restored![i].blob.arrayBuffer()).toEqual(await clips[i].blob.arrayBuffer())}
  });
  test('cached audio is scoped to the authenticated user',async()=>{
    const cache=new AudioCache(new IDBFactory(),'users');
    await cache.put('one','same-message',[await clip()]);
    expect(await cache.get('two','same-message')).toBeUndefined();
    expect(await cache.get('one','same-message')).toHaveLength(1);
  });
  test('bounded eviction retains latest audio and cannot expose another user’s clips',async()=>{
    const cache=new AudioCache(new IDBFactory(),'eviction',1100,2),audio=await clip();
    await cache.put('two','other-user',[audio]);
    await cache.put('one','first',[audio]);await cache.put('one','second',[audio]);await cache.put('one','third',[audio]);
    expect(await cache.get('one','first')).toBeUndefined();expect(await cache.get('one','second')).toHaveLength(1);expect(await cache.get('one','third')).toHaveLength(1);
    expect(await cache.get('two','other-user')).toHaveLength(1);
  });
  test('storage limits affect saving, not preparation or playback',async()=>{
    const cache=new AudioCache(new IDBFactory(),'too-large',100),audio=await clip();
    expect(await cache.put('one','long',[audio])).toBe(false);expect(audio.blob.size).toBe(524);
    expect(await cache.get('one','long')).toBeUndefined();
  });
  test('missing audio and disabled browser storage do not synthesize anything',async()=>{
    expect(await new AudioCache(new IDBFactory(),'empty').get('one','missing')).toBeUndefined();
    const cache=new AudioCache(undefined);expect(cache.get('one','missing')).rejects.toThrow('unavailable');
  });
  test('content or voice changes have separate audio identities',async()=>{
    const a=await preparationHash(['chat','message','Hello.','Kore']);
    expect(a).toMatch(/^[a-f0-9]{64}$/);expect(a).toBe(await preparationHash(['chat','message','Hello.','Kore']));
    expect(a).not.toBe(await preparationHash(['chat','message','Hello.','Puck']));expect(a).not.toBe(await preparationHash(['chat','message','Changed.','Kore']));
  });
  test('eight paid parts survive refresh and the missing ninth fills the same recording',async()=>{
    const factory=new IDBFactory(),cache=new AudioCache(factory,'partial-refresh');
    const paid=await Promise.all(Array.from({length:8},(_,i)=>clip(i+1))),parts=[...paid,undefined];
    expect(await cache.putPartial('one','nine-parts',parts)).toBe(true);
    const fresh=new AudioCache(factory,'partial-refresh'),restored=await fresh.getPartial('one','nine-parts',9);
    expect(restored).toHaveLength(9);expect(restored!.filter(Boolean)).toHaveLength(8);
    expect(await fresh.get('one','nine-parts')).toBeUndefined();
    const last=await clip(9);expect(await fresh.putPartial('one','nine-parts',[...Array(8),last])).toBe(true);
    const complete=await fresh.get('one','nine-parts');expect(complete).toHaveLength(9);
    for(let i=0;i<8;i++)expect(await complete![i].blob.arrayBuffer()).toEqual(await paid[i].blob.arrayBuffer());
    expect(await complete![8].blob.arrayBuffer()).toEqual(await last.blob.arrayBuffer());
  });
  test('concurrent checkpoints merge successes even when their snapshots omit other paid slots',async()=>{
    const cache=new AudioCache(new IDBFactory(),'partial-concurrent'),audio=await clip();
    expect(await Promise.all([
      cache.putPartial('one','same',[audio,undefined,undefined]),
      cache.putPartial('one','same',[undefined,audio,undefined]),
      cache.putPartial('one','same',[undefined,undefined,audio]),
    ])).toEqual([true,true,true]);
    expect(await cache.get('one','same')).toHaveLength(3);
  });
  test('partial recordings require the same owner, content identity and expected part count',async()=>{
    const cache=new AudioCache(new IDBFactory(),'partial-identities');
    await cache.putPartial('one','original',[await clip(),undefined]);
    expect(await cache.getPartial('two','original',2)).toBeUndefined();
    expect(await cache.getPartial('one','changed-voice',2)).toBeUndefined();
    expect(await cache.getPartial('one','original',3)).toBeUndefined();
    expect(await cache.getPartial('one','original',2)).toHaveLength(2);
  });
  test('a failed or oversized checkpoint cannot erase the parts already saved',async()=>{
    const cache=new AudioCache(new IDBFactory(),'partial-size',600),audio=await clip(7);
    await cache.putPartial('one','same',[audio,undefined]);
    expect(await cache.putPartial('one','same',[undefined,audio])).toBe(false);
    expect(await cache.putPartial('one','same',[undefined,undefined])).toBe(false);
    const restored=await cache.getPartial('one','same',2);expect(restored!.filter(Boolean)).toHaveLength(1);
    expect(await restored![0]!.blob.arrayBuffer()).toEqual(await audio.blob.arrayBuffer());
    expect(restored![1]).toBeUndefined();
  });
});
