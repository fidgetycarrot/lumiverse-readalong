import { selectVoice, speakerCharacterId, splitSentences, readVoiceRef, parseSegments, DEFAULT_SPEECH_RULES, type CharacterInfo, type NativeVoiceRef, type Settings, type SpeechSegment, type MessageInfo, type SpeechRules } from './shared';
import type { NativeConnection } from './native-tts';
import { stripVocalTags,sanitizeLegacySpeechText } from './speech-text';
import {applyPronunciations,type Pronunciations} from './pronunciation';
import {isGeminiSpeechStyleModel} from './speech-style';

export const MAX_PASSAGE_CHARS=3000;
export const MAX_NATIVE_PASSAGE_CHARS=12000;
export interface SpeechPassage { segment:SpeechSegment;segments:SpeechSegment[];settings:Settings;voice:string }
export interface VoiceContext { characters:CharacterInfo[];characterId?:string;connections?:NativeConnection[];mainSpeaker?:string;narrationVoice?:NativeVoiceRef;pronunciations?:Pronunciations;legacyAudio?:boolean;overrides?:{narrator?:unknown;characters?:Record<string,unknown>} }

const firstName=(name:string)=>name.split('||')[0].trim().toLowerCase();
/** True for a speaker who is neither the reply's own character, a library character, nor someone with a saved voice. */
export function isUnvoicedExtra(speaker:string,settings:Settings,context:VoiceContext):boolean {
  const name=speaker.trim().toLowerCase();
  if(!name || name==='narrator' || settings.assignments[`name:${name}`])return false;
  if(context.mainSpeaker && firstName(context.mainSpeaker)===name)return false;
  if(context.characters.some(c=>firstName(c.name)===name || c.name.trim().toLowerCase()===name))return false;
  return true;
}
/** A user's message belongs to their configured You row, even if the host uses their full persona name. */
export function planMessageSpeech(message:MessageInfo,settings:Settings,context:VoiceContext,rules:SpeechRules=DEFAULT_SPEECH_RULES):SpeechPassage[] {
  const speaker=message.isUser?settings.personaName||message.name:message.name;
  // Plain user input is their own speech. Keep explicit skips, narrated actions,
  // and speaker cues; assistant narration still follows the host's rules.
  const effectiveRules=message.isUser && rules.undecorated!=='skip'?{...rules,undecorated:'speech' as const}:rules;
  const segments=parseSegments(context.legacyAudio?sanitizeLegacySpeechText(message.content,true):message.content,speaker,effectiveRules);
  if(message.isUser && settings.personaName){
    for(const segment of segments){
      if(segment.speaker.trim().toLowerCase()===message.name.trim().toLowerCase() && !settings.assignments[`name:${segment.speaker.toLowerCase()}`])segment.speaker=speaker;
    }
  }
  return planSpeech(segments,settings,{...context,mainSpeaker:speaker,...(message.isUser?{characterId:undefined}:{})});
}
/** Resolve voices before batching, so narrator/character boundaries survive. */
export function planSpeech(segments:SpeechSegment[], settings:Settings, context:VoiceContext):SpeechPassage[] {
  const passages:SpeechPassage[]=[];
  let previousKey='';
  for(const source of segments) {
    let segment=source;
    const narrator=segment.speaker.trim().toLowerCase()==='narrator';
    // A named speaker with no voice of their own, who is not the character this
    // reply belongs to, would otherwise borrow that character's voice.
    const npc=!!settings.npcVoice && !narrator && isUnvoicedExtra(segment.speaker,settings,context);
    const characterId=npc?undefined:speakerCharacterId(segment.speaker,context.characters,context.characterId);
    const assignment=selectVoice(settings,segment,characterId);
    if(npc)assignment.voice=settings.npcVoice;
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
    const geminiStyle=!context.legacyAudio && isGeminiSpeechStyleModel(snapshot.model) && (snapshot.provider==='openrouter' || snapshot.provider==='lumiverse' && !!context.connections?.find(c=>c.id===snapshot.connectionId)?.supportsSpeechStyle);
    const styleSupported=(geminiStyle || /gemini-3\.1.*tts|gpt-4o-mini-tts/i.test(snapshot.model)) && snapshot.provider!=='browser';
    const emotion=styleSupported?assignment.emotion:'neutral', delivery=styleSupported?assignment.delivery:'normal';
    const key=JSON.stringify([snapshot.provider,snapshot.connectionId,snapshot.model,snapshot.voice,emotion,delivery]);
    const limit=snapshot.provider==='lumiverse' && /gemini-.*tts/i.test(snapshot.model)?MAX_NATIVE_PASSAGE_CHARS:MAX_PASSAGE_CHARS;
    const audioText=applyPronunciations(segment.text,context.pronunciations??{});
    // A short spelling can expand substantially. Keep provider batches bounded
    // without losing any audio or replacing the marker's original sentence.
    for(const text of audioText.length<=limit?[audioText]:splitSentences(audioText)){
      const last=passages.at(-1);
      if(last && previousKey===key && last.segment.text.length+text.length+1<=limit) {
        last.segment.text+=' '+text;if(last.segments.at(-1)!==segment)last.segments.push(segment);
      } else passages.push({segment:{...segment,text,emotion,delivery},segments:[segment],settings:snapshot,voice:snapshot.voice});
      previousKey=key;
    }
  }
  return passages;
}

/** Bounded synthesis; results stay ordered while progress exposes completed clips. */
export async function prepareAll<T>(items:SpeechPassage[], prepare:(passage:SpeechPassage,index:number,signal:AbortSignal)=>Promise<T>, signal:AbortSignal, progress:(completed:number)=>void, concurrency=3):Promise<T[]> {
  const results=new Array<T>(items.length);let next=0,completed=0,failed=false,firstError:unknown;
  const worker=async()=>{
    try {
      while(next<items.length && !failed) {
        signal.throwIfAborted();const index=next++;
        results[index]=await prepare(items[index],index,signal);
        signal.throwIfAborted();progress(++completed);
      }
    // Let already accepted requests finish so their audio can be checkpointed.
    // A failure stops dispatching new work; only Off/Stop aborts siblings.
    } catch(error) {if(!failed){failed=true;firstError=error}throw error}
  };
  await Promise.allSettled(Array.from({length:Math.min(Math.max(1,concurrency),items.length)},worker));
  if(failed)throw firstError;
  signal.throwIfAborted();return results;
}

// Synthesis has no alignment timestamps. Sentence markers use a lightweight
// estimate within a continuous voice passage, without another API request.
export function estimatedSentenceIndex(passage:SpeechPassage, fraction:number):number {
  const weights=passage.segments.map(s=>Math.max(1,stripVocalTags(s.text).replace(/[^\p{L}\p{N}]/gu,'').length)+12*splitSentences(s.text).length);
  const target=Math.max(0,Math.min(.999999,fraction))*weights.reduce((a,b)=>a+b,0);
  let sum=0;for(let i=0;i<weights.length;i++){sum+=weights[i];if(target<sum)return i}return weights.length-1;
}
