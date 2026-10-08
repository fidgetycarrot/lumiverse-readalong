import type { SpeechAudio, PlaybackPosition } from './playback';

export interface WaveData {rate:number;channels:number;bits:number;offset:number;size:number}
export interface PreparedClip {blob:Blob;duration:number;wave?:WaveData}
export function waveHeader(size:number,rate=24000,channels=1,bits=16):Uint8Array {
  const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);
  const text=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)bytes[offset+i]=s.charCodeAt(i)};
  text(0,'RIFF');view.setUint32(4,size+36,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,rate,true);
  view.setUint32(28,rate*channels*bits/8,true);view.setUint16(32,channels*bits/8,true);view.setUint16(34,bits,true);
  text(36,'data');view.setUint32(40,size,true);return bytes;
}
/** Header inspection only: never decode or resample a whole PCM recording. */
export async function readWave(blob:Blob):Promise<WaveData|undefined> {
  const bytes=new Uint8Array(await blob.slice(0,65536).arrayBuffer());
  const text=(at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
  if(text(0)!=='RIFF' || text(8)!=='WAVE')return;
  const view=new DataView(bytes.buffer);let format:Omit<WaveData,'offset'|'size'>|undefined;
  for(let at=12;at+8<=bytes.length;) {
    const size=view.getUint32(at+4,true),kind=text(at),offset=at+8;
    if(kind==='fmt ' && size>=16 && offset+16<=bytes.length && view.getUint16(offset,true)===1) {
      const channels=view.getUint16(offset+2,true),rate=view.getUint32(offset+4,true),bits=view.getUint16(offset+14,true);
      if(channels>=1 && channels<=8 && rate>=8000 && rate<=192000 && [8,16,24,32].includes(bits))format={rate,channels,bits};
    }
    if(kind==='data' && format) {
      const frameBytes=format.channels*format.bits/8;
      if(!size || offset+size>blob.size || size%frameBytes)throw new Error('The speech provider returned incomplete WAV audio.');
      return {...format,offset,size};
    }
    at=offset+size+(size%2);
  }
}
export async function pcmBlobToWav(blob:Blob,type='audio/pcm'):Promise<Blob> {
  const first=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  if(String.fromCharCode(...first.subarray(0,4))==='RIFF' && String.fromCharCode(...first.subarray(8,12))==='WAVE')return blob.slice(0,blob.size,'audio/wav');
  const param=(name:string,fallback:number)=>{const match=type.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*"?([^;"\\s]+)`,'i'));return match?Number(match[1]):fallback};
  const rate=param('rate',24000),channels=param('channels',1);
  if(!Number.isInteger(rate) || rate<8000 || rate>96000 || channels!==1)throw new Error('OpenRouter returned unsupported PCM sample settings.');
  if(!blob.size || blob.size%2)throw new Error('OpenRouter returned empty or incomplete PCM audio.');
  if(blob.size>0xffffffff-36)throw new Error('This audio exceeds the WAV file format limit.');
  return new Blob([waveHeader(blob.size,rate),blob],{type:'audio/wav'});
}
function audioBlob(data:SpeechAudio):Blob {
  if(data.blob)return data.blob;
  const bytes=data.bytes ?? Uint8Array.from(atob(data.audio!),c=>c.charCodeAt(0));
  return new Blob([bytes as BlobPart],{type:data.mime});
}
export async function prepareClip(data:SpeechAudio,signal?:AbortSignal,createAudio=()=>new Audio()):Promise<PreparedClip> {
  signal?.throwIfAborted();const blob=audioBlob(data),wave=await readWave(blob);signal?.throwIfAborted();
  if(wave)return {blob,wave,duration:wave.size/(wave.rate*wave.channels*wave.bits/8)};
  const audio=createAudio(),url=URL.createObjectURL(blob);
  try {
    const duration=await new Promise<number>((resolve,reject)=>{
      const abort=()=>done(()=>reject(signal?.reason ?? new DOMException('Stopped','AbortError')));
      const timer=setTimeout(()=>done(()=>reject(new Error('Could not read the prepared audio file.'))),15000);
      const done=(work:()=>void)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);work()};
      audio.onloadedmetadata=()=>done(()=>Number.isFinite(audio.duration) && audio.duration>0?resolve(audio.duration):reject(new Error('The provider returned audio without a usable duration.')));
      audio.onerror=()=>done(()=>reject(new Error('The speech provider returned audio this browser cannot play.')));
      signal?.addEventListener('abort',abort,{once:true});audio.preload='metadata';audio.src=url;
    });
    signal?.throwIfAborted();return {blob,duration};
  } finally {audio.onloadedmetadata=null;audio.onerror=null;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url)}
}
/** Compatible PCM clips become one file; voice changes need no playback handoff. */
export function joinPrepared(clips:PreparedClip[]):{blob:Blob;duration:number}[] {
  if(!clips.length)return [];
  const first=clips[0].wave,total=clips.reduce((sum,c)=>sum+(c.wave?.size??0),0);
  if(first && total<=0xffffffff-36 && clips.every(c=>c.wave && c.wave.rate===first.rate && c.wave.channels===first.channels && c.wave.bits===first.bits)) {
    return [{blob:new Blob([waveHeader(total,first.rate,first.channels,first.bits),...clips.map(c=>c.blob.slice(c.wave!.offset,c.wave!.offset+c.wave!.size))],{type:'audio/wav'}),duration:clips.reduce((sum,c)=>sum+c.duration,0)}];
  }
  return clips;
}

/** Prepared files use the browser media player, without retaining full decoded buffers. */
export class PreparedPlayer {
  private audio:HTMLAudioElement;
  private next:HTMLAudioElement|null=null;
  private tracks:{url:string;duration:number}[]=[];
  private durations:number[]=[];
  private index=0;
  private running=false;
  private finished=false;
  private generation=0;
  private speed=1;
  private volume=.85;
  private primed=false;
  private complete=true;
  private waiting=false;
  private started=false;
  private playEpoch=0;
  private pendingPlay:Promise<boolean>|null=null;
  private cancelPlay:(()=>void)|null=null;
  private rejectPlay:((error:Error)=>void)|null=null;
  private reloadBeforePlay=false;
  onEnded:()=>void=()=>{};
  onError:(error:Error)=>void=()=>{};
  onWaiting:(waiting:boolean)=>void=()=>{};
  constructor(private factory=()=>new Audio(),private urls:{create:(blob:Blob)=>string;revoke:(url:string)=>void}={create:URL.createObjectURL.bind(URL),revoke:URL.revokeObjectURL.bind(URL)},private startTimeoutMs=10000){this.audio=factory()}
  unlock() {
    if(this.primed || this.tracks.length)return;this.primed=true;
    const silent=new Blob([waveHeader(2),new Uint8Array(2)],{type:'audio/wav'}),url=this.urls.create(silent),audio=this.audio;
    audio.src=url;const generation=this.generation;
    void audio.play().then(()=>{if(generation===this.generation && !this.tracks.length)audio.pause()}).catch(()=>{}).finally(()=>this.urls.revoke(url));
  }
  load(clips:PreparedClip[]) {
    this.clear();this.durations=clips.map(c=>c.duration);
    this.tracks=joinPrepared(clips).map(c=>({url:this.urls.create(c.blob),duration:c.duration}));
    if(this.tracks.length)this.activate(0);
  }
  /** The opening buffer is one joined file. The remaining buffer is joined once. */
  begin(clips:PreparedClip[]){this.load(clips);this.complete=false}
  append(clips:PreparedClip[],complete=true){
    this.durations.push(...clips.map(c=>c.duration));
    this.tracks.push(...joinPrepared(clips).map(c=>({url:this.urls.create(c.blob),duration:c.duration})));
    this.complete=complete;
    if(this.waiting && this.index+1<this.tracks.length){
      this.onWaiting(false);
      if(this.running){this.waiting=false;this.advance()}
    }else if(this.waiting && complete){this.waiting=false;this.running=false;this.finished=true;this.onWaiting(false);this.onEnded()}
    else this.preloadNext();
  }
  get hasStarted(){return this.started}
  private configure(audio:HTMLAudioElement){audio.preload='auto';audio.volume=this.volume;audio.playbackRate=this.speed}
  private activate(index:number) {
    this.index=index;this.configure(this.audio);if(this.audio.src!==this.tracks[index].url)this.audio.src=this.tracks[index].url;
    const generation=this.generation,audio=this.audio;
    this.audio.onended=()=>{
      if(generation!==this.generation || audio!==this.audio || index!==this.index || !this.running)return;
      if(this.index+1===this.tracks.length){
        if(!this.complete){this.waiting=true;this.onWaiting(true);return}
        this.running=false;this.finished=true;this.onEnded();return;
      }
      this.advance();
    };
    this.audio.onerror=()=>{if(generation===this.generation && audio===this.audio){
      this.running=false;this.reloadBeforePlay=true;audio.pause();
      const detail=audio.error?.code===3?'This browser could not decode the prepared audio.':audio.error?.code===4?'This browser could not load the prepared audio format.':'The prepared audio file could not be played.';
      const error=new Error(`${detail} Press Play again to reload the same recording; no speech is requested.`);
      if(this.rejectPlay)this.rejectPlay(error);else this.onError(error);
    }};
    this.preloadNext();
  }
  private preloadNext(){if(!this.next && this.index+1<this.tracks.length){this.next=this.factory();this.configure(this.next);this.next.src=this.tracks[this.index+1].url}}
  private advance(){
    const generation=this.generation,old=this.audio;old.onended=null;old.onerror=null;old.onplaying=null;old.onloadedmetadata=null;old.removeAttribute('src');old.load();
    this.audio=this.next??this.factory();this.next=null;this.activate(this.index+1);
    // Reuse the same guarded local playback path. No synthesis occurs here.
    void this.play().catch(()=>{if(generation===this.generation){this.running=false;this.onError(new Error('Prepared audio is ready. Press Resume to continue playback.'))}});
  }
  get duration(){return this.durations.reduce((sum,n)=>sum+n,0)}
  get elapsed(){return this.finished?this.duration:Math.min(this.duration,this.tracks.slice(0,this.index).reduce((sum,c)=>sum+c.duration,0)+(this.tracks.length?this.audio.currentTime:0))}
  get position():PlaybackPosition {
    const elapsed=this.elapsed;let index=0,start=0;
    while(index+1<this.durations.length && start+this.durations[index]<=elapsed+1e-7)start+=this.durations[index++];
    const seconds=Math.max(0,elapsed-start),length=this.durations[index]??0;
    return {index,seconds,fraction:length?Math.min(1,seconds/length):0,elapsed,duration:this.duration};
  }
  play():Promise<boolean>{
    if(this.finished)this.rewind();
    if(this.pendingPlay)return this.pendingPlay;
    if(!this.tracks.length)throw new Error('No prepared audio is available.');
    if(this.waiting){
      if(this.index+1<this.tracks.length){this.waiting=false;this.onWaiting(false);this.advance();return this.pendingPlay!}
      this.running=true;return Promise.resolve(true);
    }
    // A failed media element is replaced only on a later local Play. Keep its
    // Blob URL and clock: recovery never authorizes another speech request.
    if(this.reloadBeforePlay){
      const old=this.audio,time=Number.isFinite(old.currentTime)?old.currentTime:0,generation=this.generation;
      old.pause();old.onended=null;old.onerror=null;old.onplaying=null;old.onloadedmetadata=null;old.removeAttribute('src');old.load();
      this.audio=this.factory();this.reloadBeforePlay=false;this.activate(this.index);
      const audio=this.audio,seek=()=>{if(generation!==this.generation || audio!==this.audio)return;try{audio.currentTime=time;audio.onloadedmetadata=null}catch{ /* Seek again once metadata is available. */ }};
      if(time){audio.onloadedmetadata=seek;seek()}
    }
    const generation=this.generation,epoch=++this.playEpoch,audio=this.audio;
    let done=false,resolve!:(started:boolean)=>void,reject!:(error:Error)=>void;
    const pending=new Promise<boolean>((yes,no)=>{resolve=yes;reject=no});
    const current=()=>generation===this.generation && epoch===this.playEpoch && audio===this.audio;
    const cleanup=()=>{done=true;clearTimeout(timer);if(audio.onplaying===started)audio.onplaying=null;this.cancelPlay=null;this.rejectPlay=null;if(this.pendingPlay===pending)this.pendingPlay=null};
    const cancel=()=>{if(done)return;cleanup();resolve(false)};
    const failed=(error:Error)=>{if(done)return;if(!current()){cancel();return}this.running=false;audio.pause();cleanup();reject(error)};
    const started=()=>{if(done)return;if(!current()){cancel();return}this.running=true;this.started=true;cleanup();resolve(true)};
    const timer=setTimeout(()=>{if(done)return;this.reloadBeforePlay=true;failed(new Error('Playback is taking too long to start. Press Play again to reload the same recording; no speech is requested.'))},this.startTimeoutMs);
    this.pendingPlay=pending;
    this.cancelPlay=cancel;this.rejectPlay=failed;audio.onplaying=started;
    const rejected=(error:unknown)=>{
      if(done)return;
      const blocked=error instanceof Error && error.name==='NotAllowedError';
      if(current() && !blocked)this.reloadBeforePlay=true;
      failed(new Error(`${blocked?'Your browser blocked playback.':'Playback could not start.'} Press Play again; the prepared audio is reused and no speech is requested.`));
    };
    // Stay synchronous with the user's click. Either the promise or a real
    // playing event confirms startup; some embedded browsers only deliver one.
    try{void audio.play().then(started,rejected)}catch(error){rejected(error)}
    return pending;
  }
  pause(){this.playEpoch++;this.cancelPlay?.();this.pendingPlay=null;this.audio.pause();this.running=false}
  setSpeed(speed:number){this.speed=Math.max(.5,Math.min(2,speed));this.audio.playbackRate=this.speed;if(this.next)this.next.playbackRate=this.speed}
  setVolume(volume:number){this.volume=Math.max(0,Math.min(1,volume));this.audio.volume=this.volume;if(this.next)this.next.volume=this.volume}
  rewind(){this.pause();this.finished=false;this.waiting=false;if(this.index===0)this.audio.currentTime=0;else{this.next?.removeAttribute('src');this.next?.load();this.next=null;this.activate(0)}}
  clear(){
    this.generation++;this.pause();this.audio.onended=null;this.audio.onerror=null;this.audio.onplaying=null;this.audio.onloadedmetadata=null;this.audio.removeAttribute('src');this.audio.load();
    this.next?.removeAttribute('src');this.next?.load();this.next=null;
    for(const track of this.tracks)this.urls.revoke(track.url);
    this.tracks=[];this.durations=[];this.index=0;this.finished=false;this.complete=true;this.waiting=false;this.started=false;this.reloadBeforePlay=false;
  }
  dispose(){this.clear()}
}
