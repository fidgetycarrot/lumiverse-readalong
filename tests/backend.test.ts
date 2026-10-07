import { describe,test,expect } from 'bun:test';
import { DEFAULTS } from '../src/shared';
const files=new Map<string,string>(),keys=new Map<string,string>(),rules:any[]=[];
const outgoing:any[]=[],requests:any[]=[];
let handler:(p:any,user:string,session?:string)=>Promise<void>, interceptor:(messages:any[],ctx:any)=>Promise<any[]>;
const listeners=new Map<string,Function>();
let failure=false;
let hiddenJson=false, diagnosticStatus=402;
let keyStatus=200, keyRemaining:number|null=null;
let messageReads=0;
(globalThis as any).spindle={
  onFrontendMessage:(h:any)=>{handler=h},sendToFrontend:(p:any,u:string,o:any)=>outgoing.push({p,u,o}),
  on:(event:string,h:Function)=>{listeners.set(event,h);return()=>{}},
  registerInterceptor:(h:any)=>{interceptor=h},log:{info:()=>{}},
  permissions:{has:()=>true,getGranted:async()=>['cors_proxy','characters','chats','chat_mutation','generation','regex_scripts','interceptor']},
  userStorage:{exists:async(path:string,u:string)=>files.has(u+path),read:async(path:string,u:string)=>files.get(u+path),write:async(path:string,value:string,u:string)=>{files.set(u+path,value)}},
  enclave:{has:async(k:string,u:string)=>keys.has(u+k),put:async(k:string,v:string,u:string)=>keys.set(u+k,v),get:async(k:string,u:string)=>keys.get(u+k),delete:async(k:string,u:string)=>keys.delete(u+k)},
  regex_scripts:{list:async()=>({data:rules,total:rules.length}),create:async(r:any)=>{const s={...r,id:'rule',can_mutate:true};rules.push(s);return s},update:async()=>{}},
  characters:{list:async()=>({data:[{id:'mara',name:'Mara'}]})},
  chats:{get:async(id:string,u:string)=>id===`${u}-chat`?{id}:null},
  chat:{getMessages:async()=>{messageReads++;return[{id:'m1',name:'Mara',is_user:false,content:'Hello.'}]}},
  cors:async(url:string,options:any)=>{
    requests.push({url,options});
    if(failure)throw new Error('Bearer sk-or-v1-secret failed');
    if(url.endsWith('/key'))return{status:keyStatus,body:JSON.stringify(keyStatus===200?{data:{limit:keyRemaining===null?null:10,limit_remaining:keyRemaining}}:{error:{message:'Invalid key sk-or-v1-secret'}})};
    if(url.endsWith('/audio/speech') && hiddenJson) {
      if(options?.responseType==='arraybuffer')throw new Error('CORS proxy transparent proxy only serves audio data (received Content-Type: application/json)');
      return{status:diagnosticStatus,headers:{'content-type':'application/json'},body:JSON.stringify({error:{message:'Insufficient credits sk-or-v1-secret',metadata:{raw:'must not escape'}}})};
    }
    if(url.includes('models'))return{status:200,body:JSON.stringify({data:[{id:DEFAULTS.model,name:'Gemini',architecture:{output_modalities:['speech']},supported_voices:['Kore','Puck']},{id:'text-only',architecture:{output_modalities:['text']}}]})};
    return{status:200,headers:{'content-type':'audio/mpeg'},encoding:'base64',body:'SUQzBAAAAA=='};
  },
};
await import('../src/backend');
let seq=0;
async function call(type:string,data:any={},user='one',session='tab1'){
  const requestId=String(++seq);await handler({type,requestId,...data},user,session);
  return outgoing.find(r=>r.p.requestId===requestId);
}
describe('backend provider and session integration',()=>{
  test('startup installs a display-only hide rule',async()=>{
    const r=await call('init');expect(rules).toHaveLength(1);expect(rules[0].target).toBe('display');expect(r.p.data.cueStatus).toBe('');
    await call('init');expect(rules).toHaveLength(1);
  });
  test('keys never enter settings or replies and are isolated by user',async()=>{
    await call('save_key',{key:'sk-or-v1-secret'});
    expect((await call('init')).p.data.hasKey).toBe(true);
    expect((await call('init',{},'two')).p.data.hasKey).toBe(false);
    expect(JSON.stringify(outgoing)).not.toContain('sk-or-v1-secret');
    expect(Array.from(files.values()).join('')).not.toContain('sk-or-v1-secret');
  });
  test('models return the complete model-specific voice list',async()=>{
    const r=await call('models');expect(r.p.data.models).toEqual([{id:DEFAULTS.model,name:'Gemini',voices:['Kore','Puck']}]);
  });
  test('operator message reads check the requesting user before reading content',async()=>{
    const before=messageReads;
    const denied=await call('message',{chatId:'two-chat',messageId:'m1'});
    expect(denied.p.error).toContain('Chat not found');expect(messageReads).toBe(before);
    const own=await call('message',{chatId:'one-chat',messageId:'m1'});
    expect(own.p.data.message.content).toBe('Hello.');expect(messageReads).toBe(before+1);
  });
  test('Gemini 3.8 gets clean dialogue and separate emotion metadata',async()=>{
    const r=await call('speech',{segment:{text:'Are you sure?',speaker:'Mara',emotion:'worried',delivery:'whispers'}});
    expect(r.p.data.mime).toBe('audio/mpeg');
    const req=requests.at(-1);expect(req.url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(JSON.parse(req.options.body)).toMatchObject({model:DEFAULTS.model,voice:'Kore',input:'Are you sure?',response_format:'mp3',provider:{options:{'google-ai-studio':{speech_metadata:{style:'worried, whispering'}}}}});
    expect(req.options.responseType).toBe('arraybuffer');
    expect(r.o.frontendSessionId).toBe('tab1');
  });
  test('a preview uses its chosen voice without overwriting saved settings',async()=>{
    await call('speech',{segment:{text:'Hello.',speaker:'Preview'},previewSettings:{...DEFAULTS,voice:'Puck'}});
    expect(JSON.parse(requests.at(-1).options.body).voice).toBe('Puck');
    expect((await call('init')).p.data.settings.voice).toBe('Kore');
  });
  test('unsupported TTS models receive clean text',async()=>{
    await call('speech',{segment:{text:'Hello.',emotion:'angry',delivery:'shouts'},previewSettings:{...DEFAULTS,model:'mistralai/voxtral-mini-tts-2603'}});
    expect(JSON.parse(requests.at(-1).options.body).input).toBe('Hello.');
  });
  test('prompt cues reuse the existing generation rather than making a model call',async()=>{
    const n=requests.length;const messages=[{role:'user',content:'Hello'}];
    const result=await interceptor(messages,{userId:'one'});expect(result[0].role).toBe('system');expect(result[0].content).toContain('[emotion:');expect(requests.length).toBe(n);
    await call('save',{settings:{...DEFAULTS,promptEmotions:false}});expect(await interceptor(messages,{userId:'one'})).toEqual(messages);
  });
  test('failed request errors redact secrets',async()=>{
    failure=true;const r=await call('speech',{segment:{text:'Hi.'}});failure=false;
    expect(r.p.error).not.toContain('sk-or-v1-secret');expect(r.p.error).toContain('[redacted]');
  });
  test('a rejected JSON reply is explained without an automatic speech retry',async()=>{
    hiddenJson=true;
    const before=requests.length;const r=await call('speech',{segment:{text:'Hi.'}});
    expect(requests.length).toBe(before+1);expect(r.p.error).toContain('JSON error instead of audio');
    expect(r.p.error).not.toContain('transparent proxy');expect(r.p.canDiagnoseSpeech).toBe(true);
  });
  test('a connection check makes only a key lookup and no speech request',async()=>{
    const before=requests.length;const r=await call('check_connection');
    expect(requests.length).toBe(before+1);expect(requests.at(-1).url).toBe('https://openrouter.ai/api/v1/key');
    expect(requests.at(-1).options.body).toBeUndefined();expect(r.p.data.message).toContain('accepts your saved key');
    expect(JSON.stringify(r)).not.toContain('sk-or-v1-secret');
  });
  test('key checks expose authentication errors and spending-limit exhaustion',async()=>{
    keyStatus=401;const bad=await call('check_connection');keyStatus=200;
    expect(bad.p.error).toContain('HTTP 401');expect(bad.p.error).not.toContain('sk-or-v1-secret');
    keyRemaining=0;const empty=await call('check_connection');keyRemaining=null;
    expect(empty.p.error).toContain('spending limit');
  });
  test('a failed voice diagnostic cannot be triggered by another user or tab',async()=>{
    const before=requests.length;
    expect((await call('diagnose_speech',{},'one','tab2')).p.error).toContain('No recent');
    expect((await call('diagnose_speech',{},'two','tab1')).p.error).toContain('No recent');
    expect(requests.length).toBe(before);
  });
  test('an explicit diagnostic reveals the provider error once and redacts its key',async()=>{
    const before=requests.length;const r=await call('diagnose_speech');
    expect(requests.length).toBe(before+1);expect(requests.at(-1).options.responseType).toBe('text');
    expect(r.p.error).toContain('HTTP 402');expect(r.p.error).toContain('Insufficient credits');
    expect(r.p.error).not.toContain('sk-or-v1-secret');expect(r.p.error).not.toContain('must not escape');
    expect(r.p.canDiagnoseSpeech).toBe(false);
    await call('diagnose_speech');expect(requests.length).toBe(before+1);
  });
  test('stale failures cannot be retried by the diagnostic',async()=>{
    await call('speech',{segment:{text:'Hi.'}});const before=requests.length;
    const original=Date.now;Date.now=()=>original()+11*60*1000;
    try {expect((await call('diagnose_speech')).p.error).toContain('No recent')}finally{Date.now=original}
    expect(requests.length).toBe(before);
  });
  test('successful speech clears the diagnostic for an earlier failed request',async()=>{
    await call('speech',{segment:{text:'Hi.'}});hiddenJson=false;
    const r=await call('speech',{segment:{text:'Hi.'}});expect(r.p.canDiagnoseSpeech).toBe(false);
  });
});
