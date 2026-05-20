import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';

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

describe('Fallback API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  it('GET /api/fallback returns fallback chain', async () => {
    const { status, body } = await request(app, 'GET', '/api/fallback');
    expect(status).toBe(200);
    expect(body.visionOnlyRouting).toBe(false);
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThan(0);
    for (let i = 1; i < body.entries.length; i++) {
      expect(body.entries[i].priority).toBeGreaterThanOrEqual(body.entries[i - 1].priority);
    }
  });

  it('GET /api/fallback entries have expected fields', async () => {
    const { body } = await request(app, 'GET', '/api/fallback');
    const first = body.entries[0];
    expect(first).toHaveProperty('modelDbId');
    expect(first).toHaveProperty('priority');
    expect(first).toHaveProperty('enabled');
    expect(first).toHaveProperty('platform');
    expect(first).toHaveProperty('displayName');
    expect(first).toHaveProperty('intelligenceRank');
    expect(first).toHaveProperty('supportsVision');
    expect(typeof first.supportsVision).toBe('boolean');
  });

  it('GET /api/fallback marks Gemini models as vision-capable', async () => {
    const { body } = await request(app, 'GET', '/api/fallback');
    const gemini = body.entries.find((e: { platform: string; modelId: string }) =>
      e.platform === 'google' && String(e.modelId).includes('gemini'));
    expect(gemini).toBeDefined();
    expect(gemini.supportsVision).toBe(true);
  });

  it('PUT /api/fallback/vision-only toggles routing mode', async () => {
    const on = await request(app, 'PUT', '/api/fallback/vision-only', { enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.visionOnlyRouting).toBe(true);

    const getOn = await request(app, 'GET', '/api/fallback');
    expect(getOn.body.visionOnlyRouting).toBe(true);

    const off = await request(app, 'PUT', '/api/fallback/vision-only', { enabled: false });
    expect(off.body.visionOnlyRouting).toBe(false);
  });

  it('PUT /api/fallback updates order', async () => {
    const { body: chain } = await request(app, 'GET', '/api/fallback');
    const original = chain.entries;

    const reversed = original.map((e: any, i: number) => ({
      modelDbId: e.modelDbId,
      priority: original.length - i,
      enabled: e.enabled,
    }));

    const { status } = await request(app, 'PUT', '/api/fallback', reversed);
    expect(status).toBe(200);

    const { body: afterChain } = await request(app, 'GET', '/api/fallback');
    expect(afterChain.entries[0].modelDbId).toBe(original[original.length - 1].modelDbId);

    const restore = original.map((e: any, i: number) => ({
      modelDbId: e.modelDbId,
      priority: i + 1,
      enabled: e.enabled,
    }));
    await request(app, 'PUT', '/api/fallback', restore);
  });

  it('POST /api/fallback/sort/intelligence sorts by intelligence', async () => {
    const { status } = await request(app, 'POST', '/api/fallback/sort/intelligence');
    expect(status).toBe(200);

    const { body } = await request(app, 'GET', '/api/fallback');
    for (let i = 1; i < body.entries.length; i++) {
      expect(body.entries[i].intelligenceRank).toBeGreaterThanOrEqual(body.entries[i - 1].intelligenceRank);
    }
  });

  it('POST /api/fallback/sort/speed sorts by speed', async () => {
    const { status } = await request(app, 'POST', '/api/fallback/sort/speed');
    expect(status).toBe(200);

    const { body } = await request(app, 'GET', '/api/fallback');
    for (let i = 1; i < body.entries.length; i++) {
      expect(body.entries[i].speedRank).toBeGreaterThanOrEqual(body.entries[i - 1].speedRank);
    }
  });

  it('POST /api/fallback/sort/invalid returns 400', async () => {
    const { status } = await request(app, 'POST', '/api/fallback/sort/invalid');
    expect(status).toBe(400);
  });
});
