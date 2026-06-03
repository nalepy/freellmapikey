import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Platform } from '@freellmapikey/shared/types.js';
import { getDb } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { authenticateProxyRequest } from '../lib/proxy-auth.js';
import { getProvider } from '../providers/index.js';
import { isOnCooldown, setCooldown } from '../services/ratelimit.js';

export const embeddingsRouter = Router();

const embeddingsSchema = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  model: z.string().optional(),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().positive().optional(),
  user: z.string().optional(),
});

// Returns the first non-cooled-down key for the platform, or null.
function pickKey(platform: Platform, modelId: string): { key: string; keyId: number } | null {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, encrypted_key, iv, auth_tag FROM api_keys WHERE platform = ? AND enabled = 1 AND status != 'invalid'",
  ).all(platform) as Array<{ id: number; encrypted_key: string; iv: string; auth_tag: string }>;
  for (const row of rows) {
    if (isOnCooldown(platform, modelId, row.id)) continue;
    return { key: decrypt(row.encrypted_key, row.iv, row.auth_tag), keyId: row.id };
  }
  return null;
}

embeddingsRouter.post('/embeddings', async (req: Request, res: Response) => {
  if (!authenticateProxyRequest(req)) {
    res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
    return;
  }

  const parsed = embeddingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    });
    return;
  }

  const { input: rawInput, model: requestedModel, dimensions } = parsed.data;
  const inputs = Array.isArray(rawInput) ? rawInput : [rawInput];
  const m = requestedModel ?? 'auto';

  // Build ordered list of (platform, modelId) candidates
  const candidates: Array<{ platform: Platform; modelId: string }> = [];

  if (m === 'auto') {
    candidates.push({ platform: 'google', modelId: 'text-embedding-004' });
    candidates.push({ platform: 'mistral', modelId: 'mistral-embed' });
  } else if (m.startsWith('text-embedding') || m.startsWith('text-multilingual')) {
    candidates.push({ platform: 'google', modelId: m });
  } else if (m === 'mistral-embed') {
    candidates.push({ platform: 'mistral', modelId: m });
  } else {
    // Unknown model — default to Google then Mistral
    candidates.push({ platform: 'google', modelId: 'text-embedding-004' });
    candidates.push({ platform: 'mistral', modelId: 'mistral-embed' });
  }

  const startTime = Date.now();
  let lastError: Error | undefined;

  for (const { platform, modelId } of candidates) {
    const provider = getProvider(platform);
    if (!provider?.supportsEmbeddings || !provider.embeddings) continue;

    const keyResult = pickKey(platform, modelId);
    if (!keyResult) continue;

    try {
      const result = await provider.embeddings(keyResult.key, inputs, modelId, { dimensions });
      getDb().prepare(
        "INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms) VALUES (?, ?, 'success', 0, 0, ?)",
      ).run(platform, modelId, Date.now() - startTime);
      res.json(result);
      return;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message ?? '';
      const is429 = msg.includes('429') || /rate.?limit/i.test(msg);
      if (is429) setCooldown(platform, modelId, keyResult.keyId);
      getDb().prepare(
        "INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error) VALUES (?, ?, 'error', 0, 0, ?, ?)",
      ).run(platform, modelId, Date.now() - startTime, msg.slice(0, 500));
    }
  }

  res.status(503).json({
    error: {
      message: lastError
        ? `Embedding failed: ${lastError.message}`
        : 'No embedding provider available with a valid API key',
      type: 'service_unavailable',
    },
  });
});
