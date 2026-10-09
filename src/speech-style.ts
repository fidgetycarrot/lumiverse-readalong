/** Gemini 3.8 delivery guidance is metadata, never part of the spoken text. */
export const isGeminiSpeechStyleModel=(model:string)=>/(?:^|\/)gemini-3\.8-flash(?:-lite)?-tts(?:$|[-:])/i.test(model);
export function deliveryStyle(emotion:string,delivery:string):string {
  const emotions:Record<string,string>={happy:'happy and cheerful',sad:'sad',angry:'angry',worried:'worried',curious:'curious',excited:'excited',sarcastic:'sarcastic',tender:'warm and tender',afraid:'afraid'};
  const deliveries:Record<string,string>={whispers:'whispering',shouts:'shouting',softly:'soft-spoken',slowly:'slow and deliberate',laughs:'with a light laugh',sighs:'with a sigh'};
  return [emotions[emotion],deliveries[delivery]].filter(Boolean).join(', ');
}
export function combineSpeechStyle(base:string,direction:string):string {
  return [base.trim(),direction?`For this passage, speak ${direction}.`:''].filter(Boolean).join('\n');
}
