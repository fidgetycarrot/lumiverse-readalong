import {test,expect} from 'bun:test';
import {normalizeSettings} from '../src/shared';
import {migrateStoryCasts,castView,setCastEntry,claimEarlier,copyCast,otherStories,namesElsewhere,noteStory,EARLIER} from '../src/story-cast';
const v=(voice:string,extra={})=>({voice,emotion:'neutral',delivery:'normal',...extra});

test('old named voices move to the earlier pool; library voices and You stay shared',()=>{
  const s=normalizeSettings({personaName:'Aldric',assignments:{'id:c1':v('Leda'),'name:elys':v('Puck',{name:'Elys'}),'name:aldric':v('Orus')}});
  expect(migrateStoryCasts(s)).toBe(true);expect(migrateStoryCasts(s)).toBe(false);
  expect(Object.keys(s.assignments).sort()).toEqual(['id:c1','name:aldric']);
  expect(s.stories[EARLIER].names['name:elys'].voice).toBe('Puck');
  const again=normalizeSettings(s);migrateStoryCasts(again);expect(again).toEqual(s);
});
test('a story sees shared voices plus only its own names',()=>{
  const s=normalizeSettings({assignments:{'id:c1':v('Leda')}});
  setCastEntry(s,'chatA','name:elys',v('Puck',{name:'Elys'}));
  setCastEntry(s,'chatB','name:guard',v('Fenrir'));
  expect(Object.keys(castView(s,'chatA').assignments).sort()).toEqual(['id:c1','name:elys']);
  expect(Object.keys(castView(s,'chatB').assignments).sort()).toEqual(['id:c1','name:guard']);
  expect(Object.keys(castView(s,'chatC').assignments)).toEqual(['id:c1']);
  setCastEntry(s,'chatA','name:elys',undefined);expect(castView(s,'chatA').assignments['name:elys']).toBeUndefined();
  setCastEntry(s,'chatA','id:c2',v('Kore'));expect(s.assignments['id:c2'].voice).toBe('Kore');expect(s.stories.chatA.members).toEqual(['id:c2']);
  const again=normalizeSettings(s);expect(again.stories.chatB.names['name:guard'].voice).toBe('Fenrir');
});
test('opening a story for the first time brings in the old voices it mentions, once',()=>{
  const s=normalizeSettings({assignments:{'name:elys':v('Puck',{name:'Elys'}),'name:brakka':v('Orus',{name:'Brakka',aliases:['the smith']}),'id:c2':v('Kore')}});
  migrateStoryCasts(s);const chars=[{id:'c2',name:'Wulfgar'}];
  expect(claimEarlier(s,'elysStory',['Elys smiled.','Wulfgar nodded.'],chars).sort()).toEqual(['Elys','Wulfgar']);
  expect(Object.keys(s.stories.elysStory.names)).toEqual(['name:elys']);expect(s.stories.elysStory.members).toEqual(['id:c2']);
  expect(claimEarlier(s,'other',['The smith hammered on.'],chars)).toEqual(['Brakka']);
  expect(claimEarlier(s,'elysStory',['Brakka'],chars)).toEqual([]);
  expect(claimEarlier(s,'fresh',['Nobody here. Elysium is a word.'],chars)).toEqual([]);
  expect(s.stories.fresh.names).toEqual({});
});
test('a new story can copy a cast, with matching main characters offered first',()=>{
  const s=normalizeSettings({});
  setCastEntry(s,'a','name:elys',v('Puck'));noteStory(s,'a',{characterId:'c9',title:'Old road'});
  setCastEntry(s,'b','name:guard',v('Fenrir'));noteStory(s,'b',{characterId:'c1',title:'Keep'});
  expect(otherStories(s,'new','c1').map(o=>o.title)).toEqual(['Keep','Old road']);
  expect(copyCast(s,'a','new')).toBe(1);expect(copyCast(s,'a','new')).toBe(0);
  expect(namesElsewhere(s,'new').map(n=>n.name)).toEqual(['guard']);
});
