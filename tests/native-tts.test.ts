import { describe,test,expect } from 'bun:test';
import { pcmToWav } from '../src/audio';
import { createNativeTtsClient,nativeSpeechRequest,type NativeConnection } from '../src/native-tts';
import { DEFAULTS,normalizeSettings,parseSegments } from '../src/shared';
import {planSpeech} from '../src/playback-plan';
const connection:NativeConnection={id:'saved-router',name:'My OpenRouter',provider:'openrouter_tts',model:DEFAULTS.model,voice:'Kore'};
const settings={...DEFAULTS,provider:'lumiverse' as const,connectionId:connection.id};
const segment={text:'Are you sure?',speaker:'Mara',emotion:'worried',delivery:'whispers'};
describe('native Lumiverse TTS',()=>{
  test('Threadbare vocal events pass through Gemini 3.8 in their exact spoken position',async()=>{
    const raw='She paused. <font color="blue">"[speaker:Mara] Wait. <gasp> You heard that too? <short pause> Listen."</font> She nodded. <dt-image>"<laugh> Hidden image prompt."</dt-image>';
    const chosen=normalizeSettings({...settings,narratorVoice:'Autonoe',assignments:{'id:mara':{voice:'Fenrir'}}});
    const passages=planSpeech(parseSegments(raw,'Mara'),chosen,{characters:[{id:'mara',name:'Mara'}],characterId:'mara'});
    const requests:any[]=[];
    const client=createNativeTtsClient((async(_url:any,init:any)=>{requests.push(JSON.parse(init.body));return new Response(new Uint8Array(2),{headers:{'Content-Type':'audio/pcm'}})}) as unknown as typeof fetch);
    for(const p of passages)await client.speech(connection,p.settings,p.segment);
    expect(requests.map(r=>[r.voice,r.text])).toEqual([
      ['Autonoe','She paused.'],['Fenrir','"Wait. <gasp> You heard that too? <short pause> Listen."'],['Autonoe','She nodded.'],
    ]);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests)).not.toMatch(/speaker:|font|dt-image|Hidden/);
  });
  test('Autonoe narration and assigned Fenrir dialogue reach the native endpoint separately',async()=>{
    const chosen=normalizeSettings({...settings,voice:'Autonoe',narratorVoice:'Autonoe',inheritVoices:true,assignments:{'id:elys':{voice:'Fenrir',emotion:'tender',delivery:'normal'}}});
    const characters=[{id:'elys',name:'Elys-04 || Android mystery character',ttsVoice:{connectionId:'saved-router',voice:'Kore'}}];
    const raw='He covered the screen. “[speaker:Elys-04][emotion:tender] May I see?” He turned the phone around. <scenecard><sc-stella>Hidden commentary.</sc-stella></scenecard> “[speaker:Elys-04] Thank you.”';
    const passages=planSpeech(parseSegments(raw,'Elys-04'),chosen,{characters,characterId:'elys',connections:[connection],narrationVoice:{connectionId:connection.id,voice:'Kore'}});
    const requests:any[]=[];
    const client=createNativeTtsClient((async(_url:any,init:any)=>{requests.push(JSON.parse(init.body));return new Response(new Uint8Array(2),{headers:{'Content-Type':'audio/pcm'}})}) as unknown as typeof fetch);
    for(const p of passages)await client.speech(connection,p.settings,p.segment);
    expect(requests.map(r=>[r.voice,r.text])).toEqual([
      ['Autonoe','He covered the screen.'],['Fenrir','“May I see?”'],['Autonoe','He turned the phone around.'],['Fenrir','“Thank you.”'],
    ]);
    expect(requests.every(r=>r.connectionId==='saved-router' && r.outputFormat==='pcm')).toBe(true);
    expect(JSON.stringify(requests)).not.toMatch(/speaker:|emotion:|scenecard|commentary/);
  });
  test('a larger cast uses distinct native voices and releases narration between dialogue',async()=>{
    const raw='The room went quiet. “[speaker:Elys-04] I saw him.” “[speaker:Jason] When?” “[speaker:Vasquez] Before dawn.” The clock stopped.';
    const chosen=normalizeSettings({...settings,narratorVoice:'Autonoe',assignments:{'id:elys':{voice:'Fenrir'},'name:jason':{voice:'Charon',name:'Jason'},'name:vasquez':{voice:'Orus',name:'Vasquez'}}});
    const passages=planSpeech(parseSegments(raw,'Elys-04'),chosen,{characters:[{id:'elys',name:'Android card'}],characterId:'elys'});
    const requests:any[]=[];const client=createNativeTtsClient((async(_url:any,init:any)=>{requests.push(JSON.parse(init.body));return new Response(new Uint8Array(2),{headers:{'Content-Type':'audio/pcm'}})}) as unknown as typeof fetch);
    for(const p of passages)await client.speech(connection,p.settings,p.segment);
    expect(requests.map(r=>r.voice)).toEqual(['Autonoe','Fenrir','Charon','Orus','Autonoe']);
    expect(JSON.stringify(requests)).not.toContain('speaker:');expect(JSON.stringify(requests)).not.toContain('api_key');
  });
  test('native errors and failed connection checks never echo arbitrary key formats',async()=>{
    const secret='unknown-format-native-fixture';
    const error=createNativeTtsClient((async()=>Response.json({error:'Rejected '+secret},{status:502})) as unknown as typeof fetch);
    await expect(error.speech(connection,settings,segment)).rejects.not.toThrow(secret);
    const check=createNativeTtsClient((async()=>Response.json({success:false,message:'Invalid API key '+secret})) as unknown as typeof fetch);
    await expect(check.check(connection.id)).rejects.not.toThrow(secret);
  });
  test('native preferences project safe narration, detection rules and the automatic-TTS flag',async()=>{
    const calls:any[]=[];const client=createNativeTtsClient((async(url:any,init:any)=>{calls.push({url,init});return Response.json({value:{narrationVoice:{connectionId:'narrator',voice:'Charon',other:'do-not-project'},speechDetectionRules:{quoted:'speech',asterisked:'skip',undecorated:'speech'},sttLanguage:'do-not-project'}})}) as unknown as typeof fetch);
    expect(await client.preferences()).toEqual({narrationVoice:{connectionId:'narrator',voice:'Charon'},automaticTts:false,rules:{quoted:'speech',asterisked:'skip',undecorated:'speech'}});
    expect(calls[0].url).toBe('/api/v1/settings/voiceSettings');expect(calls[0].init.credentials).toBe('include');expect(calls[0].init.method).toBeUndefined();
  });
  test('malformed native voice preferences keep safe speech-detection defaults',async()=>{
    const client=createNativeTtsClient((async()=>Response.json({value:{narrationVoice:{voice:'missing connection'},speechDetectionRules:{quoted:'evil',asterisked:'speech',undecorated:'thought'}}})) as unknown as typeof fetch);
    expect(await client.preferences()).toEqual({narrationVoice:undefined,automaticTts:false,rules:{quoted:'speech',asterisked:'narration',undecorated:'narration'}});
  });
  test('duplicate-automatic-TTS detection needs both host switches and exposes no credentials',async()=>{
    for(const [ttsEnabled,ttsAutoPlay,automatic] of [[true,true,true],[true,false,false],[false,true,false],['true',true,false],[true,'true',false],[undefined,undefined,false]] as const){
      const client=createNativeTtsClient((async()=>Response.json({value:{ttsEnabled,ttsAutoPlay,api_key:'private-fixture',connections:{secret:'private-fixture'}}})) as unknown as typeof fetch);
      const preferences=await client.preferences();expect(preferences.automaticTts).toBe(automatic);expect(JSON.stringify(preferences)).not.toContain('private-fixture');
    }
  });
  test('Gemini requests PCM through the saved connection without keys or spoken directions',()=>{
    expect(nativeSpeechRequest(connection,settings,segment)).toEqual({connectionId:'saved-router',model:DEFAULTS.model,text:'Are you sure?',voice:'Kore',parameters:{speed:1},outputFormat:'pcm'});
    expect(nativeSpeechRequest(connection,{...settings,assignments:{'id:mara':{voice:'Puck',emotion:'neutral',delivery:'normal'}}},segment,'mara').voice).toBe('Puck');
    expect(nativeSpeechRequest(connection,{...settings,model:'google/gemini-3.1-flash-tts-preview'},segment).text).toBe('[worried] [whispers] Are you sure?');
  });
  test('supported OpenAI models receive style directions separately from prose',()=>{
    const body=nativeSpeechRequest(connection,{...settings,model:'openai/gpt-4o-mini-tts'},segment);
    expect(body.text).toBe('Are you sure?');expect(body.parameters.instructions).toBe('Speak worried, whispering.');expect(body.outputFormat).toBeUndefined();
  });
  test('listing connections never extracts keys or unnecessary provider metadata',async()=>{
    const calls:any[]=[];const client=createNativeTtsClient((async(url:any,init:any)=>{calls.push({url,init});return Response.json({data:[{...connection,api_key:'do-not-extract',metadata:{secret:'do-not-extract'},default_parameters:{output_format:'pcm'}}],total:1})}) as unknown as typeof fetch);
    const result=await client.connections();expect(result).toEqual([{...connection,outputFormat:'pcm'}]);expect(JSON.stringify(result)).not.toContain('do-not-extract');
    expect(calls.map(c=>c.url)).toEqual(['/api/v1/tts-connections/providers','/api/v1/tts-connections?limit=200&offset=0']);expect(calls.every(c=>c.init.credentials==='include' && c.init.headers===undefined)).toBe(true);
  });
  test('voice and model lists use the selected connection',async()=>{
    const calls:string[]=[];const client=createNativeTtsClient((async(url:any)=>{calls.push(url);return Response.json(url.endsWith('/voices')?{voices:[{id:'voice-a',name:'Voice A'},{id:'voice-b',name:'Voice B'}]}:{models:[{id:'speech',label:'Speech model'}]})}) as unknown as typeof fetch);
    expect(await client.voices('my/connection')).toEqual(['voice-a','voice-b']);expect((await client.models('my/connection'))[0].name).toBe('Speech model');
    expect(calls).toEqual(['/api/v1/tts-connections/my%2Fconnection/voices','/api/v1/tts-connections/my%2Fconnection/models']);
  });
  test('PCM bytes become a playable WAV in one authenticated synthesis call',async()=>{
    const calls:any[]=[];const samples=new Uint8Array([0,0,0xff,0x7f,0,0x80,1,0]);
    const client=createNativeTtsClient((async(url:any,init:any)=>{calls.push({url,init});return new Response(samples,{headers:{'Content-Type':'audio/pcm'}})}) as unknown as typeof fetch);
    const audio=await client.speech(connection,settings,segment);
    const bytes=new Uint8Array(await audio.blob.arrayBuffer());
    expect(calls).toHaveLength(1);expect(calls[0].url).toBe('/api/v1/tts/synthesize');expect(calls[0].init.credentials).toBe('include');expect(calls[0].init.headers).toEqual({'Content-Type':'application/json'});
    expect(JSON.parse(calls[0].init.body).outputFormat).toBe('pcm');expect(audio.mime).toBe('audio/wav');expect(bytes.subarray(44)).toEqual(samples);
    expect(new TextDecoder().decode(bytes.subarray(0,4))).toBe('RIFF');const view=new DataView(bytes.buffer);expect(view.getUint32(24,true)).toBe(24000);expect(view.getUint16(34,true)).toBe(16);expect(view.getUint32(40,true)).toBe(samples.length);
  });
  test('JSON errors surface on the first request without a speech retry',async()=>{
    let calls=0;const client=createNativeTtsClient((async()=>{calls++;return Response.json({error:'Gemini voice rejected sk-or-v1-secret'},{status:400})}) as unknown as typeof fetch);
    await expect(client.speech(connection,settings,segment)).rejects.toThrow('HTTP 400');expect(calls).toBe(1);
    await expect(client.speech(connection,settings,segment)).rejects.not.toThrow('sk-or-v1-secret');
  });
  test('connection checks do not synthesize speech',async()=>{
    const urls:string[]=[];const client=createNativeTtsClient((async(url:any)=>{urls.push(url);return Response.json({success:true,message:'Connection successful'})}) as unknown as typeof fetch);
    expect(await client.check('saved-router')).toContain('No speech was generated');expect(urls).toEqual(['/api/v1/tts-connections/saved-router/test']);
  });
  test('Stop can abort the native synthesis request',async()=>{
    const controller=new AbortController();const client=createNativeTtsClient((async(_url:any,init:any)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')))})) as unknown as typeof fetch);
    const pending=client.speech(connection,settings,segment,undefined,controller.signal);controller.abort();await expect(pending).rejects.toThrow('Stopped');
  });
  test('native audio is no longer rejected by the direct proxy size limit; incomplete PCM is rejected',async()=>{
    const client=createNativeTtsClient((async()=>new Response(new Uint8Array(2),{headers:{'Content-Type':'audio/pcm','Content-Length':String(26*1024*1024)}})) as unknown as typeof fetch);
    expect((await client.speech(connection,settings,segment)).blob.size).toBe(46);expect(()=>pcmToWav(new Uint8Array([0,0,0]))).toThrow('incomplete');expect(()=>pcmToWav(new Uint8Array())).toThrow('empty');
  });
  test('existing WAV data is not wrapped twice; PCM rate parameters are honored',()=>{
    const bytes=new Uint8Array([0,0,1,0]);const wav=pcmToWav(bytes,'audio/pcm;rate=48000');expect(pcmToWav(wav,'audio/wav')).toBe(wav);expect(new DataView(wav.buffer).getUint32(24,true)).toBe(48000);
    expect(()=>pcmToWav(bytes,'audio/pcm;channels=2')).toThrow('unsupported');expect(()=>pcmToWav(bytes,'audio/pcm;rate=wrong')).toThrow('unsupported');
  });
});
