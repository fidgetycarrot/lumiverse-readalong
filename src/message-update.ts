import type {MessageInfo} from './shared';

/** Attachments and other metadata edits must not cancel paid speech. */
export function readingChanged(current:MessageInfo,updated:unknown):boolean|undefined {
  if(!updated || typeof updated!=='object')return;
  const message=updated as Record<string,unknown>;
  if(message.id!==current.id || typeof message.content!=='string')return;
  const isUser=typeof message.is_user==='boolean'?message.is_user:message.isUser;
  return message.content!==current.content
    || typeof message.name==='string' && message.name!==(current.name??'')
    || typeof isUser==='boolean' && isUser!==current.isUser;
}
