import type { PreparedClip } from './prepared-audio';

export async function preparationHash(value:unknown):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
interface CachedAudio {id:string;userId:string;clips:PreparedClip[];bytes:number;at:number}
function validClips(value:unknown):value is PreparedClip[] {
  return Array.isArray(value) && value.length>0 && value.every(c=>c?.blob instanceof Blob && c.blob.size>0 && Number.isFinite(c.duration) && c.duration>0);
}
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
    if(!userId)return;
    const db=await this.open();
    try {
      return await new Promise((resolve,reject)=>{
        const request=db.transaction('audio','readonly').objectStore('audio').get(`${userId}:${key}`);
        request.onsuccess=()=>{const record=request.result as CachedAudio|undefined;resolve(record?.userId===userId && validClips(record.clips)?record.clips:undefined)};
        request.onerror=()=>reject(request.error??new Error('Could not read saved audio.'));
      });
    } finally {db.close()}
  }
  async put(userId:string,key:string,clips:PreparedClip[]):Promise<boolean> {
    if(!userId || !validClips(clips))return false;
    const bytes=clips.reduce((n,c)=>n+c.blob.size,0);if(bytes>this.maxBytes)return false;
    const db=await this.open();
    try {
      return await new Promise<boolean>((resolve,reject)=>{
        const tx=db.transaction('audio','readwrite'),store=tx.objectStore('audio');
        tx.oncomplete=()=>resolve(true);tx.onabort=()=>reject(tx.error??new Error('Could not save audio.'));
        const request=store.index('user').getAll(userId);
        request.onsuccess=()=>{
          const rows=request.result as CachedAudio[];
          const record:CachedAudio={id:`${userId}:${key}`,userId,clips,bytes,at:Math.max(Date.now(),...rows.map(r=>r.at+1))};
          const older=rows.filter(r=>r.id!==record.id).sort((a,b)=>b.at-a.at);
          let total=bytes,count=1;store.put(record);
          for(const row of older){if(count>=this.maxEntries || total+row.bytes>this.maxBytes)store.delete(row.id);else{total+=row.bytes;count++}}
        };
      });
    } finally {db.close()}
  }
}
