import {test,expect} from 'bun:test';
import {autoCast,pickVoice} from '../src/auto-cast';
import {normalizeSettings,DEFAULTS,voiceGender,GEMINI_VOICES} from '../src/shared';

const settings=normalizeSettings({...DEFAULTS,voice:'Kore',narratorVoice:'Charon',assignments:{'id:c1':{voice:'Leda'},'name:jason':{voice:'Fenrir',name:'Jason'}}});
const input=(speakers:string[],genders:Record<string,'f'|'m'>)=>({speakers,voices:GEMINI_VOICES,genderOfVoice:(v:string)=>voiceGender(settings,v),genderOf:(n:string)=>genders[n],needsVoice:(n:string)=>!['Maren','Jason'].includes(n)});

test('new side characters get an unused voice of the right gender, and keep a stable pick',()=>{
  const added=autoCast(settings,input(['Maren','Nyra','Odo','Jason'],{Nyra:'f',Odo:'m'}));
  expect(Object.keys(added)).toEqual(['name:nyra','name:odo']);
  expect(voiceGender(settings,added['name:nyra'].voice)).toBe('f');expect(voiceGender(settings,added['name:odo'].voice)).toBe('m');
  for(const used of ['Kore','Charon','Leda','Fenrir'])expect(Object.values(added).map(a=>a.voice)).not.toContain(used);
  expect(added['name:nyra']).toMatchObject({name:'Nyra',gender:'f',auto:true});
  expect(autoCast(settings,input(['Nyra'],{Nyra:'f'}))['name:nyra'].voice).toBe(added['name:nyra'].voice);
});
test('nobody is cast without a known gender, and two new people do not share a voice when others are free',()=>{
  expect(autoCast(settings,input(['Stranger'],{}))).toEqual({});
  const two=autoCast(settings,input(['Ann','Bea'],{Ann:'f',Bea:'f'}));
  expect(two['name:ann'].voice).not.toBe(two['name:bea'].voice);
});
test('when every voice is taken, the least used one is reused',()=>{
  expect(pickVoice('X',['A','B'],['A','A','B'])).toBe('B');
  expect(pickVoice('X',[],[])).toBeUndefined();
});
test('cast rows keep gender, aliases and the picked-for-you mark',()=>{
  const s=normalizeSettings({assignments:{'name:ann':{voice:'Kore',gender:'f',auto:true,aliases:['Annie',' ','narrator']},'name:x':{voice:'',gender:'q'}}});
  expect(s.assignments['name:ann']).toMatchObject({gender:'f',auto:true,aliases:['Annie']});
  expect(s.assignments['name:x'].gender).toBeUndefined();expect(s.autoVoices).toBe(true);
});
