import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { routeRequest } from '../../services/router.js';
import { resolveProvider, getProvider } from '../../providers/index.js';

async function request(app: Express, method: string, path: string, body?: any) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('resolveProvider (custom)', () => {
  it('builds a custom provider bound to the supplied base URL', () => {
    const p = resolveProvider('custom', 'http://127.0.0.1:8080/v1');
    expect(p).toBeDefined();
    expect(p!.platform).toBe('custom');
    expect((p as any).baseUrl).toBe('http://127.0.0.1:8080/v1');
  });

  it('returns undefined for a custom provider with no base URL', () => {
    expect(resolveProvider('custom', null)).toBeUndefined();
    expect(resolveProvider('custom', '   ')).toBeUndefined();
  });

  it('returns the registered singleton for built-in platforms', () => {
    expect(resolveProvider('groq')).toBe(getProvider('groq'));
  });
});

describe('POST /api/keys/custom', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM api_keys WHERE platform = 'custom'").run();
    db.prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'custom')").run();
    db.prepare("DELETE FROM models WHERE platform = 'custom'").run();
  });

  it('rejects an invalid base URL', async () => {
    const { status } = await request(app, 'POST', '/api/keys/custom', { baseUrl: 'not-a-url', model: 'm' });
    expect(status).toBe(400);
  });

  it('rejects missing model', async () => {
    const { status } = await request(app, 'POST', '/api/keys/custom', { baseUrl: 'http://127.0.0.1:11434/v1' });
    expect(status).toBe(400);
  });

  it('registers a custom endpoint, model, and fallback entry', async () => {
    const { status, body } = await request(app, 'POST', '/api/keys/custom', {
      baseUrl: 'http://127.0.0.1:11434/v1/',
      model: 'qwen3:4b',
      displayName: 'Local Qwen3 4B',
    });
    expect(status).toBe(201);
    expect(body.platform).toBe('custom');
    expect(body.baseUrl).toBe('http://127.0.0.1:11434/v1'); // trailing slash trimmed
    expect(body.model).toBe('qwen3:4b');

    const db = getDb();
    const key = db.prepare("SELECT * FROM api_keys WHERE platform = 'custom'").get() as any;
    expect(key.base_url).toBe('http://127.0.0.1:11434/v1');
    const model = db.prepare("SELECT * FROM models WHERE platform = 'custom' AND model_id = 'qwen3:4b'").get() as any;
    expect(model).toBeDefined();
    const fc = db.prepare('SELECT * FROM fallback_config WHERE model_db_id = ?').get(model.id);
    expect(fc).toBeDefined();
  });

  it('reuses the single custom key when a second model is added', async () => {
    await request(app, 'POST', '/api/keys/custom', { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3:8b' });
    await request(app, 'POST', '/api/keys/custom', { baseUrl: 'http://127.0.0.1:11434/v1', model: 'phi3:mini' });
    const db = getDb();
    const keys = db.prepare("SELECT * FROM api_keys WHERE platform = 'custom'").all();
    expect(keys.length).toBe(1);
    const models = db.prepare("SELECT * FROM models WHERE platform = 'custom'").all();
    expect(models.length).toBe(2);
  });

  it('surfaces baseUrl in the keys listing', async () => {
    await request(app, 'POST', '/api/keys/custom', { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3:8b' });
    const { body } = await request(app, 'GET', '/api/keys');
    const custom = body.find((k: any) => k.platform === 'custom');
    expect(custom.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  it('routes a request to the custom model through its base URL', async () => {
    await request(app, 'POST', '/api/keys/custom', { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:4b' });
    const route = routeRequest(1000);
    expect(route.platform).toBe('custom');
    expect((route.provider as any).baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(route.modelId).toBe('qwen3:4b');
  });
});
