import {test,expect} from 'bun:test';
import {findPeople} from '../src/people';
test('finds people who speak or are called she or he, with their gender',()=>{
  const story=[
    'Zoe leaned against the railing. She tucked her hair behind her ear. "We should go," Zoe said.',
    'Marcus checked his watch. He frowned at the sky over London. "Ten minutes," he said.',
    'The rain over London kept falling. Elliot shrugged.'];
  const people=findPeople(story,['Elliot']);
  expect(people).toContainEqual({name:'Zoe',gender:'f'});
  expect(people).toContainEqual({name:'Marcus',gender:'m'});
  expect(people.map(p=>p.name)).not.toContain('London');
  expect(people.map(p=>p.name)).not.toContain('Elliot');
  expect(people.map(p=>p.name)).not.toContain('The');
});
test('pronouns inside dialogue and crowded sentences do not count',()=>{
  const people=findPeople(['Ava and Ben argued. She was furious.','"He lied to her," Ava said. Ava paced.']);
  expect(people.find(p=>p.name==='Ava')).toEqual({name:'Ava'});
  expect(people.find(p=>p.name==='Ben')).toBeUndefined();
});
test('one-off capitalised sentence starts are not people',()=>{
  expect(findPeople(['Somewhere a dog barked. Thunder rolled. Rain hit the glass.'])).toEqual([]);
});

import {planMessageSpeech} from '../src/playback-plan';
import {normalizeSettings} from '../src/shared';
import {castView,setStoryYou,setStoryteller,setLead,setCastEntry} from '../src/story-cast';
test('a storyteller card gives its lines to the people in the story, not to itself',()=>{
  const s=normalizeSettings({voice:'Kore',narratorVoice:'Autonoe',npcVoice:'Callirrhoe',personaName:'Jason Slatz',assignments:{'id:card':{voice:'Puck'}}});
  setStoryteller(s,'card',true);
  setCastEntry(s,'chat','name:zoe',{voice:'Leda',emotion:'neutral',delivery:'normal',name:'Zoe'});
  setStoryYou(s,'chat','Elliot');
  const view=castView(s,'chat');expect(view.personaName).toBe('Elliot');
  const message={id:'m',name:'The Split Fiction',isUser:false,characterId:'card',content:'Zoe grinned at Elliot. "Race you."\nThe wind picked up. "Not fair," someone muttered.'};
  const context={characters:[{id:'card',name:'The Split Fiction'}],characterId:'card',storyteller:true,lead:'Everyone else',people:[{name:'Zoe'}]};
  const voices=planMessageSpeech(message,view,context).map(p=>[p.segments.map(x=>x.speaker).join('+'),p.voice]);
  expect(voices).toContainEqual(['Zoe','Leda']);
  expect(voices.flat()).not.toContain('Puck');
  expect(voices.some(([speaker,voice])=>speaker==='Everyone else' && voice==='Callirrhoe')).toBe(true);
  setLead(s,'chat','Zoe');
  const led=planMessageSpeech(message,castView(s,'chat'),{...context,lead:'Zoe'}).map(p=>p.voice);
  expect(led.filter(v=>v==='Leda').length).toBeGreaterThan(0);expect(led).not.toContain('Callirrhoe');
});
test('your name can differ per story and keeps your voice',()=>{
  const s=normalizeSettings({personaName:'Jason Slatz',assignments:{'name:jason slatz':{voice:'Sadaltager'}}});
  setStoryYou(s,'chat','Elliot');
  expect(castView(s,'chat').assignments['name:elliot'].voice).toBe('Sadaltager');
  expect(castView(s,'other').personaName).toBe('Jason Slatz');
  setStoryYou(s,'chat','');expect(castView(s,'chat').personaName).toBe('Jason Slatz');expect(s.stories.chat.names['name:elliot']).toBeUndefined();
  const saved=normalizeSettings(JSON.parse(JSON.stringify({...s,storytellers:['card']})));expect(saved.storytellers).toEqual(['card']);
});
test('an object pronoun about someone else does not hide a clear gender',()=>{
  expect(findPeople(['Zoe hopped the last three steps. She laughed and shook the water from her boots.','Zoe waved him off. She pointed toward the lighthouse.'])).toContainEqual({name:'Zoe',gender:'f'});
});
test('status blocks and ordinary capitalised words are not people',()=>{
  const story=[
    'Height: 5\'6". Eyes: green. Skin: pale. From: the coast.\nZoe stretched by the window. She glanced at Elliot. Early light scraped across her skin.',
    'By noon the rain had stopped. Scraped knees and bruised pride, she thought. Eyes on the road, Zoe told herself.',
    'Vane stepped out of the shadows. He tipped his hat at Zoe. From the doorway, he watched her go. "Evening," Vane said.'];
  const names=findPeople(story,['Elliot']).map(p=>p.name).sort();
  expect(names).toEqual(['Vane','Zoe']);
});
