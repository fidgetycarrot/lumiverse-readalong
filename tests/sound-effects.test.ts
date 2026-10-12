import {test,expect} from 'bun:test';
import {soundCues} from '../src/sound-effects';
test('describes sounds the story mentions, in order, once per kind',()=>{
  const cues=soundCues('She crossed the room and drew the bolt. A kettle hissed behind the curtain. Then a knock at the door, and another knock at the door.');
  expect(cues.map(c=>c.query)).toEqual(['door bolt latch','kettle whistle','knock on wooden door']);
  expect(cues[0].at).toBeGreaterThan(0);expect(cues[2].at).toBeLessThan(1);
});
test('ordinary prose gets no sound',()=>{
  expect(soundCues('"Sit," she said. "Tell me what you found."')).toEqual([]);
});
