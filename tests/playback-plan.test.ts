import { test,expect } from 'bun:test';
import { DEFAULTS,normalizeSettings,parseSegments,DEFAULT_SPEECH_RULES } from '../src/shared';
import { planSpeech,planMessageSpeech,prepareAll,estimatedSentenceIndex,MAX_PASSAGE_CHARS,MAX_NATIVE_PASSAGE_CHARS } from '../src/playback-plan';
import {nativeSpeechRequest} from '../src/native-tts';
const characters=[{id:'mara',name:'Mara'},{id:'rowan',name:'Rowan'}];
const settings=normalizeSettings({...DEFAULTS,provider:'lumiverse',connectionId:'main',narratorVoice:'Charon',assignments:{'id:mara':{voice:'Kore'},'id:rowan':{voice:'Puck'}}});
const plan=(raw:string,s=settings)=>planSpeech(parseSegments(raw,'Mara'),s,{characters,characterId:'mara'});

test('plain and quoted user messages use the configured You voice despite a longer persona name',()=>{
  const s=normalizeSettings({...settings,voice:'Autonoe',personaName:'Jason',npcVoice:'Orus',assignments:{...settings.assignments,'name:jason':{voice:'Fenrir'}}});
  const context={characters,characterId:'mara',connections:[{id:'main',name:'Main',provider:'openrouter_tts',model:s.model,voice:'Leda'}],overrides:{characters:{mara:{connectionId:'main',voice:'Leda'}}}};
  const connection=context.connections[0];
  for(const content of ['What did you find?','“What did you find?”','“[speaker:Jason Slatz] What did you find?”']){
    const passages=planMessageSpeech({id:'user',name:'Jason Slatz',isUser:true,content,characterId:'mara'},s,context);
    expect(passages).toHaveLength(1);expect(passages[0].voice).toBe('Fenrir');
    expect(passages[0].segments.every(segment=>segment.speaker==='Jason')).toBe(true);
    expect(nativeSpeechRequest(connection,passages[0].settings,passages[0].segment)).toMatchObject({voice:'Fenrir',text:passages[0].segment.text});
  }
});
test('user actions stay narrated, explicit cast speakers retain their voices, and skip rules are respected',()=>{
  const s=normalizeSettings({...settings,personaName:'Jason',assignments:{...settings.assignments,'name:jason':{voice:'Fenrir'}}}),context={characters,characterId:'mara'};
  const message={id:'user',name:'Jason Slatz',isUser:true,content:'*I cross the room.* What did you find? “ [speaker:Rowan] A photograph.” I look closer.'};
  const passages=planMessageSpeech(message,s,context);
  expect(passages.map(p=>p.voice)).toEqual(['Charon','Fenrir','Puck','Fenrir']);
  expect(passages.map(p=>p.segment.text).join(' ')).toBe('I cross the room. What did you find? “A photograph.” I look closer.');
  const skipped=planMessageSpeech(message,s,context,{...DEFAULT_SPEECH_RULES,asterisked:'skip',undecorated:'skip'});
  expect(skipped.map(p=>p.voice)).toEqual(['Puck']);expect(skipped[0].segment.text).toBe('“A photograph.”');
});
test('a user with no You voice cannot borrow the assistant voice or everyone-else voice',()=>{
  for(const personaName of ['', 'Jason']){
    const s=normalizeSettings({...settings,voice:'Autonoe',personaName,npcVoice:'Orus'});
    const passages=planMessageSpeech({id:'user',name:'Jason Slatz',isUser:true,content:'Tell me more.'},s,{characters,characterId:'mara'});
    expect(passages[0].voice).toBe('Autonoe');
  }
  const s=normalizeSettings({...settings,voice:'Fenrir',personaName:'Jason',assignments:{...settings.assignments,'name:jason':{voice:'Fenrir'}}});
  expect(planMessageSpeech({id:'user',name:'Jason Slatz',isUser:true,content:'Tell me more.'},s,{characters,characterId:'mara'})[0].voice).toBe('Fenrir');
});
test('assistant messages keep their narration and side-character choices after persona support',()=>{
  const s=normalizeSettings({...settings,personaName:'Jason',npcVoice:'Orus',assignments:{...settings.assignments,'name:jason':{voice:'Fenrir'}}});
  const message={id:'assistant',name:'Mara',isUser:false,content:'Rain fell. “Hello.” “ [speaker:Jason] Wait.” “ [speaker:Innkeeper] Welcome.”'};
  expect(planMessageSpeech(message,s,{characters,characterId:'mara'}).map(p=>p.voice)).toEqual(['Charon','Kore','Fenrir','Orus']);
});

