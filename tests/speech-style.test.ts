import {test,expect} from 'bun:test';
import {createNativeTtsClient,nativeSpeechRequest} from '../src/native-tts';
import {DEFAULTS,normalizeSettings,speechRequest,parseSegments} from '../src/shared';
import {planSpeech,planMessageSpeech} from '../src/playback-plan';
import {combineSpeechStyle,isGeminiSpeechStyleModel} from '../src/speech-style';

const connection={id:'saved',name:'Saved',provider:'openrouter_tts',model:DEFAULTS.model,voice:'Kore',supportsSpeechStyle:true,speechStyle:'intimate, restrained storytelling'};
const settings=normalizeSettings({...DEFAULTS,provider:'lumiverse',connectionId:'saved',narratorVoice:'Autonoe',assignments:{'id:elys':{voice:'Fenrir',emotion:'tender',delivery:'softly'}}});
const context={characters:[{id:'elys',name:'Elys-04'}],characterId:'elys',connections:[connection]};

test('native character emotion and delivery augment the baseline without being spoken',()=>{
  const passages=planSpeech(parseSegments('He waited. “[speaker:Elys-04] Wait. <gasp> Listen.” He nodded.','Elys-04'),settings,context);
  const requests=passages.map(p=>nativeSpeechRequest(connection,p.settings,p.segment));
  expect(requests.map(r=>r.voice)).toEqual(['Autonoe','Fenrir','Autonoe']);
  expect(requests.map(r=>r.parameters.speech_style)).toEqual([connection.speechStyle,connection.speechStyle+'\nFor this passage, speak warm and tender, soft-spoken.',connection.speechStyle]);
  expect(requests[1].text).toContain('<gasp>');
  expect(requests.every(r=>r.outputFormat==='pcm')).toBe(true);
  expect(JSON.stringify(requests.map(r=>r.text))).not.toMatch(/tender|soft-spoken|speaker:|emotion:/);
});
test('mood changes split only where Gemini can act on them and quotes release narrator direction',()=>{
  const raw='“[speaker:Elys-04][emotion:angry] Stop! [emotion:tender][delivery:whispers] Come here.” He waited.';
  const passages=planSpeech(parseSegments(raw,'Elys-04'),settings,context);
  expect(passages.map(p=>[p.voice,p.segment.emotion,p.segment.delivery])).toEqual([['Fenrir','angry','softly'],['Fenrir','tender','whispers'],['Autonoe','neutral','normal']]);
  expect(nativeSpeechRequest(connection,passages[1].settings,passages[1].segment).parameters.speech_style).toContain('warm and tender, whispering');
});
test('same voice and direction stay batched across many sentences and vocal cues',()=>{
  const segments=Array.from({length:8},(_,i)=>({text:`Line ${i}. <new-performance-cue-2042>`,speaker:'Elys-04',emotion:'tender',delivery:'normal'}));
  expect(planSpeech(segments,settings,context)).toHaveLength(1);
});
test('old hosts do not split Gemini 3.8 on unsupported moods or send style parameters',()=>{
  const older={...connection,supportsSpeechStyle:false};
  const passages=planSpeech(parseSegments('“[emotion:angry] Stop! [emotion:tender] Come here.”','Elys-04'),settings,{...context,connections:[older]});
  expect(passages).toHaveLength(1);expect(passages[0].segment.emotion).toBe('neutral');
  expect(nativeSpeechRequest(older,passages[0].settings,passages[0].segment).parameters).toEqual({speed:1});
});
test('turning feelings off retains only the connection style; a cleared baseline stays cleared',()=>{
  const source={text:'Hello.',speaker:'Elys-04',emotion:'angry',delivery:'shouts'};
  expect(nativeSpeechRequest(connection,{...settings,useEmotions:false},source).parameters.speech_style).toBe(connection.speechStyle);
  expect(nativeSpeechRequest({...connection,speechStyle:''},{...settings,useEmotions:false},source).parameters.speech_style).toBe('');
  expect(combineSpeechStyle('  ','warm and tender')).toBe('For this passage, speak warm and tender.');
});
test('Flash and Lite support styles, while earlier Gemini models retain legacy audio tags',()=>{
  for(const model of ['google/gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts','google/gemini-3.8-flash-tts-preview'])expect(isGeminiSpeechStyleModel(model)).toBe(true);
  for(const model of ['google/gemini-3.1-flash-tts-preview','google/gemini-2.5-pro-preview-tts','google/gemini-3.8-pro-tts'])expect(isGeminiSpeechStyleModel(model)).toBe(false);
  const request=nativeSpeechRequest(connection,{...settings,model:'google/gemini-3.1-flash-tts-preview'},{text:'Wait.',speaker:'Elys-04',emotion:'angry',delivery:'whispers'});
  expect(request.text).toBe('[angry] [whispers] Wait.');expect(request.parameters.speech_style).toBeUndefined();
});
test('direct OpenRouter uses supported instructions and batches by actual delivery',()=>{
  const direct={...settings,provider:'openrouter' as const};
  const passages=planSpeech(parseSegments('“[emotion:angry] Stop! [emotion:tender] Come here.”','Elys-04'),direct,context);
  expect(passages).toHaveLength(2);
  const requests=passages.map(p=>speechRequest(p.settings,p.segment));
  expect(requests[0].instructions).toBe('angry, soft-spoken');expect(requests[1].instructions).toBe('warm and tender, soft-spoken');
  expect(requests[0].provider).toBeUndefined();
});
test('inherited character connections use their own supported style, not the narrator baseline',()=>{
  const other={...connection,id:'other',speechStyle:'brisk and direct'};
  const passages=planSpeech(parseSegments('He paused. “Hello.”','Elys-04'),{...settings,assignments:{}},{...context,characters:[{id:'elys',name:'Elys-04',ttsVoice:{connectionId:'other',voice:'Orus'}}],connections:[connection,other]});
  const spoken=passages.find(p=>p.voice==='Orus')!;
  expect(nativeSpeechRequest(other,spoken.settings,spoken.segment).parameters.speech_style).toBe(other.speechStyle);
});
test('capability discovery projects only safe style values and preserves explicit empty styles',async()=>{
  for(const [defaults,expected] of [[{},'relaxed'],[{speech_style:' custom '},'custom'],[{speech_style:'',instructions:'ignored'},''],[{instructions:' legacy '},'legacy']] as const){
    const calls:string[]=[];
    const client=createNativeTtsClient((async(url:any)=>{calls.push(url);return Response.json(url.endsWith('/providers')?{providers:[{id:'openrouter_tts',api_key:'private-fixture',capabilities:{parameters:{speech_style:{type:'string',default:'relaxed'}},private:'private-fixture'}}]}:{data:[{...connection,api_key:'private-fixture',default_parameters:{...defaults,other:'private-fixture'}}],total:1})}) as typeof fetch);
    const [projected]=await client.connections();expect(projected.speechStyle).toBe(expected);expect(projected.supportsSpeechStyle).toBe(true);
    expect(JSON.stringify(projected)).not.toContain('private-fixture');expect(calls).toHaveLength(2);expect(calls.every(url=>!url.includes('synthesize'))).toBe(true);
  }
});
test('failed capability discovery leaves old connection loading usable',async()=>{
  const client=createNativeTtsClient((async(url:any)=>url.endsWith('/providers')?new Response('',{status:404}):Response.json({data:[connection]})) as typeof fetch);
  const [projected]=await client.connections();expect(projected.supportsSpeechStyle).toBeUndefined();expect(projected.id).toBe(connection.id);
});
test('legacy cache plans retain their original neutral batching, including old tag cutoff',()=>{
  const message={id:'m',name:'Elys-04',isUser:false,content:'“[emotion:angry] Stop! [emotion:tender] Come here.” He waited. <unknown-cue-123> Hidden by the old parser.'};
  const legacy=planMessageSpeech(message,settings,{...context,legacyAudio:true});
  expect(legacy).toHaveLength(2);expect(legacy.every(p=>p.segment.emotion==='neutral')).toBe(true);
  expect(legacy.map(p=>p.segment.text).join(' ')).not.toContain('Hidden');
  expect(planMessageSpeech(message,settings,context).map(p=>p.segment.text).join(' ')).toContain('Hidden');
});
