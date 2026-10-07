export function redactSecrets(message: string, secret?: string | null): string {
  if (secret) message = message.split(secret).join('[redacted]');
  return message.replace(/Bearer\s+[^\s"']+|sk-or-v1-[^\s"']+/gi,'[redacted]');
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
