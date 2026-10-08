import type {MessageInfo} from './shared';
export interface CompletionTicket {chatId:string;messageId:string;generationId:string;completedAt:number;characterId?:string;name?:string}
export interface CompletedReply extends CompletionTicket {message:MessageInfo}
/** Metadata only, bounded and scoped to the authenticated event owner. */
export class CompletionRegistry {
  private entries=new Map<string,{userId:string;ticket:CompletionTicket}>();
  constructor(private now=Date.now,private ttl=24*60*60*1000,private limit=1000){}
  remember(userId:string,ticket:CompletionTicket){
    const key=JSON.stringify([userId,ticket.chatId]),prior=this.entries.get(key);
    if(prior && prior.ticket.completedAt>ticket.completedAt)return;
    // Project fields rather than retaining extra event data such as message text.
    const metadata:CompletionTicket={chatId:ticket.chatId,messageId:ticket.messageId,generationId:ticket.generationId,completedAt:ticket.completedAt,
      ...(ticket.characterId?{characterId:ticket.characterId}:{}),...(ticket.name?{name:ticket.name}:{})};
    this.entries.delete(key);this.entries.set(key,{userId,ticket:metadata});
    for(const [id,value] of this.entries)if(value.ticket.completedAt<this.now()-this.ttl)this.entries.delete(id);
    while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value!);
  }
  latest(userId:string,chatId:string,since:number):CompletionTicket|undefined {
    const entry=this.entries.get(JSON.stringify([userId,chatId]));
    return entry && entry.ticket.completedAt>=Math.max(since,this.now()-this.ttl)?entry.ticket:undefined;
  }
}
/** Keep completions received during setup; history restoration is not a completion. */
export class CompletionInbox {
  private pending=new Map<string,CompletedReply>();
  private enabled:boolean|undefined;
  since:number;
  constructor(now=Date.now()){this.since=now}
  initialize(enabled:boolean){this.enabled=enabled;if(!enabled)this.pending.clear()}
  reset(now=Date.now()){this.since=now;this.pending.clear()}
  setEnabled(enabled:boolean,now=Date.now()){this.enabled=enabled;this.reset(now)}
  receive(reply:CompletedReply):boolean {
    if(this.enabled===false || reply.message.isUser || reply.completedAt<this.since)return false;
    const prior=this.pending.get(reply.chatId);
    if(prior && prior.completedAt>reply.completedAt)return false;
    this.pending.set(reply.chatId,reply);
    while(this.pending.size>20)this.pending.delete(this.pending.keys().next().value!);
    return true;
  }
  take(chatId:string){if(this.enabled!==true)return;const reply=this.pending.get(chatId);this.pending.delete(chatId);return reply}
}
