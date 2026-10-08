// Keep ordinary HTML prose. Custom tags describe UI, tools, or model metadata
// and must be removed together with their contents before detecting speakers.
const PROSE_TAGS = new Set(`p div span section article header footer main aside nav address blockquote q cite figure figcaption hgroup ul ol li dl dt dd menu br hr wbr h1 h2 h3 h4 h5 h6 b strong i em u s strike del ins mark small big sub sup abbr acronym dfn kbd samp var time font tt bdi bdo data ruby rb rp rt rtc a table thead tbody tfoot tr td th caption col colgroup label legend fieldset`.split(' '));
const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const ENTITIES:Record<string,string> = {nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’'};
// Gemini 3.8 vocal events are standalone tokens, not enclosing XML blocks.
// https://ai.google.dev/gemini-api/docs/speech-generation#vocal-bursts-and-non-speech-sounds
export const VOCAL_TAGS = ['laugh','laughter','chuckle','chuckles','giggle','snicker','cackle','cheer','gasp','sigh','sighs','groan','grunt','grr','growl','hiss','moan','pant','pff','phew','tsk','whispers','whispering','shout','argh','whimper','cry','sob','scream','shriek','snort','breath','heavy breath','exhales','cough','throat-clearing','sneeze','yawn','short pause','long pause'] as const;
const vocalTags=new Set<string>(VOCAL_TAGS);
function vocalTag(tag:string):string|undefined {
  const match=/^<([a-z][a-z\s-]*?)\s*\/?>$/i.exec(tag);
  const name=match?.[1].toLowerCase().trim().replace(/\s+/g,' ');
  return name && vocalTags.has(name)?`<${name}>`:undefined;
}
export function stripVocalTags(text:string,preserveOffsets=false):string {
  return text.replace(/<[^<>]*>/g,tag=>vocalTag(tag)?' '.repeat(preserveOffsets?tag.length:1):tag);
}

function decodeEntities(text:string):string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(entity,name:string)=>{
    if(name[0]!=='#')return ENTITIES[name.toLowerCase()] ?? entity;
    const code=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);
    return code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff)?String.fromCodePoint(code):entity;
  });
}

export function sanitizeSpeechText(raw:string,keepVocalTags=false):string {
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
    const vocal=vocalTag(match[0]);
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
