import {test,expect} from 'bun:test';
import {applyPronunciations,learnPronunciations,normalizePronunciations,PronunciationStore,stripPronunciationCues,pronunciationInstruction,pronunciationSample,pronunciationEntry} from '../src/pronunciation';
import {parseSegments,plainText,DEFAULTS,CUE_PATTERN} from '../src/shared';
import {planSpeech} from '../src/playback-plan';
import {nativeSpeechRequest} from '../src/native-tts';
const entry={name:'Elys',spokenAs:'Eleese',aliases:['Elys-04'],source:'manual'};
const saved=normalizePronunciations({elys:entry});
test('pronunciation previews exercise each alternative and retain its original marker spelling',()=>{
  const e=pronunciationEntry({...entry,aliases:['Elys-04','Ellis']},'manual')!;
  const settings={...DEFAULTS,provider:'lumiverse' as const,voice:'Fenrir'};
  for(const spelling of [undefined,e.name,...e.aliases]){
    const text=pronunciationSample(e,spelling),segments=parseSegments(text,'Preview');
    const passages=planSpeech(segments,settings,{characters:[],pronunciations:normalizePronunciations({e})});
    expect(passages).toHaveLength(1);expect(passages[0].voice).toBe('Fenrir');
    expect(passages[0].segment.text).not.toMatch(/Elys|Ellis/);
    expect(passages[0].segment.text).toContain('Eleese arrived.');
    expect(passages[0].segments.map(s=>s.text).join(' ')).toBe(text);
    if(spelling)expect(text).toBe(`${spelling} arrived. I looked at ${spelling}. ${spelling}'s voice was calm.`);
    else expect(text).toBe('Elys arrived. Elys-04 arrived. Ellis arrived.');
  }
  expect(()=>pronunciationSample(e,'Another person')).toThrow('Choose a name');
});
test('the maximum pronunciation preview fits one provider passage after substitutions',()=>{
  const e=pronunciationEntry({name:'N'.repeat(80),spokenAs:'S'.repeat(100),aliases:Array.from({length:10},(_,i)=>'A'.repeat(79)+i)},'manual')!;
  for(const provider of ['browser','openrouter','lumiverse','local'] as const){
    const passages=planSpeech(parseSegments(pronunciationSample(e),'Preview'),{...DEFAULTS,provider},{characters:[],pronunciations:normalizePronunciations({e})});
    expect(passages).toHaveLength(1);
    expect(passages[0].segment.text).toBe(Array(11).fill('S'.repeat(100)+' arrived.').join(' '));
  }
});
test('narrator and dialogue send the pronunciation but retain display names and speaker IDs',()=>{
  const raw='Elys waited. “[speaker:Elys] Elys-04 is my name.” Elys’s gaze softened.',segments=parseSegments(raw,'Elys');
  const settings={...DEFAULTS,provider:'lumiverse' as const,narratorVoice:'Autonoe',voice:'Kore',assignments:{'name:elys':{voice:'Fenrir',emotion:'neutral',delivery:'normal'}}};
  const passages=planSpeech(segments,settings,{characters:[],pronunciations:saved});
  const connection={id:'native',name:'Native',model:settings.model,voice:'Kore',provider:'openrouter_tts'};
  expect(passages.map(p=>nativeSpeechRequest(connection,p.settings,p.segment).text)).toEqual(['Eleese waited.','“Eleese is my name.”','Eleese’s gaze softened.']);
  expect(passages.map(p=>p.voice)).toEqual(['Autonoe','Fenrir','Autonoe']);
  expect(passages.flatMap(p=>p.segments).map(s=>s.text)).toEqual(segments.map(s=>s.text));expect(segments[1].speaker).toBe('Elys');
});
test('literal Unicode name matches preserve possessives, avoid substrings, and do not cascade',()=>{
  const rules=normalizePronunciations({one:entry,two:{name:'Eleese',spokenAs:'Wrong',source:'automatic'},three:{name:'Zoë',spokenAs:'Zoey'}});
  expect(applyPronunciations("ELYS met Elys-04. Elys's and Elys’s. Elysian SomeElys Elys-other. Zoë smiled.",rules)).toBe("Eleese met Eleese. Eleese's and Eleese’s. Elysian SomeElys Elys-other. Zoey smiled.");
});
test('vocal tags survive substitutions even if an NPC shares a vocal-tag name',()=>{
  const rules=normalizePronunciations({sigh:{name:'Sigh',spokenAs:'Sye'}});
  expect(applyPronunciations('Sigh said <sigh> hello. <heavy breath>',rules)).toBe('Sye said <sigh> hello. <heavy breath>');
});
test('first introduction learns a cue; later changes cannot replace the saved choice',()=>{
  const first=learnPronunciations({},'[pronounce:Elys|Eleese] Elys entered.');
  expect(first.elys).toMatchObject({name:'Elys',spokenAs:'Eleese',source:'automatic'});
  expect(learnPronunciations(first,'Elys [pronounce:Elys|Ellis] appeared.').elys.spokenAs).toBe('Eleese');
  expect(learnPronunciations(saved,'Elys-04 [pronounce:Elys-04|Ellis] appeared.')).toEqual(saved);
});
test('scene cards, image prompts, code, comments and nonexistent names cannot add pronunciations',()=>{
  const raw='<scenecard>[pronounce:Fake|Fayk] Fake</scenecard><dt-image>[pronounce:Other|Ohther] Other</dt-image>\n```text\n[pronounce:Code|Kohd] Code\n```\n<!-- [pronounce:Comment|Kohment] Comment -->\n[pronounce:Missing|Miss-ing] Elys was here.';
  expect(Object.keys(learnPronunciations({},raw))).toHaveLength(0);
});
test('malformed and partial cues are silent and never become pronunciation instructions',()=>{
  const text='Elys [pronounce:Elys|<gasp>] spoke. [pronounce:bad cue';
  expect(Object.keys(learnPronunciations({},text))).toHaveLength(0);
  expect(plainText(text)).not.toContain('pronounce:');expect(parseSegments(text).map(s=>s.text).join(' ')).not.toContain('pronounce:');
  expect(stripPronunciationCues('Hello [pronounce:] world.')).toBe('Hello  world.');
});
test('display rule and sentence parser omit pronunciation cues without changing quote classification',()=>{
  const text='[pronounce:Elys|Eleese] Elys waited. “[speaker:Elys] Hello.”';
  expect(text.replace(new RegExp(CUE_PATTERN,'gi'),'')).toBe(' Elys waited. “ Hello.”');
  expect(parseSegments(text,'Elys').map(s=>s.speaker)).toEqual(['narrator','Elys']);
});
function fixture(){const files=new Map<string,string>();let fail=false;return {files,fail:()=>fail=true,store:new PronunciationStore({read:async(u,c)=>files.get(JSON.stringify([u,c])),write:async(u,c,value)=>{if(fail)throw new Error('mock write failed');files.set(JSON.stringify([u,c]),value)}})}}
test('manual corrections persist across restart and stay isolated by story and user',async()=>{
  const f=fixture();await f.store.learn('one','story','[pronounce:Elys|Ellis] Elys.');await f.store.save('one','story',entry);
  await f.store.learn('one','story','[pronounce:Elys|Elise] Elys.');
  const restart=new PronunciationStore({read:async(u,c)=>f.files.get(JSON.stringify([u,c])),write:async()=>{}});
  expect((await restart.get('one','story')).elys.spokenAs).toBe('Eleese');expect(Object.keys(await restart.get('two','story'))).toHaveLength(0);expect(Object.keys(await restart.get('one','other'))).toHaveLength(0);
});
test('concurrent automatic completion and correction serialize without losing the correction',async()=>{
  const f=fixture();await Promise.all([f.store.learn('one','story','[pronounce:Elys|Ellis] Elys.'),f.store.save('one','story',entry),f.store.learn('one','story','[pronounce:Elys|Elise] Elys.')]);
  expect((await f.store.get('one','story')).elys.spokenAs).toBe('Eleese');
});
test('failed saves and malformed storage preserve previous data rather than resetting it',async()=>{
  const f=fixture();await f.store.save('one','story',entry);f.fail();await expect(f.store.save('one','story',{...entry,spokenAs:'Ellis'})).rejects.toThrow();expect((await f.store.get('one','story')).elys.spokenAs).toBe('Eleese');
  f.files.set(JSON.stringify(['one','broken']),'{bad');await expect(f.store.save('one','broken',entry)).rejects.toThrow('preserved');expect(f.files.get(JSON.stringify(['one','broken']))).toBe('{bad');
  f.files.set(JSON.stringify(['one','invalid']),'null');await expect(f.store.save('one','invalid',entry)).rejects.toThrow('preserved');expect(f.files.get(JSON.stringify(['one','invalid']))).toBe('null');
});
test('aliases cannot silently steal another name and removal persists',async()=>{
  const f=fixture();await f.store.save('one','story',entry);
  await expect(f.store.save('one','story',{name:'Rowan',spokenAs:'Roe-an',aliases:['Elys-04']})).rejects.toThrow('already belongs');
  await expect(f.store.save('one','story',{name:'Rowan',spokenAs:'Roe-an',aliases:['<gasp>']})).rejects.toThrow('Enter a name');
  await f.store.remove('one','story','Elys');expect(Object.keys(await f.store.get('one','story'))).toHaveLength(0);
});
test('untrusted entries are bounded and cannot insert tags or prototype properties',()=>{
  expect(normalizePronunciations({bad:{name:'Elys',spokenAs:'<gasp>'},proto:{name:'constructor',spokenAs:'test'}})).toEqual({});
  const many=Object.fromEntries(Array.from({length:600},(_,i)=>['n'+i,{name:'NPC '+i,spokenAs:'Person'}]));expect(Object.keys(normalizePronunciations(many))).toHaveLength(500);
});
test('large casts keep injected prompt data bounded while all stored names still apply',()=>{
  const many=normalizePronunciations(Object.fromEntries(Array.from({length:500},(_,i)=>['n'+i,{name:'NPC '+i,spokenAs:'Person',aliases:['A long alias for person '+i]}])));
  expect(pronunciationInstruction(many).length).toBeLessThan(4800);expect(applyPronunciations('NPC 0 and NPC 499',many)).toBe('Person and Person');
});
test('long pronunciation expansions split safely without dropping audio or rewriting marker text',()=>{
  const text=('Xi '.repeat(150)).trim()+'.',rules=normalizePronunciations({xi:{name:'Xi',spokenAs:'Extraordinary person with an extraordinarily lengthy name'}});
  const segments=parseSegments(text),passages=planSpeech(segments,DEFAULTS,{characters:[],pronunciations:rules});
  expect(passages.every(p=>p.segment.text.length<=3000)).toBe(true);
  expect(passages.map(p=>p.segment.text).join(' ')).toBe(applyPronunciations(text,rules));
  expect(passages.flatMap(p=>p.segments).every(s=>s.text===text)).toBe(true);
});
