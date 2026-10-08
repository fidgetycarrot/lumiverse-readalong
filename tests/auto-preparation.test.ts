import {test,expect} from 'bun:test';
import {CompletionRegistry,CompletionInbox,type CompletedReply} from '../src/auto-preparation';
const reply=(id:string,at:number,chatId='chat'):CompletedReply=>({chatId,messageId:id,generationId:'g-'+id,completedAt:at,message:{id,content:'A new reply.',name:'Mara',isUser:false}});
test('a completion during setup waits for settings and is prepared after initialization',()=>{
  const inbox=new CompletionInbox(100);expect(inbox.receive(reply('new',110))).toBe(true);
  expect(inbox.take('chat')).toBeUndefined();inbox.initialize(true);expect(inbox.take('chat')?.message.id).toBe('new');expect(inbox.take('chat')).toBeUndefined();
});
test('fresh off settings discard queued setup completions',()=>{
  const inbox=new CompletionInbox(100);inbox.receive(reply('new',110));inbox.initialize(false);
  expect(inbox.take('chat')).toBeUndefined();expect(inbox.receive(reply('off',120))).toBe(false);
});
test('return checks cannot recover replies from before refresh, off/on or chat switching',()=>{
  const inbox=new CompletionInbox(100);inbox.initialize(true);
  expect(inbox.receive(reply('old',99))).toBe(false);inbox.setEnabled(false,110);inbox.setEnabled(true,130);
  expect(inbox.receive(reply('off',120))).toBe(false);expect(inbox.receive(reply('new',140))).toBe(true);
  inbox.reset(150);expect(inbox.take('chat')).toBeUndefined();expect(inbox.receive(reply('other-chat-history',140))).toBe(false);
});
test('several completions queued during setup retain only the latest per chat',()=>{
  const inbox=new CompletionInbox(100);for(let i=1;i<=12;i++)inbox.receive(reply(String(i),100+i));
  expect(inbox.receive(reply('late-old',105))).toBe(false);inbox.initialize(true);
  expect(inbox.take('chat')?.message.id).toBe('12');expect(inbox.take('chat')).toBeUndefined();
});
test('user messages and another chat do not become the active reply',()=>{
  const inbox=new CompletionInbox(100);inbox.initialize(true);
  const user=reply('user',110);user.message.isUser=true;expect(inbox.receive(user)).toBe(false);
  inbox.receive(reply('other',110,'elsewhere'));expect(inbox.take('chat')).toBeUndefined();
});
test('background completion metadata is isolated by owner and excluded by session boundary',()=>{
  const registry=new CompletionRegistry(()=>200);registry.remember('one',reply('new',180));
  expect(registry.latest('one','chat',100)?.generationId).toBe('g-new');
  expect(registry.latest('one','chat',100)).not.toHaveProperty('message');
  expect(registry.latest('two','chat',100)).toBeUndefined();expect(registry.latest('one','other',100)).toBeUndefined();expect(registry.latest('one','chat',190)).toBeUndefined();
});
test('completion history is bounded, expires, and cannot be replaced by an older event',()=>{
  let now=200;const registry=new CompletionRegistry(()=>now,100,2);
  registry.remember('one',reply('new',180));registry.remember('one',reply('old',170));expect(registry.latest('one','chat',100)?.messageId).toBe('new');
  registry.remember('one',reply('two',180,'two'));registry.remember('one',reply('three',180,'three'));
  expect(registry.latest('one','chat',100)).toBeUndefined();now=300;expect(registry.latest('one','three',100)).toBeUndefined();
});
