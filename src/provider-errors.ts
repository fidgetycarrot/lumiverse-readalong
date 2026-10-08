export function redactSecrets(message: string, secret?: string | null): string {
  if (secret) for(const value of new Set([secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)])) message = message.split(value).join('[redacted]');
  return message.replace(/Bearer\s+[^\s"']+|sk-or-v1-[^\s"']+|\bsk-[a-z0-9_-]{8,}|\bAIza[a-z0-9_-]{20,}/gi,'[redacted]')
    .replace(/((?:api[_ -]?key|authorization|access[_ -]?token|secret)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]');
}

// Native keys stay in Lumiverse, so we cannot redact an arbitrary value by
// comparison. Map upstream errors to fixed hints instead of copying prose.
export function nativeProviderError(status:number,body:string):string {
  let message='';try{const data=JSON.parse(body);message=typeof data.error==='string'?data.error:data.error?.message??data.message??''}catch{}
  const hints:[RegExp,string][]=[
    [/only supports.*pcm|response_format.*pcm/i,'This Gemini model requires PCM audio.'],
    [/insufficient.*credit|credit.*(?:exhaust|balance)|payment required/i,'Check your speech credit and spending limit.'],
    [/api.?key|unauthori[sz]ed|authentication|credential/i,'Check the saved API key in Lumiverse’s voice settings.'],
    [/rate.?limit|too many requests/i,'The provider is rate limited. Wait before trying again.'],
    [/voice.*(?:reject|invalid|unsupported|not found)/i,'Check that the selected voice is supported by this model.'],
    [/model.*(?:unavailable|not found|unsupported|access)/i,'Check model availability and access for this connection.'],
  ];
  const hint=hints.find(([pattern])=>pattern.test(String(message)))?.[1];
  return `${status>=400?providerError('Lumiverse TTS',status,''):'Lumiverse could not complete the TTS request.'}${hint?` ${hint}`:''}`;
}

export function providerError(label: string, status: number, body: string, secret?: string | null): string {
  let detail = '';
  try {
    const data = JSON.parse(body);
    const error = data?.error;
    detail = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
  } catch {}
  // Do not forward metadata, request echoes, HTML, or raw provider response bodies.
  detail = redactSecrets(detail,secret).replace(/[\u0000-\u001f]/g,' ').slice(0,600);
  const hints: Record<number,string> = {
    400:'Check the selected model, voice, and output format.',
    401:'Save a valid API key for this connection.',
    402:'Check your speech credit and API key spending limit.',
    403:'Check this key’s access to the selected model and provider.',
    404:'Check model availability and provider routing in your account.',
    429:'The provider is rate limited. Wait before trying again.',
  };
  return `${label} returned HTTP ${status}${detail ? `: ${detail}` : '.'}${hints[status] ? ` ${hints[status]}` : ''}`;
}

export function isHiddenJsonError(error: unknown): boolean {
  return error instanceof Error && /only serves audio data.*application\/(?:json|[\w.-]+\+json)/i.test(error.message);
}
