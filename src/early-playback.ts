export const EARLY_PLAYBACK_FRACTION=.75;
export const EARLY_PLAYBACK_SECONDS=30;
/** Completed responses can arrive out of order. Only the opening audio counts. */
export function earlyPlaybackPrefix(texts:string[],clips:({duration:number}|undefined)[]):number {
  let count=0,chars=0,seconds=0;
  while(count<texts.length && clips[count]){chars+=texts[count].length;seconds+=clips[count]!.duration;count++}
  if(count===texts.length)return count;
  const total=texts.reduce((sum,text)=>sum+text.length,0);
  return total>0 && chars/total>=EARLY_PLAYBACK_FRACTION && seconds>=EARLY_PLAYBACK_SECONDS?count:0;
}
