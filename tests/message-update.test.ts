import {test,expect} from 'bun:test';
import {readingChanged} from '../src/message-update';
const current={id:'reply',content:'She stopped. “Wait.”',name:'Mara',isUser:false};

test('saving stock TTS audio and images does not invalidate an unchanged reading',()=>{
  for(const type of ['audio','image'])expect(readingChanged(current,{...current,is_user:false,extra:{attachments:[{type,image_id:'attachment'}]},swipes:[current.content],swipe_id:0})).toBe(false);
});
test('metadata updates also preserve user-message readings',()=>{
  const user={...current,name:'Jason Slatz',isUser:true};
  expect(readingChanged(user,{id:user.id,name:user.name,content:user.content,is_user:true,extra:{attachment:'image'}})).toBe(false);
});
test('actual text, speaker and role edits invalidate the reading',()=>{
  expect(readingChanged(current,{...current,content:'New words.'})).toBe(true);
  expect(readingChanged(current,{...current,name:'Another speaker'})).toBe(true);
  expect(readingChanged(current,{...current,isUser:true})).toBe(true);
  expect(readingChanged(current,{...current,isUser:false,is_user:true})).toBe(true);
});
test('incomplete or unrelated edit payloads require an owned-message lookup',()=>{
  for(const payload of [undefined,null,'text',{messageId:'reply'},{id:'reply',extra:{}},{id:'other',content:current.content},{id:'reply',content:12}])expect(readingChanged(current,payload)).toBeUndefined();
});
test('missing optional metadata does not imply a speaker or role change',()=>{
  expect(readingChanged(current,{id:current.id,content:current.content})).toBe(false);
});
