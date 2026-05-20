import { describe, expect, it } from 'vitest';
import { categorizeErrorMessage, sanitizeErrorText } from '../../lib/error-log.js';

describe('error-log', () => {
  it('redacts base64 image data from messages', () => {
    const raw = 'SambaNova API error 400: data:image/png;base64,AAAA' + 'x'.repeat(200);
    const out = sanitizeErrorText(raw);
    expect(out).toContain('[base64-redacted]');
    expect(out).not.toContain('AAAA');
  });

  it('categorizes provider errors', () => {
    expect(categorizeErrorMessage('SambaNova API error 400: could not process')).toBe('Bad Request (400)');
    expect(categorizeErrorMessage('Google API error 429: quota')).toBe('Rate Limited (429)');
  });
});
