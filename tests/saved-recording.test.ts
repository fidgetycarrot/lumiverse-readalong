import {test,expect} from 'bun:test';
import {IDBFactory} from 'fake-indexeddb';
import {AudioCache,preparationHash} from '../src/audio-cache';
import {recordingPlan,readRecordingPlan} from '../src/saved-recording';
import {nativeSpeechRequest} from '../src/native-tts';
import {DEFAULTS,normalizeSettings} from '../src/shared';
import {pcmBlobToWav,prepareClip} from '../src/prepared-audio';
import type {SpeechPassage} from '../src/playback-plan';

const messageKey='a'.repeat(64);
const connection={id:'saved',name:'Saved',provider:'openrouter_tts',model:DEFAULTS.model,voice:'Fenrir',supportsSpeechStyle:true,speechStyle:'relaxed'};
const settings=normalizeSettings({...DEFAULTS,provider:'lumiverse',connectionId:connection.id,voice:'Fenrir'});
const passage=(text='One. Two.',emotion='neutral'):SpeechPassage=>({segment:{text,speaker:'Elys',emotion,delivery:'normal'},segments:[{text,speaker:'Elys',emotion,delivery:'normal'}],settings,voice:'Fenrir'});
const clip=async(n=1)=>prepareClip({blob:await pcmBlobToWav(new Blob([new Uint8Array([n,0,n,0])])),mime:'audio/wav'});

