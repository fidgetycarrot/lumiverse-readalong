import type {Settings,StoryCast,VoiceAssignment} from './shared';

/**
 * Each story (one Lumiverse chat) has its own named cast. Library characters
 * and You keep one voice everywhere; a story lists which library characters
 * belong to it. Names saved before this live in the `earlier` pool.
 */
export const EARLIER='earlier';
const MAX_STORIES=300;

/**
 * Names saved before casts were per story wait in `earlier` until a story that
 * uses them claims them. Run on stored settings; returns true if anything moved.
 */
export function migrateStoryCasts(settings:Settings):boolean {
  const persona=settings.personaName?`name:${settings.personaName.toLowerCase()}`:'';let moved=false;
  for(const [key,value] of Object.entries(settings.assignments)){
    if(!key.startsWith('name:') || key===persona)continue;
    const earlier=settings.stories[EARLIER]??={names:{},updatedAt:0};
    earlier.names[key]??=value;delete settings.assignments[key];moved=true;
  }
  return moved;
}

/** The settings as seen from one story: shared voices plus that story's names. */
export function castView(settings:Settings,chatId?:string|null):Settings {
  const story=chatId?settings.stories[chatId]:undefined;
  return {...settings,personaName:story?.you??settings.personaName,assignments:{...settings.assignments,...(story?.names??{})}};
}

/** Your name in this story (falls back to your usual name). */
export function youIn(settings:Settings,chatId?:string|null):string { return (chatId?settings.stories[chatId]?.you:undefined)??settings.personaName }

/** Set your name for one story. The voice you had there moves to the new name. Empty goes back to your usual name. */
export function setStoryYou(settings:Settings,chatId:string,name:string) {
  const s=story(settings,chatId),before=youIn(settings,chatId),after=name.trim()||settings.personaName;
  const oldKey=before?`name:${before.toLowerCase()}`:'',newKey=after?`name:${after.toLowerCase()}`:'';
  const voice=s.names[oldKey]??(oldKey?settings.assignments[oldKey]:undefined);
  if(s.you)delete s.names[oldKey];
  if(name.trim() && name.trim()!==settings.personaName){
    s.you=name.trim();
    if(voice && newKey && !s.names[newKey])s.names[newKey]={...voice,name:name.trim()};
  } else delete s.you;
  s.updatedAt=Date.now();
  return newKey;
}

/** Whether a card tells the story rather than playing one person. */
export function isStoryteller(settings:Settings,characterId?:string|null):boolean { return !!characterId && settings.storytellers.includes(characterId) }
export function setStoryteller(settings:Settings,characterId:string,storyteller:boolean) {
  const all=new Set(settings.storytellers);
  if(storyteller)all.add(characterId);else all.delete(characterId);
  settings.storytellers=[...all];
}
/** Who speaks lines that name nobody, on a storyteller card. */
export const NOBODY='Everyone else';
export function leadIn(settings:Settings,chatId?:string|null):string { return (chatId?settings.stories[chatId]?.lead:undefined)??NOBODY }
export function setLead(settings:Settings,chatId:string,name:string) {
  const s=story(settings,chatId);
  if(name && name!==NOBODY)s.lead=name;else delete s.lead;
  s.updatedAt=Date.now();
}

function story(settings:Settings,chatId:string):StoryCast {
  return settings.stories[chatId]??={names:{},updatedAt:Date.now()};
}
function trim(settings:Settings) {
  const ids=Object.keys(settings.stories).filter(id=>id!==EARLIER);
  if(ids.length<=MAX_STORIES)return;
  // Drop stories with nothing in them first, then the longest unused.
  const empty=(id:string)=>!Object.keys(settings.stories[id].names).length && !settings.stories[id].members?.length;
  ids.sort((a,b)=>Number(empty(b))-Number(empty(a)) || settings.stories[a].updatedAt-settings.stories[b].updatedAt);
  for(const id of ids.slice(0,ids.length-MAX_STORIES))delete settings.stories[id];
}

/** Remember the story's main character and title so it can be offered elsewhere. */
export function noteStory(settings:Settings,chatId:string,meta:{characterId?:string|null;title?:string|null}):boolean {
  const s=story(settings,chatId);let changed=false;
  if(meta.characterId && s.characterId!==meta.characterId){s.characterId=meta.characterId;changed=true}
  const title=meta.title?.trim().slice(0,120);
  if(title && s.title!==title){s.title=title;changed=true}
  trim(settings);return changed;
}

