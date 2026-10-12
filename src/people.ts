/**
 * People the story shows, found by reading it: names that speak ("Zoe said")
 * or that the story calls she or he. Also guesses whether each sounds female
 * or male from those pronouns. No model call; a guess can be wrong.
 */
import {NOT_NAMES,TITLES,SPEECH_VERBS} from './speaker-detect';
export interface Person {name:string;gender?:'f'|'m'}

const NOT_PEOPLE=new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december','god','gods','lord','lady','sir','madam','ma','mom','mum','dad','mother','father','okay','hey','hi','hello','please','thanks','sorry','no','yes','oh','um','uh','hmm','wait','look','listen','come','go','stop','let','don','didn','won','can','isn','wasn','that','this','what','where','when','why','how','who','which','whatever','nothing','everything','anything','somewhere','maybe','perhaps','not','never','always','all','some','any','each','every','most','many','much','more','less','first','last','next','other','another','such','very','too','also','only','just','even','still','yet','already','almost','enough','quite','rather','really','well','here','there','now','then','today','tonight','tomorrow','yesterday','chapter','part','scene','end','ooc','note','system','user','assistant','from','by','with','without','within','into','onto','upon','under','over','through','across','behind','beside','besides','between','beyond','inside','outside','near','toward','towards','during','until','till','since','because','though','although','unless','whether','once','twice','against','along','around','among','above','below','beneath','about','off','out','up','down','for','of','in','on','at','to','or','nor','like','despite','except','per','via','its','our','their','whose','something','someone','somebody','nobody','none','everyone','everybody','anyone','anybody',
  // Words that head status blocks and character sheets.
  'hair','skin','eyes','eye','height','weight','age','build','body','face','outfit','clothes','clothing','attire','wearing','mood','location','place','time','date','day','status','health','hp','notes','appearance','species','race','gender','sex','occupation','job','role','inventory','items','relationship','relationships','affection','trust','thoughts','thought','goal','goals','weather','scene','setting','name','nickname','personality','likes','dislikes','background','traits','skills','stats','level','money','current','present','nearby','characters','objective','quest','energy','stamina','arousal','emotion','emotions','feelings','condition','injuries','pose','posture','expression','voice','scent','smell']);
const FEMALE=/\b(she|her|hers|herself)\b/gi, MALE=/\b(he|him|his|himself)\b/gi;
const WORD=/\p{Lu}[\p{Ll}\p{M}'’-]+/gu;

function narration(text:string):string {
  return text.replace(/<[^>\n]{0,200}>/g,' ').replace(/\[[^\]\n]{0,200}\]/g,' ').replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»/g,' … ').replace(/[*_#>~`]/g,' ');
}
function sentences(text:string):string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).map(s=>s.trim()).filter(Boolean);
}
const usable=(word:string)=>{const w=word.replace(/['’]s$/,'').toLowerCase();return w.length>1 && !NOT_NAMES.has(w) && !TITLES.has(w) && !NOT_PEOPLE.has(w)};
const clean=(word:string)=>word.replace(/['’]s$/,'');

/** People in these story texts, most often mentioned first. `known` names are skipped. */
export function findPeople(texts:string[],known:string[]=[]):Person[] {
  const skip=new Set(known.flatMap(n=>[n.toLowerCase(),n.split(/\s+/)[0].toLowerCase()]));
  type Stat={name:string;seen:number;mid:number;speaks:number;f:number;m:number};
  const stats=new Map<string,Stat>();
  const stat=(name:string)=>{const key=name.toLowerCase();let s=stats.get(key);if(!s){s={name,seen:0,mid:0,speaks:0,f:0,m:0};stats.set(key,s)}return s};
  const verbAfter=new RegExp(String.raw`^\s*(?:\p{L}+ly\s+)?${SPEECH_VERBS}\b`,'iu'),verbBefore=new RegExp(String.raw`${SPEECH_VERBS}\s*$`,'iu');
  // A word the story also writes in lower case ("skin", "from", "early") is an ordinary word, not a name.
  const ordinary=new Set<string>();
  for(const text of texts)for(const m of text.matchAll(/(?<![\p{L}'’])\p{Ll}[\p{Ll}\p{M}'’-]*/gu))ordinary.add(m[0].replace(/['’]s$/,''));
  for(const text of texts){
    const list=sentences(narration(text));
    list.forEach((sentence,i)=>{
      // Labels in a status block ("Height: 5'6", "Eyes: green") are not people.
      const words=[...sentence.matchAll(WORD)].filter(m=>usable(m[0]) && !/^[\s*_|)\]]*[:：=]/.test(sentence.slice(m.index!+m[0].length)));
      const names=new Set(words.map(m=>clean(m[0]).toLowerCase()).filter(n=>!skip.has(n)));
      for(const m of words){
        const name=clean(m[0]);if(skip.has(name.toLowerCase()))continue;
        const s=stat(name);s.seen++;
        const before=sentence.slice(0,m.index).replace(/[\s…,;:—–-]+$/,'');
        if(before && !/[.!?…]$/.test(before))s.mid++;
        const after=sentence.slice(m.index!+m[0].length);
        if(verbAfter.test(after) || verbBefore.test(before))s.speaks++;
      }
      // Pronouns only count when one person is clearly the subject: first in
      // their sentence, alone in it, and the next sentence names nobody new.
      if(names.size!==1)return;
      const first=words.find(m=>!skip.has(clean(m[0]).toLowerCase()));
      if(!first || sentence.slice(0,first.index).match(WORD)?.some(w=>usable(w)))return;
      const s=stat(clean(first[0]));
      let window=sentence.slice(first.index!+first[0].length);
      const next=list[i+1];
      if(next){
        // A next sentence that opens with he or she points back at this person, even if it names a place.
        const others=[...next.matchAll(WORD)].filter(m=>usable(m[0]) && clean(m[0]).toLowerCase()!==s.name.toLowerCase());
        if(!others.length || /^(she|he|her|his)\b/i.test(next))window+=' '+next;
      }
      // "She" and "he" as a subject point back at this person most surely; "him" or "her" may be someone else.
      s.f+=(window.match(FEMALE)??[]).length+(window.match(/\bshe\b/gi)??[]).length;s.m+=(window.match(MALE)??[]).length+(window.match(/\bhe\b/gi)??[]).length;
    });
  }
  const people:Person[]=[];
  for(const s of [...stats.values()].sort((a,b)=>b.seen-a.seen)){
    const pronouns=s.f+s.m;
    // A name, not just a capitalized first word: seen mid-sentence or more than once.
    // A name speaks ("Zoe said"), or is called she or he and is never also
    // written in lower case as an ordinary word.
    // An ordinary word ("hair", "skin") is never a person, even next to "said".
    if(ordinary.has(s.name.toLowerCase()))continue;
    if(!s.speaks){
      if(pronouns<2)continue;
      // Only ever seen opening a sentence: "Scraped", "Running" or "Early" are words, not names.
      if(!s.mid && s.name.length>4 && /(ed|ing|ly)$/i.test(s.name))continue;
    }
    const gender=pronouns>=2 && s.f>=pronouns*.75?'f':pronouns>=2 && s.m>=pronouns*.75?'m':undefined;
    people.push({name:s.name,...(gender?{gender}:{})});
  }
  return people.slice(0,60);
}
