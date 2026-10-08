import type { PreparedClip } from './prepared-audio';

export async function preparationHash(value:unknown):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
interface CachedAudio {id:string;userId:string;clips:(PreparedClip|undefined)[];bytes:number;at:number}
function validClip(c:any):c is PreparedClip {return c?.blob instanceof Blob && c.blob.size>0 && Number.isFinite(c.duration) && c.duration>0}
function validClips(value:unknown):value is PreparedClip[] {
  return Array.isArray(value) && value.length>0 && Array.from(value).every(validClip);
}
function validPartial(value:unknown):value is (PreparedClip|undefined)[] {return Array.isArray(value) && value.length>0 && value.some(validClip) && Array.from(value).every(c=>c===undefined || validClip(c))}
/** Local audio only. The persistent server ledger protects against eviction or cache failure. */
export class AudioCache {
  constructor(private factory:IDBFactory|undefined=globalThis.indexedDB,private name='lumiverse-readalong-audio-v1',private maxBytes=256*1024*1024,private maxEntries=3){}
  private async open():Promise<IDBDatabase> {
    if(!this.factory)throw new Error('Saved audio is unavailable in this browser.');
    return new Promise((resolve,reject)=>{
      const request=this.factory!.open(this.name,1);
      let settled=false;
      const timer=setTimeout(()=>{settled=true;reject(new Error('Saved audio storage did not respond.'))},10000);
      request.onupgradeneeded=()=>{const store=request.result.createObjectStore('audio',{keyPath:'id'});store.createIndex('user','userId')};
      request.onsuccess=()=>{clearTimeout(timer);if(settled)request.result.close();else{settled=true;resolve(request.result)}};
      request.onerror=()=>{clearTimeout(timer);settled=true;reject(request.error??new Error('Saved audio storage failed.'))};
      request.onblocked=()=>{clearTimeout(timer);settled=true;reject(new Error('Saved audio storage is blocked.'))};
    });
  }
  async get(userId:string,key:string):Promise<PreparedClip[]|undefined> {
    const clips=await this.read(userId,key);return validClips(clips)?clips:undefined;
  }
  async getPartial(userId:string,key:string,count:number):Promise<(PreparedClip|undefined)[]|undefined> {
    const clips=await this.read(userId,key);return validPartial(clips) && clips.length===count?clips:undefined;
  }
  private async read(userId:string,key:string):Promise<(PreparedClip|undefined)[]|undefined> {
    if(!userId)return;
    const db=await this.open();
    try {
      return await new Promise((resolve,reject)=>{
        const request=db.transaction('audio','readonly').objectStore('audio').get(`${userId}:${key}`);
        request.onsuccess=()=>{const record=request.result as CachedAudio|undefined;resolve(record?.userId===userId && validPartial(record.clips)?record.clips:undefined)};
        request.onerror=()=>reject(request.error??new Error('Could not read saved audio.'));
      });
    } finally {db.close()}
  }
  async put(userId:string,key:string,clips:PreparedClip[]):Promise<boolean> {
    if(!userId || !validClips(clips))return false;
    return this.putPartial(userId,key,clips);
  }
  /** One message record with ordered slots. Merge concurrent checkpoints atomically. */
  async putPartial(userId:string,key:string,clips:(PreparedClip|undefined)[]):Promise<boolean> {
    if(!userId || !validPartial(clips) || clips.reduce((n,c)=>n+(c?.blob.size??0),0)>this.maxBytes)return false;
    const snapshot=Array.from(clips);
    const db=await this.open();
    try {
      return await new Promise<boolean>((resolve,reject)=>{
        const tx=db.transaction('audio','readwrite'),store=tx.objectStore('audio');
        let written=false;tx.oncomplete=()=>resolve(written);tx.onabort=()=>reject(tx.error??new Error('Could not save audio.'));
        const request=store.index('user').getAll(userId);
        request.onsuccess=()=>{
          const rows=request.result as CachedAudio[];
          const id=`${userId}:${key}`,prior=rows.find(r=>r.id===id);
          const merged=snapshot.map((clip,i)=>clip??(prior?.clips.length===snapshot.length && validPartial(prior.clips)?prior.clips[i]:undefined));
          const bytes=merged.reduce((n,c)=>n+(c?.blob.size??0),0);if(bytes>this.maxBytes)return;
          const record:CachedAudio={id,userId,clips:merged,bytes,at:Math.max(Date.now(),...rows.map(r=>r.at+1))};
          const older=rows.filter(r=>r.id!==record.id).sort((a,b)=>b.at-a.at);
          let total=bytes,count=1;store.put(record);written=true;
          for(const row of older){if(count>=this.maxEntries || total+row.bytes>this.maxBytes)store.delete(row.id);else{total+=row.bytes;count++}}
        };
      });
    } finally {db.close()}
  }
}
