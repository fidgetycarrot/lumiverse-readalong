import {test,expect} from 'bun:test';
import {RecordingStore,readMessageRecording,splitRecording} from '../src/message-recordings';
import {waveHeader,joinPrepared,prepareClip} from '../src/prepared-audio';

const hash=(c:string)=>c.repeat(64);
const record=(n:string,audioId=`a${n}`)=>({messageKey:hash(n),key:hash('f'),audioId,chatId:'chat1',messageId:`m${n}`,sizes:[16000,8000],wave:{rate:8000,channels:1,bits:16},plan:{passages:[]},savedAt:0});
function memory(){const data=new Map<string,string>();return {data,storage:{read:async(u:string)=>data.get(u),write:async(u:string,v:string)=>{data.set(u,v)}}}}

test('records are validated before they are kept',()=>{
  expect(readMessageRecording(record('1'))).toBeTruthy();
  expect(readMessageRecording({...record('1'),audioId:'../x'})).toBeUndefined();
  expect(readMessageRecording({...record('1'),sizes:[3]})).toBeUndefined();
  expect(readMessageRecording({...record('1'),messageKey:'nope'})).toBeUndefined();
});
test('keeps the newest recordings and hands back older ones to delete',async()=>{
  const {storage}=memory(),store=new RecordingStore(storage);
  expect(await store.remember('u',record('1'),2)).toEqual([]);
  await new Promise(r=>setTimeout(r,2));expect(await store.remember('u',record('2'),2)).toEqual([]);
  await new Promise(r=>setTimeout(r,2));const expired=await store.remember('u',record('3'),2);
  expect(expired.map(r=>r.audioId)).toEqual(['a1']);
  expect(await store.get('u',hash('1'))).toBeUndefined();expect((await store.get('u',hash('3')))?.audioId).toBe('a3');
  const replaced=await store.remember('u',record('3','b3'),2);expect(replaced.map(r=>r.audioId)).toEqual(['a3']);
  await store.forget('u',hash('3'));expect(await store.get('u',hash('3'))).toBeUndefined();
  expect(await store.get('other',hash('2'))).toBeUndefined();
});
test('a joined WAV splits back into the same parts with the same sound',async()=>{
  const part=(seconds:number,value:number)=>prepareClip({blob:new Blob([waveHeader(seconds*16000,8000),new Uint8Array(seconds*16000).fill(value)],{type:'audio/wav'}),mime:'audio/wav'});
  const clips=[await part(1,1),await part(.5,2)];
  const joined=joinPrepared(clips)[0].blob;
  const back=splitRecording(joined,{sizes:clips.map(c=>c.wave!.size),wave:{rate:8000,channels:1,bits:16}})!;
  expect(back.map(c=>c.duration)).toEqual([1,.5]);
  const again=joinPrepared(back)[0].blob;
  expect(new Uint8Array(await again.arrayBuffer())).toEqual(new Uint8Array(await joined.arrayBuffer()));
  expect(splitRecording(joined.slice(0,100),{sizes:[16000,8000],wave:{rate:8000,channels:1,bits:16}})).toBeUndefined();
});

import {createNativeTtsClient} from '../src/native-tts';
test('the Lumiverse client uploads one file and reads it back',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const client=createNativeTtsClient((async(url:string,init:RequestInit)=>{
    calls.push({url,init});
    if(url.endsWith('/tts/save-message-audio'))return new Response(JSON.stringify({audio:{id:'aud1'}}),{headers:{'content-type':'application/json'}});
    if(url.endsWith('/audio/gone'))return new Response('{}',{status:404});
    if(url.includes('/audio/'))return new Response(new Uint8Array(60));
    return new Response('{}');
  }) as any);
  expect(await client.saveMessageAudio('c1','m1',new Blob([new Uint8Array(60)]),'x.wav')).toBe('aud1');
  const form=calls[0].init.body as FormData;
  expect([form.get('chatId'),form.get('messageId'),form.getAll('segment').length]).toEqual(['c1','m1',1]);
  expect((await client.audio('aud1',1000))?.size).toBe(60);
  expect(await client.audio('gone',1000)).toBeUndefined();
  await expect(client.audio('aud1',10)).rejects.toThrow();
  await client.removeMessageAudio('c1','m1','aud1');
  expect(calls.at(-1)!.url).toBe('/api/v1/chats/c1/messages/m1/attachments/aud1');
  expect(calls.at(-1)!.init.method).toBe('DELETE');
});
