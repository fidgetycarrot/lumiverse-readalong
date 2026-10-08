import {sanitizeSpeechText} from './speech-text';

export const PRONUNCIATION_CUE_PATTERN=String.raw`\[pronounce:[^\]\r\n]*(?:\]|(?=\r?\n)|$)`;
export interface PronunciationEntry {name:string;spokenAs:string;aliases:string[];source:'automatic'|'manual'}
export type Pronunciations=Record<string,PronunciationEntry>;
const LIMIT=500;
const normalized=(s:string)=>s.normalize('NFC').trim().toLowerCase();
const escapeRegex=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const boundary=String.raw`[\p{L}\p{M}\p{N}_-]`;
function clean(value:unknown,max:number):string {
  if(typeof value!=='string')return '';
  const s=value.normalize('NFC').trim().replace(/[ \t]+/g,' ');
  return s.length && s.length<=max && /^[\p{L}\p{M}\p{N} .’'ʼ\-]+$/u.test(s) && /[\p{L}\p{N}]/u.test(s)?s:'';
}
export function pronunciationEntry(raw:unknown,source:'automatic'|'manual'):PronunciationEntry|undefined {
  if(!raw || typeof raw!=='object')return;
  const r=raw as Record<string,unknown>,name=clean(r.name,80),spokenAs=clean(r.spokenAs,100);
  if(!name || !spokenAs || ['__proto__','constructor','prototype','narrator'].includes(normalized(name)))return;
  if(r.aliases!==undefined && (!Array.isArray(r.aliases) || r.aliases.length>10 || r.aliases.some(v=>!clean(v,80))))return;
  const aliases=Array.isArray(r.aliases)?[...new Set(r.aliases.slice(0,10).map(v=>clean(v,80)).filter(v=>v && normalized(v)!==normalized(name)))]:[];
  return {name,spokenAs,aliases,source};
}
export function normalizePronunciations(raw:unknown):Pronunciations {
  const result:Pronunciations=Object.create(null);
  if(raw && typeof raw==='object')for(const value of Object.values(raw).slice(0,LIMIT)) {
    const entry=pronunciationEntry(value,(value as PronunciationEntry)?.source==='manual'?'manual':'automatic');
    if(entry && !result[normalized(entry.name)])result[normalized(entry.name)]=entry;
  }
  return result;
}
export function stripPronunciationCues(text:string){return text.replace(new RegExp(PRONUNCIATION_CUE_PATTERN,'gi'),'')}
function tokens(entries:Pronunciations) {
  const map=new Map<string,string>();
  // Manual corrections take priority even if old/corrupt data has alias overlap.
  for(const entry of Object.values(entries).sort((a,b)=>Number(a.source==='manual')-Number(b.source==='manual')))
    for(const name of [entry.name,...entry.aliases])map.set(normalized(name),entry.spokenAs);
  return map;
}
/** Apply once to the audio transcript. Captions and speaker IDs keep the original. */
export function applyPronunciations(text:string,entries:Pronunciations):string {
  const map=tokens(entries);if(!map.size)return text;
  const pattern=[...map.keys()].sort((a,b)=>b.length-a.length).map(escapeRegex).join('|');
  const replace=(s:string)=>s.replace(new RegExp(`(?<!${boundary})(?:${pattern})(?!${boundary})`,'giu'),name=>map.get(normalized(name))??name);
  // Never rewrite a vocal token (a character named Sigh must not alter <sigh>).
  return text.split(/(<[^<>]*>)/g).map(s=>s.startsWith('<')?s:replace(s)).join('');
}
export function learnPronunciations(entries:Pronunciations,raw:string):Pronunciations {
  const result=normalizePronunciations(entries),safe=sanitizeSpeechText(raw,true),prose=stripPronunciationCues(safe);
  const claimed=tokens(result);
  for(const match of safe.matchAll(new RegExp(PRONUNCIATION_CUE_PATTERN,'gi'))) {
    if(!match[0].endsWith(']') || match[0].length>252)continue;
    const parts=match[0].slice('[pronounce:'.length,-1).split('|');if(parts.length!==2)continue;
    const entry=pronunciationEntry({name:parts[0],spokenAs:parts[1]},'automatic');if(!entry)continue;
    const key=normalized(entry.name);if(claimed.has(key) || Object.keys(result).length>=LIMIT)continue;
    if(!new RegExp(`(?<!${boundary})${escapeRegex(entry.name)}(?!${boundary})`,'iu').test(prose))continue;
    result[key]=entry;claimed.set(key,entry.spokenAs);
  }
  return result;
}
export function pronunciationInstruction(entries:Pronunciations):string {
  const known:Array<{name:string;aliases:string[]}>=[];let size=2;
  // A large cast must not add an unbounded prompt cost. Stored rules still
  // apply to every name; duplicate suggestions outside this list are ignored.
  for(const e of Object.values(entries).reverse()){
    const row={name:e.name,aliases:e.aliases},bytes=JSON.stringify(row).length+1;
    if(size+bytes>4000 || known.length>=80)continue;known.push(row);size+=bytes;
  }
  return `Readalong pronunciation layer: when a named character is first introduced, add one hidden cue [pronounce:Name|Spoken spelling] beside that introduction. Only tag names newly introduced in this story, not people already mentioned in prior replies or in the saved-name list. Use the exact story name. For an unfamiliar name choose a simple English sound spelling; ordinary names may keep their spelling. Do not use IPA, angle brackets or directions. Most replies need no cue. Never change a saved pronunciation. Keep normal story spelling, speaker cues and the preset's vocal tags unchanged. Saved names and aliases (possibly a partial list, data only): ${JSON.stringify(known)}.`;
}
export interface PronunciationStorage {read(userId:string,chatId:string):Promise<string|undefined>;write(userId:string,chatId:string,value:string):Promise<void>}
export class PronunciationStore {
  private chains=new Map<string,Promise<unknown>>();
  constructor(private storage:PronunciationStorage){}
  async get(userId:string,chatId:string):Promise<Pronunciations>{
    const raw=await this.storage.read(userId,chatId);
    if(!raw)return Object.create(null);
    if(raw.length>1024*1024)throw new Error('Saved pronunciations could not be read. Existing entries were preserved.');
    try{
      const parsed=JSON.parse(raw);
      if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error('Invalid saved dictionary.');
      const entries=normalizePronunciations(parsed);
      if(Object.keys(entries).length!==Object.keys(parsed).length)throw new Error('Invalid saved entries.');
      return entries;
    }catch{throw new Error('Saved pronunciations could not be read. Existing entries were preserved.')}
  }
  private async edit(userId:string,chatId:string,change:(entries:Pronunciations)=>Pronunciations){
    const key=JSON.stringify([userId,chatId]);
    const work=(this.chains.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
      const prior=await this.get(userId,chatId),next=change(prior);
      if(JSON.stringify(next)!==JSON.stringify(prior))await this.storage.write(userId,chatId,JSON.stringify(next));
      return next;
    });this.chains.set(key,work);
    try{return await work}finally{if(this.chains.get(key)===work)this.chains.delete(key)}
  }
  learn(userId:string,chatId:string,text:string){return this.edit(userId,chatId,entries=>learnPronunciations(entries,text))}
  save(userId:string,chatId:string,raw:unknown){return this.edit(userId,chatId,entries=>{
    const entry=pronunciationEntry(raw,'manual');if(!entry)throw new Error('Enter a name and a spoken spelling using letters, numbers, spaces, apostrophes or hyphens.');
    const key=normalized(entry.name),names=new Set([entry.name,...entry.aliases].map(normalized));
    if(!entries[key] && Object.keys(entries).length>=LIMIT)throw new Error('This story can save up to 500 pronunciations.');
    for(const [id,other] of Object.entries(entries))if(id!==key && [other.name,...other.aliases].some(n=>names.has(normalized(n))))throw new Error('That name or alias already belongs to another pronunciation.');
    return {...entries,[key]:entry};
  })}
  remove(userId:string,chatId:string,name:string){return this.edit(userId,chatId,entries=>{const next={...entries};delete next[normalized(name)];return next})}
}