test('untagged straight and curly dialogue switches between narrator and character',()=>{
  const passages=plan('The door opened. Rain swept inside. “Come in. It is warm here.” She stepped aside. "Thank you."');
  expect(passages.map(p=>p.voice)).toEqual(['Charon','Kore','Charon','Kore']);
  expect(passages[0].segment.text).toBe('The door opened. Rain swept inside.');
  expect(passages[1].segments).toHaveLength(2);
});
test('explicit speaker cues override quote detection and persist until changed',()=>{
  expect(plan('[speaker:Rowan] No quotes needed. I am speaking. [speaker:narrator] “A quote in narration.”').map(p=>p.voice)).toEqual(['Puck','Charon']);
});
test('a speaker cue on quoted dialogue releases the narrator after the closing quote',()=>{
  for(const [open,close] of [['“','”'],['"','"'],['«','»']]) {
    const passages=plan(`The door opened. [speaker:Rowan][emotion:angry][delivery:shouts] ${open}Come in.${close} She waited. ${open}[speaker:Rowan] Thank you.${close} The room was quiet.`);
    expect(passages.map(p=>p.voice)).toEqual(['Charon','Puck','Charon','Puck','Charon']);
    expect(passages[2].segments[0]).toMatchObject({speaker:'narrator',emotion:'',delivery:''});
  }
});
test('emotion cues alone do not prevent automatic narration detection',()=>{
  expect(plan('[emotion:worried] She frowned. “Is it safe?”').map(p=>p.voice)).toEqual(['Charon','Kore']);
  const tagged=plan('She frowned. “[emotion:worried] Is it safe? [delivery:softly] Please tell me.” Then she waited.');
  expect(tagged.map(p=>p.voice)).toEqual(['Charon','Kore','Charon']);
  expect(tagged[1].segment.text).toBe('“Is it safe? Please tell me.”');
  expect(tagged.flatMap(p=>p.segments).some(s=>/^["“”]+$/.test(s.text))).toBe(false);
  expect(plan('"[emotion:"bad"] Hello."')[0].voice).toBe('Kore');
});
test('same voice prose batches across sentences, not per sentence',()=>{
  const passages=plan('She waited. It was late. The room was quiet.');
  expect(passages).toHaveLength(1);expect(passages[0].segments).toHaveLength(3);
});
test('inline vocal events do not add requests or break a continuous voice passage',()=>{
  const raw='She paused. "Wait. <gasp> You heard that too? <short pause> Listen." She nodded.';
  const tagged=plan(raw),plain=plan(raw.replace(/<[^>]+>/g,''));
  expect(tagged.map(p=>p.voice)).toEqual(plain.map(p=>p.voice));
  expect(tagged).toHaveLength(3);expect(tagged[1].segment.text).toContain('<gasp>');
  expect(tagged.flatMap(p=>p.segments)).toHaveLength(plain.flatMap(p=>p.segments).length);
});
test('browser and unsupported models omit vocal events while keeping all words',()=>{
  const raw='She paused. "Wait. <gasp> You heard that too? <short pause> Listen." She nodded.';
  for(const provider of ['browser','local','lumiverse'] as const) {
    const passages=plan(raw,{...settings,provider,model:'gpt-4o-mini-tts'});
    expect(passages.map(p=>p.segment.text).join(' ')).toBe('She paused. "Wait. You heard that too? Listen." She nodded.');
    expect(passages.map(p=>p.voice)).toEqual(['Charon','Kore','Charon']);
  }
  expect(plan('<gasp>',{...settings,provider:'browser'})).toHaveLength(0);
});
test('vocal support follows the resolved inherited model instead of the initial connection',()=>{
  const s={...settings,model:'gpt-4o-mini-tts',assignments:{},narratorVoice:''};
  const passages=planSpeech(parseSegments('"Hello <sigh> there."','Mara'),s,{characters:[{id:'mara',name:'Mara',ttsVoice:{connectionId:'gemini',voice:'Leda'}}],characterId:'mara',connections:[{id:'gemini',name:'Gemini',provider:'openrouter_tts',model:DEFAULTS.model,voice:'Kore'}]});
  expect(passages[0].segment.text).toBe('"Hello <sigh> there."');
});
test('long Gemini passages cannot split a multiword vocal token across requests',()=>{
  const raw='"'+('Hold on <heavy breath> keep going <short pause> '.repeat(500))+'"';
  const passages=plan(raw);
  expect(passages.length).toBeGreaterThan(1);
  expect(passages.every(p=>p.segment.text.length<=MAX_NATIVE_PASSAGE_CHARS)).toBe(true);
  for(const p of passages)expect(p.segment.text.replace(/<heavy breath>|<short pause>/g,'')).not.toMatch(/[<>]/);
  expect(passages.map(p=>p.segment.text).join(' ')).toBe(raw.trim());
});
test('ignored Gemini 3.8 styles do not fragment continuous prose',()=>{
  expect(plan('[speaker:Mara][emotion:angry] Stop. [emotion:sad] Please stay.')).toHaveLength(1);
  const legacy=plan('[speaker:Mara][emotion:angry] Stop. [emotion:sad] Please stay.',{...settings,model:'google/gemini-3.1-flash-tts-preview'});
  expect(legacy).toHaveLength(2);expect(legacy[1].segment.emotion).toBe('sad');
});
test('native speech detection rules can skip actions or read plain text as speech',()=>{
  const segments=parseSegments('*A hidden action.* **A bold description.** “Hello.” Plain words.','Mara',{...DEFAULT_SPEECH_RULES,asterisked:'skip',undecorated:'speech'});
  expect(segments.map(s=>s.text).join(' ')).toBe('A bold description. “Hello.” Plain words.');
  expect(segments.every(s=>s.speaker==='Mara')).toBe(true);
});
test('long readings are bounded while preserving every sentence',()=>{
  const raw='The rain fell softly. '.repeat(800),passages=plan(raw);
  expect(passages.length).toBeGreaterThan(1);
  expect(passages.every(p=>p.segment.text.length<=MAX_NATIVE_PASSAGE_CHARS)).toBe(true);
  expect(passages.flatMap(p=>p.segments)).toHaveLength(800);
});
test('native Gemini batches long narration into fewer requests while direct models stay bounded',()=>{
  const raw='The rain fell softly. '.repeat(400);
  const native=plan(raw),direct=plan(raw,{...settings,provider:'openrouter'});
  expect(native).toHaveLength(1);expect(direct.length).toBeGreaterThan(native.length);
  expect(direct.every(p=>p.segment.text.length<=MAX_PASSAGE_CHARS)).toBe(true);
});
test('Lumiverse character and narrator voices may use separate saved connections',()=>{
  const s={...settings,narratorVoice:'',assignments:{}};
  const context={characters:[{id:'mara',name:'Mara',ttsVoice:{connectionId:'character',voice:'Leda'}}],characterId:'mara',connections:[{id:'character',name:'Character',provider:'openrouter_tts',model:DEFAULTS.model,voice:'Kore'},{id:'narration',name:'Narrator',provider:'openai_tts',model:'gpt-4o-mini-tts',voice:'alloy'}],narrationVoice:{connectionId:'narration',voice:'echo'}};
  const passages=planSpeech(parseSegments('Rain fell. “Hello.”','Mara'),s,context);
  expect(passages.map(p=>[p.voice,p.settings.connectionId])).toEqual([['echo','narration'],['Leda','character']]);
  const explicit=planSpeech(parseSegments('Rain fell. “Hello.”','Mara'),settings,context);
  expect(explicit.map(p=>p.voice)).toEqual(['Charon','Kore']);
  expect(planSpeech(parseSegments('“Hello.”','Mara'),{...s,inheritVoices:false},context)[0].voice).toBe('Kore');
});
test('chat voice overrides precede character defaults; unavailable connections fall back',()=>{
  const s={...settings,narratorVoice:'',assignments:{}};
  const context={characters:[{id:'mara',name:'Mara',ttsVoice:{connectionId:'main',voice:'Leda'}}],characterId:'mara',connections:[{id:'main',name:'Main',provider:'openrouter_tts',model:DEFAULTS.model,voice:'Kore'}],overrides:{characters:{mara:{connectionId:'main',voice:'Puck'}},narrator:{connectionId:'missing',voice:'missing'}}};
  expect(planSpeech(parseSegments('“Hello.”','Mara'),s,context)[0].voice).toBe('Puck');
  expect(planSpeech(parseSegments('Rain fell.','Mara'),s,context)[0].voice).toBe('Kore');
});
test('full preparation preserves order when responses arrive out of order',async()=>{
  const items=plan('Rain. “Hello.” More rain.');let active=0,peak=0;const progress:number[]=[];
  const results=await prepareAll(items,async(_p,i)=>{active++;peak=Math.max(peak,active);await Bun.sleep(i===0?15:1);active--;return i},new AbortController().signal,n=>progress.push(n),2);
  expect(results).toEqual([0,1,2]);expect(peak).toBe(2);expect(progress).toEqual([1,2,3]);
});
test('stop cancels preparation without starting remaining paid requests',async()=>{
  const abort=new AbortController();let calls=0;
  await expect(prepareAll(plan('Rain. “Hello.” More rain.'),async()=>{calls++;abort.abort();return 'audio'},abort.signal,()=>{},1)).rejects.toThrow();
  expect(calls).toBe(1);
});
test('a provider failure keeps already accepted audio and stops dispatching new requests',async()=>{
  let calls=0;const kept:number[]=[];
  await expect(prepareAll(plan('Rain. “Hello.” More rain. “Goodbye.”'),async(_p,i,signal)=>{
    calls++;if(i===0)throw new Error('Provider failed');await Bun.sleep(1);signal.throwIfAborted();kept.push(i);return i;
  },new AbortController().signal,()=>{},2)).rejects.toThrow('Provider failed');
  expect(calls).toBe(2);expect(kept).toEqual([1]);
});
test('estimated sentence tracking stays in bounds and advances through a batched passage',()=>{
  const passage=plan('She waited. It was late. The room was quiet.')[0];
  expect(estimatedSentenceIndex(passage,-1)).toBe(0);expect(estimatedSentenceIndex(passage,.5)).toBe(1);expect(estimatedSentenceIndex(passage,2)).toBe(2);
});

test('side characters without a voice use the everyone-else voice, and nobody else does',()=>{
  const s=normalizeSettings({...DEFAULTS,provider:'openrouter',model:'openai/gpt-4o-mini-tts',voice:'Kore',narratorVoice:'Charon',npcVoice:'Orus',assignments:{'id:mara':{voice:'Leda'},'name:jason':{voice:'Fenrir'}}});
  const line=(speaker:string)=>({text:'"Hello there."',speaker,emotion:'',delivery:''});
  const context={characters:[{id:'mara',name:'Mara||Scholar'},{id:'rowan',name:'Rowan'}],characterId:'mara',mainSpeaker:'Mara'};
  const voices=(speaker:string,settings=s)=>planSpeech([line(speaker)],settings,context).map(p=>p.voice);
  expect(voices('Innkeeper')).toEqual(['Orus']);
  expect(voices('Mara')).toEqual(['Leda']);
  expect(voices('Jason')).toEqual(['Fenrir']);
  expect(voices('narrator')).toEqual(['Charon']);
  expect(voices('Rowan')).not.toEqual(['Orus']);
  // Unset keeps the old behaviour: an unknown speaker borrows the reply's character.
  expect(voices('Innkeeper',{...s,npcVoice:''})).toEqual(['Leda']);
});
