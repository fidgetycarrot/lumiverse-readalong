export interface SpeechAudio {audio?:string;bytes?:Uint8Array;blob?:Blob;mime:string}
export interface PlaybackPosition {index:number;seconds:number;fraction:number;elapsed:number;duration:number}

/** A private audio clock for Readalong, independent of the host's player. */
export class BufferedPlayer {
  private context:AudioContext|null=null;
  private gain:GainNode|null=null;
  private buffers:AudioBuffer[]=[];
  private starts:number[]=[];
  private sources:AudioBufferSourceNode[]=[];
  private offset=0;
  private anchor=0;
  private speed=1;
  private volume=.85;
  private running=false;
  private generation=0;
  private primed=false;
  onEnded:()=>void=()=>{};
  constructor(private factory:()=>AudioContext=()=>{
    const Constructor=window.AudioContext ?? (window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!Constructor)throw new Error('This browser does not support continuous audio playback. Try Browser voices.');
    return new Constructor();
  }){}
  private ensure() {
    if(!this.context){this.context=this.factory();this.gain=this.context.createGain();this.gain.gain.value=this.volume;this.gain.connect(this.context.destination)}
    return this.context;
  }
  unlock() {
    const c=this.ensure();void c.resume().catch(()=>{});
    if(this.primed)return;
    const source=c.createBufferSource();source.buffer=c.createBuffer(1,1,c.sampleRate);source.connect(this.gain!);source.start();this.primed=true;
  }
  async decode(data:SpeechAudio):Promise<AudioBuffer> {
    const bytes=data.bytes ?? Uint8Array.from(atob(data.audio!),c=>c.charCodeAt(0));
    try {
      const buffer=await this.ensure().decodeAudioData(bytes.slice().buffer as ArrayBuffer);
      if(!Number.isFinite(buffer.duration) || buffer.duration<=0)throw new Error();
      return buffer;
    } catch {throw new Error('The speech provider returned audio this browser cannot play.')}
  }
  load(buffers:AudioBuffer[]) {
    this.clear();let offset=0;
    this.buffers=buffers;this.starts=buffers.map(b=>{const start=offset;offset+=b.duration;return start});
  }
  get duration(){return this.buffers.reduce((sum,b)=>sum+b.duration,0)}
  get elapsed(){return Math.min(this.duration,this.offset+(this.running?Math.max(0,this.ensure().currentTime-this.anchor)*this.speed:0))}
  get position():PlaybackPosition {
    const elapsed=this.elapsed;let index=0;
    while(index+1<this.starts.length && this.starts[index+1]<=elapsed+1e-7)index++;
    const seconds=Math.max(0,elapsed-(this.starts[index]??0)),duration=this.buffers[index]?.duration??0;
    return {index,seconds,fraction:duration?Math.min(1,seconds/duration):0,elapsed,duration:this.duration};
  }
  private unschedule(){for(const source of this.sources){source.onended=null;try{source.stop()}catch{}source.disconnect()}this.sources=[]}
  private schedule() {
    const c=this.ensure(), generation=++this.generation;
    this.anchor=c.currentTime+.025;this.running=true;
    for(let i=0;i<this.buffers.length;i++) {
      const buffer=this.buffers[i],start=this.starts[i],end=start+buffer.duration;
      if(end<=this.offset)continue;
      const source=c.createBufferSource();source.buffer=buffer;source.playbackRate.value=this.speed;source.connect(this.gain!);
      if(i===this.buffers.length-1)source.onended=()=>{if(generation!==this.generation)return;this.offset=this.duration;this.running=false;this.unschedule();this.onEnded()};
      this.sources.push(source);source.start(this.anchor+Math.max(0,start-this.offset)/this.speed,Math.max(0,this.offset-start));
    }
  }
  async play() {
    if(!this.buffers.length)throw new Error('Prepare a message first.');
    const generation=this.generation,c=this.ensure();await c.resume();
    if(generation!==this.generation)return false;
    if(c.state!=='running')throw new Error('Press Play to allow audio.');
    if(this.running)return true;
    if(this.offset>=this.duration)this.offset=0;
    this.schedule();return true;
  }
  pause(){this.offset=this.elapsed;this.running=false;this.generation++;this.unschedule()}
  setSpeed(speed:number) {
    const running=this.running;this.pause();this.speed=Math.max(.5,Math.min(2,speed));
    if(running)this.schedule();
  }
  setVolume(volume:number){this.volume=Math.max(0,Math.min(1,volume));if(this.gain)this.gain.gain.value=this.volume}
  rewind(){this.pause();this.offset=0}
  clear(){this.pause();this.offset=0;this.buffers=[];this.starts=[]}
  dispose(){this.clear();void this.context?.close().catch(()=>{});this.context=null;this.gain=null}
}
