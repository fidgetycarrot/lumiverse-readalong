// Keep ordinary HTML prose. Custom tags describe UI, tools, or model metadata
// and must be removed together with their contents before detecting speakers.
const PROSE_TAGS = new Set(`p div span section article header footer main aside nav address blockquote q cite figure figcaption hgroup ul ol li dl dt dd menu br hr wbr h1 h2 h3 h4 h5 h6 b strong i em u s strike del ins mark small big sub sup abbr acronym dfn kbd samp var time font tt bdi bdo data ruby rb rp rt rtc a table thead tbody tfoot tr td th caption col colgroup label legend fieldset`.split(' '));
const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const ENTITIES:Record<string,string> = {nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’'};
// Gemini 3.8 vocal events are standalone tokens, not enclosing XML blocks.
// https://ai.google.dev/gemini-api/docs/speech-generation#vocal-bursts-and-non-speech-sounds
export const VOCAL_TAGS = ['laugh','laughter','chuckle','chuckles','giggle','snicker','cackle','cheer','gasp','sigh','sighs','groan','grunt','grr','growl','hiss','moan','pant','pff','phew','tsk','whispers','whispering','shout','argh','whimper','cry','sob','scream','shriek','snort','breath','heavy breath','exhales','cough','throat-clearing','sneeze','yawn','short pause','long pause'] as const;
const vocalTags=new Set<string>(VOCAL_TAGS);
function legacyVocalTag(tag:string):string|undefined {
  const match=/^<([a-z][a-z\s-]*?)\s*\/?>$/i.exec(tag);
  const name=match?.[1].toLowerCase().trim().replace(/\s+/g,' ');
  return name && vocalTags.has(name)?`<${name}>`:undefined;
}
export function stripVocalTags(text:string,preserveOffsets=false):string {
  return text.replace(/<[^<>]*>/g,tag=>vocalTag(tag)?' '.repeat(preserveOffsets?tag.length:1):tag);
}
const NON_PROSE_TAGS=new Set('html head body title script style noscript template slot canvas svg math details summary dialog form button select option optgroup textarea datalist output progress meter audio video picture map object iframe frameset frame noframes applet basefont center'.split(' '));
// These are metadata even when the model forgets the closing marker. Paired
// custom tags are always metadata; only standalone, attribute-free cues pass.
const METADATA_TAG=/^(?:think|thinking|reasoning|analysis|redacted_thinking|tracker|stats|status|state|scenecard|tts_tags|(?:sc|flair|lumi|lumidraw|lumistudio|lumi-studio|dt-image|image-prompt|loom|tool|function)(?:[_-][\w-]+)?)$/i;
function vocalTag(marker:string):string|undefined {
  const match=/^<([a-z][\w-]*(?:\s+[^<>=\/"*]+)?)\s*\/?>$/i.exec(marker);
  if(!match)return;
  const cue=match[1].trim().toLowerCase().replace(/\s+/g,' '),name=cue.split(' ')[0];
  if(PROSE_TAGS.has(name) || VOID_TAGS.has(name) || NON_PROSE_TAGS.has(name) || METADATA_TAG.test(name))return;
  return `<${cue}>`;
}

function decodeEntities(text:string):string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(entity,name:string)=>{
    if(name[0]!=='#')return ENTITIES[name.toLowerCase()] ?? entity;
    const code=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);
    return code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff)?String.fromCodePoint(code):entity;
  });
}

/** Reconstruct pre-0.2.11 recording plans and their original cache identity. */
export function sanitizeLegacySpeechText(raw:string,keepVocalTags=false):string {
  const text=decodeEntities(raw)
    .replace(/<!--\s*([a-z0-9_]+)_START\s*-->[\s\S]*?(?:<!--\s*\1_END\s*-->|$)/gi,' ')
    .replace(/<!--[\s\S]*?(?:-->|$)/g,' ')
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,' ')
    .replace(/(`+)[\s\S]*?\1/g,' ');
  // A stack handles nested custom tags even inside normal prose wrappers.
  // Attribute quotes can contain '>' without ending the tag.
  const tags=/<(\/?)([a-z][a-z0-9:_-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
  const blocked:string[]=[],parts:string[]=[];
  let cursor=0;
  for(const match of text.matchAll(tags)) {
    if(!blocked.length)parts.push(text.slice(cursor,match.index),' ');
    const tag=match[2].toLowerCase();
    const vocal=legacyVocalTag(match[0]);
    if(vocal) {
      if(!blocked.length && keepVocalTags)parts.push(vocal,' ');
    } else if(match[1]) {
      const index=blocked.lastIndexOf(tag);
      if(index!==-1)blocked.splice(index);
    } else if(!PROSE_TAGS.has(tag) && !VOID_TAGS.has(tag) && !/\/\s*>$/.test(match[0]))blocked.push(tag);
    cursor=match.index!+match[0].length;
  }
  if(!blocked.length)parts.push(text.slice(cursor));
  // A partial custom tag at the end of a streamed/edited message is metadata.
  return parts.join('').replace(/<\/?([a-z][a-z0-9:_-]*)(?:\s[^<>]*)?$/gi,' ');
}

export function sanitizeSpeechText(raw:string,keepVocalTags=false):string {
  const text=decodeEntities(raw)
    .replace(/<!--\s*([a-z0-9_]+)_START\s*-->[\s\S]*?(?:<!--\s*\1_END\s*-->|$)/gi,' ')
    .replace(/<!--[\s\S]*?(?:-->|$)/g,' ')
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,' ')
    .replace(/(`+)[\s\S]*?\1/g,' ')
    .replace(/<!doctype\b[^>]*>/gi,' ');
  const tags=Array.from(text.matchAll(/<(\/?)([a-z][a-z0-9:_-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi));
  const paired=new Set<number>(),openings=new Map<string,number[]>();
  for(let i=0;i<tags.length;i++){
    const match=tags[i],name=match[2].toLowerCase();
    if(match[1]){const opening=openings.get(name)?.pop();if(opening!==undefined)paired.add(opening)}
    else if(!VOID_TAGS.has(name) && !/\/\s*>$/.test(match[0])){const stack=openings.get(name)??[];stack.push(i);openings.set(name,stack)}
  }
  const blocked:string[]=[],parts:string[]=[];let cursor=0;
  for(let i=0;i<tags.length;i++){
    const match=tags[i],name=match[2].toLowerCase();
    if(!blocked.length)parts.push(text.slice(cursor,match.index),' ');
    if(match[1]){const at=blocked.lastIndexOf(name);if(at!==-1)blocked.splice(at)}
    else if(!PROSE_TAGS.has(name) && !VOID_TAGS.has(name)){
      const vocal=!paired.has(i)?vocalTag(match[0]):undefined;
      if(vocal){if(!blocked.length && keepVocalTags)parts.push(vocal,' ')}
      else if(!/\/\s*>$/.test(match[0]))blocked.push(name);
    }
    cursor=match.index!+match[0].length;
  }
  if(!blocked.length)parts.push(text.slice(cursor));
  return parts.join('').replace(/<\/?([a-z][a-z0-9:_-]*)(?:\s[^<>]*)?$/gi,' ');
}
