import { selectVoice, speakerCharacterId, splitSentences, readVoiceRef, type CharacterInfo, type NativeVoiceRef, type Settings, type SpeechSegment } from './shared';
import type { NativeConnection } from './native-tts';
import { stripVocalTags } from './speech-text';

export const MAX_PASSAGE_CHARS=3000;
export const MAX_NATIVE_PASSAGE_CHARS=12000;
export interface SpeechPassage { segment:SpeechSegment;segments:SpeechSegment[];settings:Settings;voice:string }
export interface VoiceContext { characters:CharacterInfo[];characterId?:string;connections?:NativeConnection[];narrationVoice?:NativeVoiceRef;overrides?:{narrator?:unknown;characters?:Record<string,unknown>} }

/** Resolve voices before batching, so narrator/character boundaries survive. */
export function planSpeech(segments:SpeechSegment[], settings:Settings, context:VoiceContext):SpeechPassage[] {
  const passages:SpeechPassage[]=[];
  let previousKey='';
  for(const source of segments) {
    let segment=source;
    const characterId=speakerCharacterId(segment.speaker,context.characters,context.characterId);
    const assignment=selectVoice(settings,segment,characterId);
    const narrator=segment.speaker.trim().toLowerCase()==='narrator';
    const explicit=settings.assignments[`name:${segment.speaker.toLowerCase()}`]?.voice || (!narrator && characterId && settings.assignments[`id:${characterId}`]?.voice);
    let snapshot={...settings,assignments:{},narratorVoice:'',voice:assignment.voice};
    if(settings.provider==='lumiverse' && settings.inheritVoices && !(narrator?settings.narratorVoice:explicit)) {
      const speech=readVoiceRef(characterId?context.overrides?.characters?.[characterId]:undefined) ?? context.characters.find(c=>c.id===characterId)?.ttsVoice;
      const inherited=narrator ? readVoiceRef(context.overrides?.narrator) ?? context.narrationVoice ?? speech : speech;
      const connection=context.connections?.find(c=>c.id===inherited?.connectionId);
      if(connection && inherited)snapshot={...snapshot,connectionId:connection.id,model:connection.model || settings.model,voice:inherited.voice || connection.voice || assignment.voice};
    }
    if(snapshot.provider==='browser' || !/gemini-3\.8.*tts/i.test(snapshot.model)) {
      segment={...source,text:stripVocalTags(source.text).replace(/\s+/g,' ').trim()};
      if(!segment.text || /^["“”«»\s]+$/.test(segment.text))continue;
    }
    // Gemini 3.8's native adapter ignores style cues, so don't fragment its
    // prose on directions it cannot use. Keep directions for supported TTS.
    const styleSupported=/gemini-3\.1.*tts|gpt-4o-mini-tts/i.test(snapshot.model) && snapshot.provider!=='browser';
    const emotion=styleSupported?assignment.emotion:'neutral', delivery=styleSupported?assignment.delivery:'normal';
    const key=JSON.stringify([snapshot.provider,snapshot.connectionId,snapshot.model,snapshot.voice,emotion,delivery]);
    const last=passages.at(-1);
    const limit=snapshot.provider==='lumiverse' && /gemini-.*tts/i.test(snapshot.model)?MAX_NATIVE_PASSAGE_CHARS:MAX_PASSAGE_CHARS;
    if(last && previousKey===key && last.segment.text.length+segment.text.length+1<=limit) {
      last.segment.text+=' '+segment.text;last.segments.push(segment);
    } else passages.push({segment:{...segment,emotion,delivery},segments:[segment],settings:snapshot,voice:snapshot.voice});
    previousKey=key;
  }
  return passages;
}

/** Bounded synthesis; results stay ordered while progress exposes completed clips. */
export async function prepareAll<T>(items:SpeechPassage[], prepare:(passage:SpeechPassage,index:number,signal:AbortSignal)=>Promise<T>, signal:AbortSignal, progress:(completed:number)=>void, concurrency=3):Promise<T[]> {
  const abort=new AbortController(), combined=AbortSignal.any([signal,abort.signal]);
  const results=new Array<T>(items.length);let next=0,completed=0,firstError:unknown;
  const worker=async()=>{
    try {
      while(next<items.length) {
        combined.throwIfAborted();const index=next++;
        results[index]=await prepare(items[index],index,combined);
        combined.throwIfAborted();progress(++completed);
      }
    } catch(error) {if(firstError===undefined)firstError=error;abort.abort();throw error}
  };
  await Promise.allSettled(Array.from({length:Math.min(Math.max(1,concurrency),items.length)},worker));
  if(firstError!==undefined)throw firstError;
  signal.throwIfAborted();return results;
}

// Synthesis has no alignment timestamps. Sentence markers use a lightweight
// estimate within a continuous voice passage, without another API request.
export function estimatedSentenceIndex(passage:SpeechPassage, fraction:number):number {
  const weights=passage.segments.map(s=>Math.max(1,stripVocalTags(s.text).replace(/[^\p{L}\p{N}]/gu,'').length)+12*splitSentences(s.text).length);
  const target=Math.max(0,Math.min(.999999,fraction))*weights.reduce((a,b)=>a+b,0);
  let sum=0;for(let i=0;i<weights.length;i++){sum+=weights[i];if(target<sum)return i}return weights.length-1;
}
