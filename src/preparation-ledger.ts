export interface LedgerStorage {
  read(userId:string):Promise<string|undefined>;
  write(userId:string,value:string):Promise<void>;
}
/** Persist before synthesis. Failed or interrupted attempts never retry automatically. */
export class PreparationLedger {
  private chains=new Map<string,Promise<unknown>>();
  constructor(private storage:LedgerStorage){}
  async claim(userId:string,key:string,manual=false):Promise<boolean> {
    if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid preparation identity.');
    const work=(this.chains.get(userId)??Promise.resolve()).catch(()=>{}).then(async()=>{
      const raw=await this.storage.read(userId);
      const keys:unknown=raw===undefined?[]:JSON.parse(raw);
      if(!Array.isArray(keys) || keys.some(k=>typeof k!=='string' || !/^[a-f0-9]{64}$/.test(k)))throw new Error('Could not read the preparation history. No speech was requested.');
      if(keys.includes(key) && !manual)return false;
      await this.storage.write(userId,JSON.stringify([...keys.filter(k=>k!==key),key].slice(-2000)));
      return true;
    });
    this.chains.set(userId,work);
    try{return await work}finally{if(this.chains.get(userId)===work)this.chains.delete(userId)}
  }
}
