import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb, getUnifiedApiKey } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let dashToken = '';

async function request(app: Express, method: string, path: string, body?: any, apiKey?: string) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (isGatedApiPath(path) && !apiKey) headers['Authorization'] = `Bearer ${dashToken}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.text();
  server.close();

  let json: any = null;
  try { json = JSON.parse(data); } catch {}

  return { status: res.status, body: json };
}

const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => i * 0.001);

const MOCK_GOOGLE_SINGLE = {
  embedding: { values: MOCK_EMBEDDING },
};

const MOCK_GOOGLE_BATCH = {
  embeddings: [
    { values: MOCK_EMBEDDING },
    { values: MOCK_EMBEDDING },
  ],
};

const MOCK_MISTRAL_RESPONSE = {
  object: 'list',
  data: [
    { object: 'embedding', embedding: Array.from({ length: 1024 }, (_, i) => i * 0.001), index: 0 },
  ],
  model: 'mistral-embed',
  usage: { prompt_tokens: 5, total_tokens: 5 },
};

describe('POST /v1/embeddings', () => {
  let app: Express;
  let unifiedKey: string;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    unifiedKey = getUnifiedApiKey();
    dashToken = mintDashboardToken();
  });

  beforeEach(async () => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();

    await request(app, 'POST', '/api/keys', {
      platform: 'google',
      key: 'google-test-key',
      label: 'test',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 without a valid API key', async () => {
    const { status } = await request(app, 'POST', '/v1/embeddings', { input: 'hello' }, 'wrong-key');
    expect(status).toBe(401);
  });

  it('returns 400 for missing input', async () => {
    const { status, body } = await request(app, 'POST', '/v1/embeddings', { model: 'text-embedding-004' }, unifiedKey);
    expect(status).toBe(400);
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('returns 400 for empty string input', async () => {
    const { status, body } = await request(app, 'POST', '/v1/embeddings', { input: '' }, unifiedKey);
    expect(status).toBe(400);
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('normalizes string input to array and returns correct shape (single)', async () => {
    const origFetch = fetch;
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('embedContent')) {
        return { ok: true, json: () => Promise.resolve(MOCK_GOOGLE_SINGLE) } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/embeddings', {
      input: 'hello world',
      model: 'text-embedding-004',
    }, unifiedKey);

    expect(status).toBe(200);
    expect(body.object).toBe('list');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].object).toBe('embedding');
    expect(body.data[0].index).toBe(0);
    expect(Array.isArray(body.data[0].embedding)).toBe(true);
    expect(body.model).toBe('text-embedding-004');
    expect(body.usage).toHaveProperty('prompt_tokens');
    expect(body.usage).toHaveProperty('total_tokens');
  });

  it('uses batch endpoint for array input', async () => {
    const origFetch = fetch;
    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        capturedUrl = urlStr;
        return { ok: true, json: () => Promise.resolve(MOCK_GOOGLE_BATCH) } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/embeddings', {
      input: ['hello', 'world'],
      model: 'text-embedding-004',
    }, unifiedKey);

    expect(status).toBe(200);
    expect(capturedUrl).toContain('batchEmbedContents');
    expect(body.data).toHaveLength(2);
  });

  it('auto-routing: uses google when no model specified', async () => {
    const origFetch = fetch;
    let calledUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        calledUrl = urlStr;
        return { ok: true, json: () => Promise.resolve(MOCK_GOOGLE_SINGLE) } as any;
      }
      return origFetch(url, init);
    });

    const { status } = await request(app, 'POST', '/v1/embeddings', { input: 'test' }, unifiedKey);

    expect(status).toBe(200);
    expect(calledUrl).toContain('generativelanguage.googleapis.com');
  });

  it('auto-routing: falls back to Mistral when Google has no key', async () => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();

    await request(app, 'POST', '/api/keys', {
      platform: 'mistral',
      key: 'mistral-test-key',
      label: 'test',
    });

    const origFetch = fetch;
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.mistral.ai')) {
        return { ok: true, json: () => Promise.resolve(MOCK_MISTRAL_RESPONSE) } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/embeddings', { input: 'test' }, unifiedKey);

    expect(status).toBe(200);
    expect(body.model).toBe('mistral-embed');
  });

  it('returns 503 when no keys are available', async () => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();

    const { status, body } = await request(app, 'POST', '/v1/embeddings', { input: 'test' }, unifiedKey);

    expect(status).toBe(503);
    expect(body.error.type).toBe('service_unavailable');
  });

  it('routes text-multilingual-embedding model to Google', async () => {
    const origFetch = fetch;
    let calledUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        calledUrl = urlStr;
        return { ok: true, json: () => Promise.resolve(MOCK_GOOGLE_SINGLE) } as any;
      }
      return origFetch(url, init);
    });

    const { status } = await request(app, 'POST', '/v1/embeddings', {
      input: 'hello',
      model: 'text-multilingual-embedding-002',
    }, unifiedKey);

    expect(status).toBe(200);
    expect(calledUrl).toContain('generativelanguage.googleapis.com');
    expect(calledUrl).toContain('text-multilingual-embedding-002');
  });
});
