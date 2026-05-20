import crypto from 'crypto';
import type { Request } from 'express';
import { getUnifiedApiKey } from '../db/index.js';

export function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}

function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth) return undefined;
  const bearer = auth.replace(/^Bearer\s+/i, '');
  return bearer.length > 0 ? bearer : undefined;
}

/** Anthropic clients send `x-api-key`; OpenAI clients send `Authorization: Bearer`. */
export function extractProxyApiKey(req: Request): string | undefined {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.length > 0) return headerKey;
  if (Array.isArray(headerKey) && headerKey[0]) return headerKey[0];
  return extractBearerToken(req);
}

export function isLocalProxyRequest(req: Request): boolean {
  return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
}

export function authenticateProxyRequest(req: Request): boolean {
  if (isLocalProxyRequest(req)) return true;
  const token = extractProxyApiKey(req);
  const unifiedKey = getUnifiedApiKey();
  return !!token && timingSafeStringEqual(token, unifiedKey);
}
