import {test,expect} from 'bun:test';
import {earlyPlaybackPrefix} from '../src/early-playback';
import {DEFAULTS,normalizeSettings} from '../src/shared';
test('early playback requires the opening 75% by text and thirty buffered seconds',()=>{
  const texts=['x'.repeat(40),'x'.repeat(35),'x'.repeat(25)];
  expect(earlyPlaybackPrefix(texts,[{duration:20},{duration:15},undefined])).toBe(2);
  expect(earlyPlaybackPrefix(texts,[{duration:10},{duration:15},undefined])).toBe(0);
  expect(earlyPlaybackPrefix(['a'.repeat(74),'b'.repeat(26)],[{duration:50},undefined])).toBe(0);
});
test('out-of-order responses never enable playback over a missing opening passage',()=>{
  expect(earlyPlaybackPrefix(['first','second','last'],[undefined,{duration:100},{duration:100}])).toBe(0);
  expect(earlyPlaybackPrefix(['a'.repeat(90),'b','c'],[{duration:50},undefined,{duration:50}])).toBe(1);
});
test('complete recordings and short single-file messages need no artificial delay',()=>{
  expect(earlyPlaybackPrefix(['short'],[{duration:2}])).toBe(1);
  expect(earlyPlaybackPrefix(['single'],[undefined])).toBe(0);
});
test('users can retain full preparation before Play without enabling Readalong',()=>{
  expect(normalizeSettings({...DEFAULTS,earlyPlayback:false}).earlyPlayback).toBe(false);
  expect(normalizeSettings({}).enabled).toBe(false);
});
