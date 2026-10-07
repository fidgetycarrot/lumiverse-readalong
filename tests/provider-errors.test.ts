import {test,expect} from 'bun:test';
import {providerError,isHiddenJsonError} from '../src/provider-errors';

test('provider errors show the status and message without dumping response bodies',()=>{
  expect(providerError('OpenRouter',403,JSON.stringify({error:{message:'Model blocked',metadata:{private:'secret'}}}))).toContain('HTTP 403: Model blocked');
  expect(providerError('OpenRouter',502,'<html>private upstream details</html>')).toBe('OpenRouter returned HTTP 502.');
});
test('provider error messages redact arbitrary local credentials and bearer tokens',()=>{
  const r=providerError('Local',401,JSON.stringify({error:'Rejected custom-private-key and Bearer other-token'}),'custom-private-key');
  expect(r).not.toContain('custom-private-key');expect(r).not.toContain('other-token');expect(r).toContain('[redacted]');
});
test('only the host’s JSON media rejection enables a speech diagnostic',()=>{
  expect(isHiddenJsonError(new Error('CORS proxy transparent proxy only serves audio data (received Content-Type: application/json)'))).toBe(true);
  expect(isHiddenJsonError(new Error('CORS proxy transparent proxy only serves audio data (received Content-Type: application/problem+json)'))).toBe(true);
  expect(isHiddenJsonError(new Error('Speech canceled.'))).toBe(false);
  expect(isHiddenJsonError(new Error('CORS proxy permission not granted'))).toBe(false);
});
