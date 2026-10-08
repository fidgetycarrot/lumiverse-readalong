import {test,expect} from 'bun:test';
import {AutomaticPlayback} from '../src/automatic-playback';
import {normalizeSettings} from '../src/shared';

const ready={enabled:true,automatic:true,ready:true,busy:false};
test('automatic playback is a separate saved opt-in, never inherited from legacy autoplay',()=>{
  expect(normalizeSettings({}).automaticPlayback).toBe(false);
  expect(normalizeSettings({autoPlay:true}).automaticPlayback).toBe(false);
  expect(normalizeSettings({automaticPlayback:'true'}).automaticPlayback).toBe(false);
  expect(normalizeSettings({automaticPlayback:true}).automaticPlayback).toBe(true);
  expect(normalizeSettings({automaticPlayback:true}).enabled).toBe(false);
});
test('a fresh reading starts only once when its buffer becomes playable',()=>{
  const start=new AutomaticPlayback();start.arm();
  expect(start.take({...ready,ready:false})).toBe(false);
  expect(start.take({...ready,busy:true})).toBe(false);
  expect(start.take(ready)).toBe(true);
  // Later preparation updates, a blocked start and a completed recording cannot retry.
  expect(start.take(ready)).toBe(false);
  expect(start.take({...ready,ready:false})).toBe(false);
  expect(start.take(ready)).toBe(false);
});
test('off and manual mode cannot start audio; a later reply can start in automatic mode',()=>{
  const start=new AutomaticPlayback();start.arm();
  expect(start.take({...ready,enabled:false})).toBe(false);
  expect(start.take({...ready,automatic:false})).toBe(false);
  start.cancel();expect(start.take(ready)).toBe(false);
  start.arm();expect(start.take(ready)).toBe(true);
});
test('pause, stop, preview and refresh restoration do not rearm automatic playback',()=>{
  const start=new AutomaticPlayback();start.arm();start.cancel();
  expect(start.take(ready)).toBe(false);
  start.arm(false);expect(start.take(ready)).toBe(false);
  start.arm();expect(start.take(ready)).toBe(true);
  start.cancel();expect(start.take(ready)).toBe(false);
});
