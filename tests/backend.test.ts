import { describe,test,expect } from 'bun:test';
import { DEFAULTS as GEMINI_DEFAULTS } from '../src/shared';
import manifest from '../spindle.json';
const granted=new Set<string>(manifest.permissions);
const DEFAULTS={...GEMINI_DEFAULTS,enabled:true,model:'mistralai/voxtral-mini-tts-2603'};
const files=new Map<string,string>(),keys=new Map<string,string>(),rules:any[]=[];
const outgoing:any[]=[],requests:any[]=[];
let handler:(p:any,user:string,session?:string)=>Promise<void>, interceptor:(messages:any[],ctx:any)=>Promise<any[]>;
const listeners=new Map<string,Function>();
let failure=false,arbitraryFailure=false,saveFailure=false;
let hiddenJson=false, diagnosticStatus=402;
let keyStatus=200, keyRemaining:number|null=null;
let messageReads=0;
(globalThis as any).spindle={
  onFrontendMessage:(h:any)=>{handler=h},sendToFrontend:(p:any,u:string,o:any)=>outgoing.push({p,u,o}),
  on:(event:string,h:Function)=>{listeners.set(event,h);return()=>{}},
  registerInterceptor:(h:any)=>{interceptor=h},log:{info:()=>{}},
  permissions:{has:(permission:string)=>granted.has(permission),getGranted:async()=>[...granted]},
  userStorage:{exists:async(path:string,u:string)=>files.has(u+path),read:async(path:string,u:string)=>files.get(u+path),write:async(path:string,value:string,u:string)=>{files.set(u+path,value)}},
  enclave:{has:async(k:string,u:string)=>keys.has(u+k),put:async(k:string,v:string,u:string)=>{if(saveFailure)throw new Error('Failed to save custom-secret-fixture');keys.set(u+k,v)},get:async(k:string,u:string)=>keys.get(u+k),delete:async(k:string,u:string)=>keys.delete(u+k)},
  regex_scripts:{list:async()=>({data:rules,total:rules.length}),create:async(r:any)=>{const s={...r,id:'rule',can_mutate:true};rules.push(s);return s},update:async()=>{}},
  characters:{list:async()=>({data:[{id:'mara',name:'Mara',extensions:{ttsVoice:{connectionId:'saved',voice:'Puck',metadata:'do-not-project'},other:'do-not-project'}}]})},
  chats:{get:async(id:string,u:string)=>[`${u}-chat`,`${u}-second-chat`].includes(id)?{id}:null},
  chat:{getMessages:async()=>{messageReads++;return[{id:'m1',name:'Mara',is_user:false,content:'Hello.'}]}},
  cors:async(url:string,options:any)=>{
    requests.push({url,options});
    if(failure)throw new Error('Bearer sk-or-v1-secret failed');
    if(arbitraryFailure)throw new Error('Rejected custom-local-fixture and '+encodeURIComponent('custom-local-fixture'));
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
async function call(type:string,data:any={},user='one',session:string|null='tab1'){
  const requestId=String(++seq);await handler({type,requestId,...data},user,session??undefined);
  return outgoing.find(r=>r.p.requestId===requestId);
}
describe('backend provider and session integration',()=>{
  test('pronunciation cues are injected by Readalong independently of emotion settings with no model request',async()=>{
    await call('save',{settings:{...DEFAULTS,promptEmotions:false}},'pronunciation-one');const before=requests.length;
    const input=[{role:'user',content:'Continue.'}],context={userId:'pronunciation-one',chatId:'pronunciation-one-chat'};
    const result=await interceptor(input,context);expect(result[0].content).toContain('[pronounce:Name|Spoken spelling]');expect(result[0].content).not.toContain('[emotion:');
    expect(await interceptor(input,{...context,generationType:'quiet'})).toEqual(input);
    await call('save',{settings:{...DEFAULTS,promptEmotions:false,promptPronunciations:false}},'pronunciation-one');expect(await interceptor(input,context)).toEqual(input);expect(requests.length).toBe(before);
  });
  test('completed introductions persist pronunciation once and manual corrections win without synthesis',async()=>{
    await call('save',{settings:DEFAULTS},'pronunciation-one');const before=requests.length;
    const complete=(id:string,as:string)=>listeners.get('GENERATION_ENDED')!({generationId:id,chatId:'pronunciation-one-chat',messageId:'m1',content:`[pronounce:Elys|${as}] Elys arrived.`},'pronunciation-one');
    await complete('pron-g1','Ellis');expect((await call('pronunciations',{chatId:'pronunciation-one-chat'},'pronunciation-one')).p.data.entries.elys.spokenAs).toBe('Ellis');
    await complete('pron-g2','Elise');expect((await call('pronunciations',{chatId:'pronunciation-one-chat'},'pronunciation-one')).p.data.entries.elys.spokenAs).toBe('Ellis');
    await call('save_pronunciation',{chatId:'pronunciation-one-chat',entry:{name:'Elys',spokenAs:'Eleese',aliases:['Elys-04']}},'pronunciation-one');
    await complete('pron-g3','Ellis');expect((await call('pronunciations',{chatId:'pronunciation-one-chat'},'pronunciation-one')).p.data.entries.elys).toMatchObject({spokenAs:'Eleese',source:'manual'});
    const prompt=await interceptor([],{userId:'pronunciation-one',chatId:'pronunciation-one-chat'});expect(prompt[0].content).toContain('Elys-04');expect(requests.length).toBe(before);
  });
  test('pronunciation RPCs enforce ownership and story isolation; client text cannot seed automatic entries',async()=>{
    for(const type of ['pronunciations','save_pronunciation','remove_pronunciation'])expect((await call(type,{chatId:'pronunciation-one-chat',userId:'pronunciation-one',entry:{name:'Elys',spokenAs:'Wrong'},name:'Elys'},'another-user')).p.error).toContain('Chat not found');
    expect((await call('pronunciations',{chatId:'pronunciation-one-second-chat'},'pronunciation-one')).p.data.entries).toEqual({});
    expect((await call('pronunciations',{chatId:'pronunciation-one-second-chat',messageId:'m1',content:'[pronounce:Fake|Fayk] Fake.'},'pronunciation-one')).p.data.entries).toEqual({});
    await call('remove_pronunciation',{chatId:'pronunciation-one-chat',name:'Elys'},'pronunciation-one');expect((await call('pronunciations',{chatId:'pronunciation-one-chat'},'pronunciation-one')).p.data.entries).toEqual({});
  });
  test('off mode and disabled automatic pronunciation do not learn new names',async()=>{
    for(const settings of [{...DEFAULTS,enabled:false},{...DEFAULTS,promptPronunciations:false}]){
      await call('save',{settings},'pronunciation-off');
      await listeners.get('GENERATION_ENDED')!({generationId:'pron-off-g',chatId:'pronunciation-off-chat',messageId:'m1',content:'[pronounce:Elys|Eleese] Elys arrived.'},'pronunciation-off');
      expect((await call('pronunciations',{chatId:'pronunciation-off-chat',messageId:'m1'},'pronunciation-off')).p.data.entries).toEqual({});
    }
  });
  test('completion delivery and recovery are available while on without making speech',async()=>{
    await call('save',{settings:DEFAULTS},'completion-one');const before=requests.length;
    listeners.get('GENERATION_STARTED')!({generationId:'complete-g1',chatId:'completion-one-chat',characterId:'mara',characterName:'Mara'},'completion-one');
    expect((await call('latest_completion',{chatId:'completion-one-chat',since:0},'completion-one')).p.data.generating).toBe(true);
    expect((await call('latest_completion',{chatId:'completion-one-chat',since:0},'someone-else')).p.data.generating).toBe(false);
    await listeners.get('GENERATION_ENDED')!({generationId:'complete-g1',chatId:'completion-one-chat',messageId:'m1',content:'A completed reply.'},'completion-one');
    const completion=(await call('latest_completion',{chatId:'completion-one-chat',since:0},'completion-one')).p.data.completion;
    expect(completion).toMatchObject({generationId:'complete-g1',messageId:'m1',name:'Mara',characterId:'mara'});
    expect(completion.content).toBeUndefined();expect(completion.message).toBeUndefined();
    expect((await call('latest_completion',{chatId:'completion-one-chat',since:0},'completion-one')).p.data.generating).toBe(false);
    expect(outgoing.find(r=>r.p.type==='new_message' && r.p.generationId==='complete-g1')?.p.autoEligible).toBe(true);
    expect(requests.length).toBe(before);
  });
  test('recovery cannot expose another user or return an earlier-session completion',async()=>{
    expect((await call('latest_completion',{chatId:'completion-one-chat',since:0,userId:'completion-one'},'someone-else')).p.data.completion).toBeNull();
    expect((await call('latest_completion',{chatId:'completion-one-chat',since:Date.now()+1000},'completion-one')).p.data.completion).toBeNull();
  });
  test('replies completed while off do not become an automatic catch-up queue',async()=>{
    await call('save',{settings:{...DEFAULTS,enabled:false}},'completion-off');
    await listeners.get('GENERATION_ENDED')!({generationId:'off-g',chatId:'completion-off-chat',messageId:'m1',content:'Generated while off.'},'completion-off');
    await call('save',{settings:DEFAULTS},'completion-off');
    expect((await call('latest_completion',{chatId:'completion-off-chat',since:0},'completion-off')).p.data.completion).toBeNull();
    expect(outgoing.find(r=>r.p.type==='new_message' && r.p.generationId==='off-g')?.p.autoEligible).toBe(false);
  });
  test('a successful completion without inline content reads its owned saved message',async()=>{
    const before=requests.length;
    await listeners.get('GENERATION_ENDED')!({generationId:'no-content-g',chatId:'completion-one-chat',messageId:'m1'},'completion-one');
    expect(outgoing.find(r=>r.p.type==='new_message' && r.p.generationId==='no-content-g')?.p.message.content).toBe('Hello.');
    expect((await call('message',{chatId:'completion-one-chat',messageId:'old',latestOnly:true},'completion-one')).p.data.message).toBeNull();
    expect(requests.length).toBe(before);
  });
  test('failed, stopped and impersonated generations do not register automatic preparation',async()=>{
    await call('save',{settings:DEFAULTS},'completion-invalid');
    for(const extra of [{error:'failed'},{generationType:'impersonate'},{generationType:'quiet'},{messageId:undefined}])await listeners.get('GENERATION_ENDED')!({generationId:'bad-g',chatId:'completion-invalid-chat',messageId:'m1',content:'Skip.',...extra},'completion-invalid');
    expect((await call('latest_completion',{chatId:'completion-invalid-chat',since:0},'completion-invalid')).p.data.completion).toBeNull();
  });
  test('fresh installs stay off and updating existing settings preserves opt-in',async()=>{
    expect((await call('init',{},'fresh')).p.data.settings.enabled).toBe(false);
    await call('save',{settings:DEFAULTS});
    expect((await call('init')).p.data.settings.enabled).toBe(true);
  });
  test('widget permission is declared and init reports actual grants after revocation',async()=>{
    expect(manifest.permissions).toContain('ui_panels');
    expect((await call('init')).p.data.permissions).toContain('ui_panels');
    granted.delete('ui_panels');
    try{expect((await call('init')).p.data.permissions).not.toContain('ui_panels')}
    finally{granted.add('ui_panels')}
  });
  test('character listing projects only IDs, names and native voice references',async()=>{
    expect((await call('characters')).p.data.characters).toEqual([{id:'mara',name:'Mara',ttsVoice:{connectionId:'saved',voice:'Puck'}}]);
  });
  test('startup installs a display-only hide rule',async()=>{
    const r=await call('init');expect(rules).toHaveLength(1);expect(rules[0].target).toBe('display');expect(r.p.data.cueStatus).toBe('');
    await call('init');expect(rules).toHaveLength(1);
  });
  test('init identifies the authenticated cache owner and a persisted claim survives reinitialization',async()=>{
    expect((await call('init')).p.data.userId).toBe('one');
    const before=requests.length,key='a'.repeat(64);
    expect((await call('claim_preparation',{key})).p.data.allowed).toBe(true);
    await call('init');expect((await call('claim_preparation',{key},'one','tab2')).p.data.allowed).toBe(false);
    await call('save',{settings:DEFAULTS},'two');
    expect((await call('claim_preparation',{key},'two')).p.data.allowed).toBe(true);
    expect((await call('claim_preparation',{key,manual:true})).p.data.allowed).toBe(true);
    expect(requests.length).toBe(before);expect(JSON.parse(files.get('onepreparations.json')!)).toContain(key);
  });
  test('keys never enter settings or replies and are isolated by user',async()=>{
    await call('save_key',{key:'sk-or-v1-secret',provider:'openrouter'});
    expect((await call('init')).p.data.hasKey).toBe(true);
    expect((await call('init',{},'two')).p.data.hasKey).toBe(false);
    expect(JSON.stringify(outgoing)).not.toContain('sk-or-v1-secret');
    expect(Array.from(files.values()).join('')).not.toContain('sk-or-v1-secret');
    await call('save',{settings:DEFAULTS});
  });
  test('a forged user ID cannot read or change another user’s key',async()=>{
    const before=keys.get('oneopenrouter_key');
    expect((await call('init',{userId:'one'},'forged')).p.data.hasKey).toBe(false);
    await call('save_key',{key:'attacker-fixture',provider:'openrouter',userId:'one'},'forged');
    expect(keys.get('oneopenrouter_key')).toBe(before);expect(keys.get('forgedopenrouter_key')).toBe('attacker-fixture');
    expect((await call('init',{userId:'one'},'forged')).p.data.userId).toBe('forged');
  });
  test('blank and failed key saves preserve existing keys; removal requires an explicit confirmation',async()=>{
    const before=keys.get('oneopenrouter_key');
    expect((await call('save_key',{key:'',provider:'openrouter'})).p.error).toContain('never removes');
    expect((await call('remove_key',{provider:'openrouter'})).p.error).toContain('Confirm');
    expect(keys.get('oneopenrouter_key')).toBe(before);
    saveFailure=true;const failed=await call('save_key',{key:'custom-secret-fixture',provider:'openrouter'});saveFailure=false;
    expect(failed.p.error).not.toContain('custom-secret-fixture');expect(keys.get('oneopenrouter_key')).toBe(before);
    await call('save_key',{key:'removable-fixture',provider:'openrouter'},'remove-test');
    await call('remove_key',{provider:'openrouter',confirmed:true},'remove-test');
    expect(keys.has('remove-testopenrouter_key')).toBe(false);expect(keys.get('oneopenrouter_key')).toBe(before);
  });
  test('local keys are bound to their exact URL and cannot be redirected by preview settings',async()=>{
    const local={...DEFAULTS,provider:'local',localUrl:'https://speech.example/v1'};
    await call('save_key',{provider:'local',key:'custom-local-fixture',localUrl:local.localUrl});
    await call('speech',{segment:{text:'Hi.'},previewSettings:local});
    expect(requests.at(-1).url).toBe('https://speech.example/v1/audio/speech');expect(requests.at(-1).options.headers.Authorization).toBe('Bearer custom-local-fixture');
    const n=requests.length;
    for(const url of ['https://other.example/v1','https://speech.example/other','http://speech.example/v1'])expect((await call('speech',{segment:{text:'Hi.'},previewSettings:{...local,localUrl:url}})).p.error).toContain('another server');
    expect(requests.length).toBe(n);
    arbitraryFailure=true;const failure=await call('speech',{segment:{text:'Hi.'},previewSettings:local});arbitraryFailure=false;
    expect(failure.p.error).not.toContain('custom-local-fixture');expect(failure.p.error).toContain('[redacted]');
    expect(JSON.stringify(outgoing)).not.toContain('custom-local-fixture');expect(Array.from(files.values()).join('')).not.toContain('custom-local-fixture');
  });
  test('remote cleartext key saves fail; legacy local keys are retained until deliberately rebound',async()=>{
    const n=requests.length;
    expect((await call('save_key',{provider:'local',key:'unsafe-fixture',localUrl:'http://remote.example/v1'})).p.error).toContain('HTTPS');
    expect((await call('save_key',{provider:'local',key:'unsafe-fixture',localUrl:'https://user:pass@remote.example/v1'})).p.error).toContain('without credentials');
    keys.set('legacylocal_key','legacy-preserved-fixture');
    const result=await call('check_connection',{settings:{...DEFAULTS,provider:'local'}},'legacy');
    expect(result.p.error).toContain('preserved');expect(keys.get('legacylocal_key')).toBe('legacy-preserved-fixture');expect(requests.length).toBe(n);
    await call('save_key',{provider:'local',key:'loopback-fixture',localUrl:'http://localhost:8880/v1'},'loopback');
    expect((await call('check_connection',{settings:{...DEFAULTS,provider:'local'}},'loopback')).p.data.message).toContain('accepted');
  });
  test('diagnostics stay in their originating frontend even when the host omits session IDs',async()=>{
    hiddenJson=true;
    await call('speech',{frontendId:'client-a',segment:{text:'Hi.'}},'one',null);const n=requests.length;
    expect((await call('diagnose_speech',{frontendId:'client-b'},'one',null)).p.error).toContain('No recent');
    expect((await call('diagnose_speech',{},'one',null)).p.error).toContain('Reload');expect(requests.length).toBe(n);
    expect((await call('diagnose_speech',{frontendId:'client-a'},'one',null)).p.error).toContain('HTTP 402');expect(requests.length).toBe(n+1);
    hiddenJson=false;
  });
  test('cast settings persist per user and the existing prompt includes named speakers without another request',async()=>{
    const assignments={'name:jason':{name:'Jason',voice:'Charon',emotion:'curious',delivery:'normal'},'name:vasquez':{name:'Vasquez',voice:'Orus',emotion:'neutral',delivery:'normal'}};
    await call('save',{settings:{...DEFAULTS,assignments}});const n=requests.length;
    expect((await call('init')).p.data.settings.assignments).toEqual(assignments);
    expect((await call('init',{},'fresh')).p.data.settings.assignments).toEqual({});
    const prompt=await interceptor([],{userId:'one'});expect(prompt[0].content).toContain('["Jason","Vasquez"]');expect(requests.length).toBe(n);
    await call('save',{settings:DEFAULTS});
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
  test('direct MP3 speech sends clean dialogue to the originating tab',async()=>{
    const r=await call('speech',{segment:{text:'Are you sure?',speaker:'Mara',emotion:'worried',delivery:'whispers'}});
    expect(r.p.data.mime).toBe('audio/mpeg');
    const req=requests.at(-1);expect(req.url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(JSON.parse(req.options.body)).toMatchObject({model:DEFAULTS.model,voice:'Kore',input:'Are you sure?',response_format:'mp3'});
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
  test('turning Readalong off blocks speech and cue injection without a provider request',async()=>{
    await call('save',{settings:{...DEFAULTS,enabled:false,promptEmotions:true}});const before=requests.length;
    expect((await call('speech',{segment:{text:'Do not synthesize.'},previewSettings:{...DEFAULTS,enabled:true}})).p.error).toContain('Readalong is off');
    expect((await call('diagnose_speech')).p.error).toContain('Readalong is off');
    expect((await call('claim_preparation',{key:'b'.repeat(64)})).p.error).toContain('Readalong is off');
    const messages=[{role:'user',content:'Hello'}];expect(await interceptor(messages,{userId:'one'})).toEqual(messages);expect(requests.length).toBe(before);
    await call('save',{settings:DEFAULTS});
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
  test('Gemini cannot make an invalid paid MP3 request through the proxy',async()=>{
    const before=requests.length;const r=await call('speech',{segment:{text:'Hi.'},previewSettings:GEMINI_DEFAULTS});
    expect(r.p.error).toContain('Lumiverse connection');expect(requests.length).toBe(before);
  });
  test('successful speech clears the diagnostic for an earlier failed request',async()=>{
    await call('speech',{segment:{text:'Hi.'}});hiddenJson=false;
    const r=await call('speech',{segment:{text:'Hi.'}});expect(r.p.canDiagnoseSpeech).toBe(false);
  });
});