test('style changes and new part counts restore the existing take after a fresh session',async()=>{
  const factory=new IDBFactory(),cache=new AudioCache(factory,'style-change'),plan=recordingPlan([passage()],[connection]),audio=await clip(12);
  const key=await preparationHash([messageKey,[nativeSpeechRequest(connection,settings,passage().segment)]]);
  await cache.putPartial('one',key,[audio],{messageKey,plan});
  const changed={...connection,speechStyle:'dramatic'},changedPassages=[passage('One.','angry'),passage('Two.','tender')];
  const wanted=await preparationHash([messageKey,changedPassages.map(p=>nativeSpeechRequest(changed,p.settings,p.segment))]);
  expect(wanted).not.toBe(key);expect(await cache.getPartial('one',wanted,2)).toBeUndefined();
  const existing=await new AudioCache(factory,'style-change').getRecording('one',messageKey);
  expect(existing?.key).toBe(key);expect(existing?.plan.passages).toHaveLength(1);expect(existing?.plan.connections[0].speechStyle).toBe('relaxed');
  expect(await existing!.clips[0]!.blob.arrayBuffer()).toEqual(await audio.blob.arrayBuffer());
});
test('partial audio retains its original style for an explicit missing-part retry',async()=>{
  const cache=new AudioCache(new IDBFactory(),'frozen-partial'),plan=recordingPlan([passage('One.','tender'),passage('Two.','tender')],[connection]);
  await cache.putPartial('one','original',[await clip(),undefined],{messageKey,plan});
  connection.speechStyle='later setting';
  try{
    const existing=(await cache.getRecording('one',messageKey))!;
    expect(existing.clips.filter(Boolean)).toHaveLength(1);
    const missing=existing.plan.passages[1];
    expect(nativeSpeechRequest(existing.plan.connections[0],missing.settings,missing.segment).parameters.speech_style).toBe('relaxed\nFor this passage, speak warm and tender.');
  }finally{connection.speechStyle='relaxed'}
});
test('a failed replacement cannot hide a completed take, and a completed update becomes the default',async()=>{
  const cache=new AudioCache(new IDBFactory(),'replacement'),old=recordingPlan([passage()],[connection]);
  await cache.putPartial('one','original',[await clip(1)],{messageKey,plan:old});
  const updated=recordingPlan([passage('One.','angry'),passage('Two.','angry')],[{...connection,speechStyle:'dramatic'}]);
  await cache.putPartial('one','replacement',[await clip(2),undefined],{messageKey,plan:updated});
  expect((await cache.getRecording('one',messageKey))?.key).toBe('original');
  await cache.putPartial('one','replacement',[undefined,await clip(3)],{messageKey,plan:updated});
  expect((await cache.getRecording('one',messageKey))?.key).toBe('replacement');
  expect((await cache.getRecording('one',messageKey))?.clips).toHaveLength(2);
});
test('recording metadata stays scoped to the user and exact message content',async()=>{
  const cache=new AudioCache(new IDBFactory(),'scoped');
  await cache.putPartial('one','key',[await clip()],{messageKey,plan:recordingPlan([passage()],[connection])});
  expect(await cache.getRecording('two',messageKey)).toBeUndefined();expect(await cache.getRecording('one','b'.repeat(64))).toBeUndefined();
});
test('legacy clips can gain a message index without regenerating or changing their bytes',async()=>{
  const cache=new AudioCache(new IDBFactory(),'legacy'),audio=await clip(44);
  await cache.put('one','old-key',[audio]);expect(await cache.getRecording('one',messageKey)).toBeUndefined();
  const clips=(await cache.getPartial('one','old-key',1))!;
  expect(await cache.putPartial('one','old-key',clips,{messageKey,plan:recordingPlan([passage()],[connection])})).toBe(true);
  const saved=(await cache.getRecording('one',messageKey))!;expect(saved.key).toBe('old-key');
  expect(await saved.clips[0]!.blob.arrayBuffer()).toEqual(await audio.blob.arrayBuffer());
});
test('recording projection excludes arbitrary credentials and provider metadata',()=>{
  const raw=passage() as any;raw.settings={...settings,api_key:'private-fixture'};raw.segment.api_key='private-fixture';
  const plan=recordingPlan([raw],[{...connection,api_key:'private-fixture',metadata:'private-fixture'} as any]);
  expect(JSON.stringify(plan)).not.toContain('private-fixture');
  expect(JSON.stringify(readRecordingPlan({...plan,connections:[{...plan.connections[0],api_key:'private-fixture'}]},1))).not.toContain('private-fixture');
});
test('invalid recording metadata cannot overwrite a saved partial recording',async()=>{
  const cache=new AudioCache(new IDBFactory(),'invalid'),audio=await clip(),plan=recordingPlan([passage()],[connection]);
  await cache.putPartial('one','key',[audio],{messageKey,plan});
  expect(await cache.putPartial('one','key',[audio],{messageKey:'invalid',plan})).toBe(false);
  expect(readRecordingPlan(plan,2)).toBeUndefined();
  expect((await cache.getRecording('one',messageKey))?.key).toBe('key');
});
test('explicitly selecting a cached earlier style makes that take the default again',async()=>{
  const cache=new AudioCache(new IDBFactory(),'select-cached-style'),audio=await clip(),plan=recordingPlan([passage()],[connection]);
  await cache.putPartial('one','style-a',[audio],{messageKey,plan});
  await cache.putPartial('one','style-b',[audio],{messageKey,plan:recordingPlan([passage()],[{...connection,speechStyle:'dramatic'}])});
  expect((await cache.getRecording('one',messageKey))?.key).toBe('style-b');
  const clips=(await cache.getPartial('one','style-a',1))!;
  await cache.putPartial('one','style-a',clips,{messageKey,plan});
  expect((await cache.getRecording('one',messageKey))?.key).toBe('style-a');
  expect(await (await cache.getRecording('one',messageKey))!.clips[0]!.blob.arrayBuffer()).toEqual(await audio.blob.arrayBuffer());
});
test('an oversized partial replacement cannot evict the playable original',async()=>{
  const cache=new AudioCache(new IDBFactory(),'protect-large-replacement',100,3),audio=await clip(),plan=recordingPlan([passage()],[connection]);
  await cache.putPartial('one','original',[audio],{messageKey,plan});
  const replacement=recordingPlan([passage('One.'),passage('Two.'),passage('Three.')],[connection]);
  expect(await cache.putPartial('one','replacement',[audio,audio,undefined],{messageKey,plan:replacement})).toBe(false);
  expect((await cache.getRecording('one',messageKey))?.key).toBe('original');
  expect(await cache.get('one','original')).toHaveLength(1);
});
test('partial replacement retention protects the original ahead of unrelated newer entries',async()=>{
  const cache=new AudioCache(new IDBFactory(),'protect-entry-limit',1000,2),audio=await clip(),plan=recordingPlan([passage()],[connection]);
  await cache.putPartial('one','original',[audio],{messageKey,plan});
  await cache.putPartial('one','other',[audio],{messageKey:'b'.repeat(64),plan});
  await cache.putPartial('one','replacement',[audio,undefined],{messageKey,plan:recordingPlan([passage('One.'),passage('Two.')],[connection])});
  expect((await cache.getRecording('one',messageKey))?.key).toBe('original');
  expect(await cache.get('one','original')).toHaveLength(1);
});
