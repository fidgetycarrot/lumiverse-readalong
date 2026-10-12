import {test,expect} from 'bun:test';
import {attributeQuotes,buildRoster,canonicalSpeaker,looksLikeName} from '../src/speaker-detect';

const quotes=(text:string)=>[...text.matchAll(/"[^"\n]*"|“[^”\n]*”/g)].map(m=>({start:m.index!,end:m.index!+m[0].length}));
const who=(text:string,entries=[{name:'Maren Holt'},{name:'Jason'},{name:'Rook'},{name:'Scott',aliases:['the sergeant']}])=>attributeQuotes(text,quotes(text),buildRoster(entries));

test('labels name the speaker, including new people',()=>{
  expect(who('Jason: "Hold the door."\n**Innkeeper:** "We are closed."')).toEqual(['Jason','Innkeeper']);
});
test('dialogue tags after and before a quote',()=>{
  expect(who('"You came back," Maren said.')).toEqual(['Maren Holt']);
  expect(who('"Later," said Jason.')).toEqual(['Jason']);
  expect(who('"Move," the sergeant snapped.')).toEqual(['Scott']);
  expect(who('Rook asked quietly, "Where?"')).toEqual(['Rook']);
  expect(who('"Who goes there?" Odo shouted.')).toEqual(['Odo']);
});
test('action beats on either side',()=>{
  expect(who('"Sit." Maren pointed at the chair.')).toEqual(['Maren Holt']);
  expect(who('Jason leaned on the bar. "Long night?"')).toEqual(['Jason']);
});
test('the only named character in a paragraph, and later quotes in that paragraph',()=>{
  expect(who('The fire cracked while Rook warmed his hands. "Cold." He blew on them. "Very cold."')).toEqual(['Rook','Rook']);
});
test('names spoken inside a quote are not the speaker',()=>{
  expect(who('"Maren, wait!" Jason called.')).toEqual(['Jason']);
  expect(who('"Jason?"')).toEqual([undefined]);
});
test('a bare back-and-forth alternates between two speakers',()=>{
  expect(who('"Ready?" Maren asked.\n"Always," Jason said.\n"Then go."\n"Going."')).toEqual(['Maren Holt','Jason','Maren Holt','Jason']);
});
test('narration breaks the back-and-forth',()=>{
  expect(who('"Ready?" Maren asked.\n"Always," Jason said.\nThe wind rose over the hill and the lamps guttered out one by one.\n"Now what?"')).toEqual(['Maren Holt','Jason',undefined]);
});
test('unknown quotes stay unknown, so the reply keeps its own character',()=>{
  expect(who('The road was long. "We should rest."')).toEqual([undefined]);
});
test('roster spellings: unique first names and aliases reach one voice',()=>{
  const roster=buildRoster([{name:'Maren Holt'},{name:'Scott',aliases:['The Sergeant']},{name:'Anna Lee'},{name:'Anna Bell'}]);
  expect(canonicalSpeaker(roster,'maren')).toBe('Maren Holt');
  expect(canonicalSpeaker(roster,'the sergeant')).toBe('Scott');
  expect(canonicalSpeaker(roster,'Anna')).toBeUndefined();
  expect(looksLikeName('Then')).toBe(false);expect(looksLikeName('Old Tom')).toBe(true);
});
test('a common word is not mistaken for a capitalised name',()=>{
  expect(who('"Nice," Grace said.',[{name:'Grace'}])).toEqual(['Grace']);
  expect(who('She moved with grace. "Nice."',[{name:'Grace'}])).toEqual([undefined]);
});

import {parseSegments} from '../src/shared';
test('parsing gives detected speakers to quotes, and a cue still wins',()=>{
  const roster=buildRoster([{name:'Maren'},{name:'Jason'}]);
  const speakers=(text:string)=>parseSegments(text,'Maren',undefined,roster).map(s=>`${s.speaker}:${s.text}`);
  expect(speakers('"Hold on," Jason said. "Wait."')).toEqual(['Jason:"Hold on,"','narrator:Jason said.','Jason:"Wait."']);
  expect(speakers('"[speaker:Maren]Fine," Jason said.')[0]).toBe('Maren:"Fine,"');
  expect(speakers('"Hello."')).toEqual(['Maren:"Hello."']);
});
