import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';

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

describe('Keys API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
  });

  it('GET /api/keys returns empty array initially', async () => {
    const { status, body } = await request(app, 'GET', '/api/keys');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('POST /api/keys creates a new key', async () => {
    const { status, body } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123456789',
      label: 'My Groq Key',
    });

    expect(status).toBe(201);
    expect(body.platform).toBe('groq');
    expect(body.label).toBe('My Groq Key');
    expect(body.maskedKey).toContain('...');
  });

  it('GET /api/keys returns the created key', async () => {
    // First create a key
    await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123456789',
    });

    const { status, body } = await request(app, 'GET', '/api/keys');
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].platform).toBe('groq');
  });

  it('POST /api/keys rejects invalid platform', async () => {
    const { status } = await request(app, 'POST', '/api/keys', {
      platform: 'invalid_platform',
      key: 'test',
    });
    expect(status).toBe(400);
  });

  it('POST /api/keys rejects missing key', async () => {
    const { status } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
    });
    expect(status).toBe(400);
  });

  it('DELETE /api/keys/:id removes a key', async () => {
    const { body: created } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123456789',
    });

    const { status } = await request(app, 'DELETE', `/api/keys/${created.id}`);
    expect(status).toBe(200);

    const { body: after } = await request(app, 'GET', '/api/keys');
    expect(after).toHaveLength(0);
  });

  it('DELETE /api/keys/:id returns 404 for nonexistent key', async () => {
    const { status } = await request(app, 'DELETE', '/api/keys/99999');
    expect(status).toBe(404);
  });

  it('PATCH /api/keys/:id updates label', async () => {
    const { body: created } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123',
      label: 'old label',
    });

    const { status, body } = await request(app, 'PATCH', `/api/keys/${created.id}`, {
      label: 'new label',
    });
    expect(status).toBe(200);
    expect(body.label).toBe('new label');
  });

  it('POST /api/keys/custom registers a local endpoint and model', async () => {
    const { status, body } = await request(app, 'POST', '/api/keys/custom', {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      displayName: 'Llama 3.2 (local)',
    });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.platform).toBe('custom');
    expect(body.baseUrl).toBe('http://localhost:11434/v1');
    expect(body.model).toBe('llama3.2');

    // Key row should exist and carry baseUrl
    const { body: keys } = await request(app, 'GET', '/api/keys');
    const customKey = keys.find((k: any) => k.platform === 'custom');
    expect(customKey).toBeDefined();
    expect(customKey.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('POST /api/keys/custom rejects missing baseUrl', async () => {
    const { status } = await request(app, 'POST', '/api/keys/custom', {
      model: 'llama3.2',
    });
    expect(status).toBe(400);
  });

  it('POST /api/keys/custom rejects missing model', async () => {
    const { status } = await request(app, 'POST', '/api/keys/custom', {
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(status).toBe(400);
  });

  it('POST /api/keys/custom is idempotent — re-submitting updates the endpoint', async () => {
    await request(app, 'POST', '/api/keys/custom', {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    });
    await request(app, 'POST', '/api/keys/custom', {
      baseUrl: 'http://localhost:1234/v1',
      model: 'phi-3',
    });

    const { body: keys } = await request(app, 'GET', '/api/keys');
    // Should have exactly 1 custom key row (reused)
    const customKeys = keys.filter((k: any) => k.platform === 'custom');
    expect(customKeys).toHaveLength(1);
    expect(customKeys[0].baseUrl).toBe('http://localhost:1234/v1');
  });

  it('PATCH /api/keys/platform/:platform toggles all keys for a platform', async () => {
    await request(app, 'POST', '/api/keys', { platform: 'groq', key: 'key1' });
    await request(app, 'POST', '/api/keys', { platform: 'groq', key: 'key2' });

    const { status, body } = await request(app, 'PATCH', '/api/keys/platform/groq', {
      enabled: false,
    });
    expect(status).toBe(200);
    expect(body.updatedKeys).toBe(2);
  });
});
