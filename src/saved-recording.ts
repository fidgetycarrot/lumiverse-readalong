import {normalizeSettings,type SpeechSegment} from './shared';
import type {SpeechPassage} from './playback-plan';
import type {NativeConnection} from './native-tts';

export interface RecordingPlan {passages:SpeechPassage[];connections:NativeConnection[]}
export interface RecordingMetadata {messageKey:string;plan:RecordingPlan}
const segment=(value:any):SpeechSegment|undefined=>value && ['text','speaker','emotion','delivery'].every(k=>typeof value[k]==='string')?{text:value.text,speaker:value.speaker,emotion:value.emotion,delivery:value.delivery}:undefined;
/** Store only playback fields; never arbitrary provider or key fields. */
export function recordingPlan(passages:SpeechPassage[],connections:NativeConnection[]):RecordingPlan {
  const used=new Set(passages.filter(p=>p.settings.provider==='lumiverse').map(p=>p.settings.connectionId));
  return {passages:passages.map(p=>({segment:segment(p.segment)!,segments:p.segments.map(s=>segment(s)!),voice:p.voice,settings:normalizeSettings(p.settings)})),
    connections:connections.filter(c=>used.has(c.id)).map(c=>({id:c.id,name:c.name,provider:c.provider,model:c.model,voice:c.voice,outputFormat:c.outputFormat,supportsSpeechStyle:c.supportsSpeechStyle,speechStyle:c.speechStyle}))};
}
export function readRecordingPlan(raw:any,count:number):RecordingPlan|undefined {
  if(!raw || !Array.isArray(raw.passages) || raw.passages.length!==count || !Array.isArray(raw.connections))return;
  const passages:SpeechPassage[]=[];
  for(const p of raw.passages){
    const main=segment(p?.segment);
    if(!main || !Array.isArray(p.segments) || !p.segments.length || !p.settings || typeof p.voice!=='string')return;
    const segments=p.segments.map(segment);if(segments.some((s:SpeechSegment|undefined)=>!s))return;
    passages.push({segment:main,segments:segments as SpeechSegment[],voice:p.voice,settings:normalizeSettings(p.settings)});
  }
  const connections:NativeConnection[]=[];
  for(const c of raw.connections){
    if(!c || !['id','name','provider','model','voice'].every(k=>typeof c[k]==='string'))return;
    connections.push({id:c.id,name:c.name,provider:c.provider,model:c.model,voice:c.voice,
      ...(typeof c.outputFormat==='string'?{outputFormat:c.outputFormat}:{}),
      ...(typeof c.speechStyle==='string'?{speechStyle:c.speechStyle}:{}),...(c.supportsSpeechStyle===true?{supportsSpeechStyle:true}:{})});
  }
  return recordingPlan(passages,connections);
}