/** Save or clear one cast voice. `id:` voices are shared; `name:` voices belong to the story. */
export function setCastEntry(settings:Settings,chatId:string|null|undefined,key:string,value:VoiceAssignment|undefined) {
  const persona=settings.personaName?`name:${settings.personaName.toLowerCase()}`:'';
  if(key.startsWith('id:') || key===persona || !chatId){
    if(value)settings.assignments[key]=value;else delete settings.assignments[key];
    if(chatId && key.startsWith('id:'))setMember(settings,chatId,key,!!value);
    return;
  }
  const s=story(settings,chatId);
  if(value)s.names[key]=value;else delete s.names[key];
  s.updatedAt=Date.now();trim(settings);
}

/** Show (or stop showing) a library character in this story's cast. */
export function setMember(settings:Settings,chatId:string,key:string,member:boolean) {
  const s=story(settings,chatId),members=new Set(s.members??[]);
  if(member)members.add(key);else members.delete(key);
  if(members.size)s.members=[...members].slice(0,100);else delete s.members;
  s.updatedAt=Date.now();
}

const mentions=(texts:string[],names:string[])=>{
  const wanted=names.map(n=>n.trim()).filter(n=>n.length>1).map(n=>new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'iu'));
  return texts.some(t=>wanted.some(re=>re.test(t)));
};

/**
 * The first time a story is opened, bring in older voices whose names it uses.
 * Returns the names brought in. Later visits change nothing.
 */
export function claimEarlier(settings:Settings,chatId:string,texts:string[],characters:{id:string;name:string}[]):string[] {
  if(settings.stories[chatId] || chatId===EARLIER)return [];
  const s=story(settings,chatId),claimed:string[]=[];
  for(const [key,a] of Object.entries(settings.stories[EARLIER]?.names??{})){
    const name=a.name??key.slice(5);
    if(mentions(texts,[name,...(a.aliases??[])])){s.names[key]={...a};claimed.push(name)}
  }
  for(const key of Object.keys(settings.assignments).filter(k=>k.startsWith('id:'))){
    const c=characters.find(c=>c.id===key.slice(3));
    if(c && mentions(texts,[c.name.split('||')[0]])){s.members=[...new Set([...(s.members??[]),key])];claimed.push(c.name.split('||')[0].trim())}
  }
  trim(settings);return claimed;
}

export interface OtherStory {id:string;title:string;characterId?:string;count:number}
/** Stories with a cast to copy from, ones with the same main character first. */
export function otherStories(settings:Settings,chatId:string|null|undefined,characterId?:string|null):OtherStory[] {
  return Object.entries(settings.stories)
    .filter(([id,s])=>id!==chatId && Object.keys(s.names).length+(s.members?.length??0)>0)
    .map(([id,s])=>({id,title:id===EARLIER?'Voices saved before stories had their own cast':s.title??'A story',characterId:s.characterId,count:Object.keys(s.names).length+(s.members?.length??0),updatedAt:s.updatedAt}))
    .sort((a,b)=>Number(!!characterId && b.characterId===characterId)-Number(!!characterId && a.characterId===characterId) || Number(a.id===EARLIER)-Number(b.id===EARLIER) || b.updatedAt-a.updatedAt)
    .map(({updatedAt:_,...rest})=>rest);
}

/** Copy every voice from another story into this one. Voices already here are kept. Returns how many were added. */
export function copyCast(settings:Settings,from:string,to:string):number {
  const source=settings.stories[from];if(!source || from===to)return 0;
  const s=story(settings,to);let added=0;
  for(const [key,a] of Object.entries(source.names))if(!s.names[key]){s.names[key]={...a};added++}
  for(const key of source.members??[])if(!s.members?.includes(key)){s.members=[...(s.members??[]),key];added++}
  s.updatedAt=Date.now();trim(settings);return added;
}

/** Named voices in other stories that this story doesn't have, one per name. */
export function namesElsewhere(settings:Settings,chatId:string|null|undefined):{key:string;name:string;assignment:VoiceAssignment;from:string}[] {
  const here=chatId?settings.stories[chatId]?.names??{}:{},seen=new Set(Object.keys(here)),result:{key:string;name:string;assignment:VoiceAssignment;from:string}[]=[];
  const order=Object.entries(settings.stories).filter(([id])=>id!==chatId).sort((a,b)=>b[1].updatedAt-a[1].updatedAt);
  for(const [id,s] of order)for(const [key,a] of Object.entries(s.names)){
    if(seen.has(key) || !a.voice)continue;seen.add(key);
    result.push({key,name:a.name??key.slice(5),assignment:a,from:id===EARLIER?'saved earlier':s.title??'another story'});
  }
  return result.sort((a,b)=>a.name.localeCompare(b.name));
}
