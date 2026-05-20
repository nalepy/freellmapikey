import crypto from 'crypto';
import type { Response } from 'express';
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatMessage,
  ChatToolChoice,
  ChatToolDefinition,
} from '@freellmapi/shared/types.js';
import { getDb } from '../db/index.js';
import { routeRequest, recordRateLimitHit, recordSuccess, type RouteResult } from './router.js';
import { recordRequest, recordTokens, setCooldown } from './ratelimit.js';

export const MAX_COMPLETION_RETRIES = 20;

/** Client labels that mean "use the fallback chain" (not a real catalog model). */
export const AUTO_MODEL_ALIASES = new Set([
  'auto',
  'freellmapi-auto',
  'freellmapi/auto',
]);

// Sticky sessions: track which model served each "session"
const stickySessionMap = new Map<string, { modelDbId: number; lastUsed: number }>();
const STICKY_TTL_MS = 30 * 60 * 1000;

function getSessionKey(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser || typeof firstUser.content !== 'string') return '';
  const hash = crypto.createHash('sha1').update(firstUser.content).digest('hex');
  return `${hash}:${messages.length > 2 ? 'multi' : 'single'}`;
}

function getStickyModel(messages: ChatMessage[]): number | undefined {
  const hasAssistant = messages.some(m => m.role === 'assistant');
  if (!hasAssistant) return undefined;

  const key = getSessionKey(messages);
  if (!key) return undefined;

  const entry = stickySessionMap.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.lastUsed > STICKY_TTL_MS) {
    stickySessionMap.delete(key);
    return undefined;
  }
  return entry.modelDbId;
}

function setStickyModel(messages: ChatMessage[], modelDbId: number) {
  const key = getSessionKey(messages);
  if (!key) return;
  stickySessionMap.set(key, { modelDbId, lastUsed: Date.now() });

  if (stickySessionMap.size > 500) {
    const now = Date.now();
    for (const [k, v] of stickySessionMap) {
      if (now - v.lastUsed > STICKY_TTL_MS) stickySessionMap.delete(k);
    }
  }
}

export function isRetryableProviderError(err: any): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')
    || msg.includes('quota') || msg.includes('resource_exhausted')
    || msg.includes('aborted') || msg.includes('timeout') || msg.includes('etimedout')
    || msg.includes('econnrefused') || msg.includes('econnreset')
    || msg.includes('503') || msg.includes('unavailable')
    || msg.includes('500') || msg.includes('internal server error');
}

export interface ChatCompletionInput {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  /** When true, unknown model IDs auto-route (Anthropic clients send claude-* names). */
  allowUnknownModel?: boolean;
}

export interface CompletionErrorBody {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

export interface ChatCompletionHandlers {
  onRoutingError: (status: number, body: CompletionErrorBody) => void;
  onModelNotFound: (body: CompletionErrorBody) => void;
  onRateLimited: (body: CompletionErrorBody) => void;
  onProviderError: (status: number, body: CompletionErrorBody) => void;
  onStreamStart: (route: RouteResult, attempt: number) => void;
  onStreamChunk: (chunk: ChatCompletionChunk) => void;
  onStreamDone: (route: RouteResult, inputTokens: number, outputTokens: number, latencyMs: number) => void;
  onStreamInterrupted: (route: RouteResult, inputTokens: number, outputTokens: number, latencyMs: number, err: Error) => void;
  onSuccess: (result: ChatCompletionResponse, route: RouteResult, attempt: number, latencyMs: number) => void;
}

function resolvePreferredModel(
  requestedModel: string | undefined,
  messages: ChatMessage[],
  allowUnknownModel: boolean,
): { preferredModel?: number; notFound?: CompletionErrorBody } {
  if (!requestedModel || AUTO_MODEL_ALIASES.has(requestedModel)) {
    return { preferredModel: getStickyModel(messages) };
  }

  const db = getDb();
  const enabled = db.prepare('SELECT id FROM models WHERE model_id = ? AND enabled = 1').get(requestedModel) as { id: number } | undefined;
  if (enabled) {
    return { preferredModel: enabled.id };
  }

  if (allowUnknownModel) {
    return { preferredModel: getStickyModel(messages) };
  }

  const disabled = db.prepare('SELECT id FROM models WHERE model_id = ?').get(requestedModel) as { id: number } | undefined;
  const reason = disabled ? 'is disabled' : 'is not in the catalog';
  return {
    notFound: {
      error: {
        message: `Model '${requestedModel}' ${reason}. Omit the 'model' field to auto-route, or call /v1/models for the available list.`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    },
  };
}

function logRequest(
  platform: string,
  modelId: string,
  status: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  error: string | null,
) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(platform, modelId, status, inputTokens, outputTokens, latencyMs, error);
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}

export async function runChatCompletion(
  input: ChatCompletionInput,
  handlers: ChatCompletionHandlers,
): Promise<void> {
  const start = Date.now();
  const {
    messages,
    model: requestedModel,
    temperature,
    max_tokens,
    top_p,
    stream,
    tools,
    tool_choice,
    parallel_tool_calls,
    allowUnknownModel = false,
  } = input;

  const estimatedInputTokens = messages.reduce((sum, m) => {
    if (typeof m.content !== 'string') return sum;
    return sum + Math.ceil(m.content.length / 4);
  }, 0);
  const estimatedTotal = estimatedInputTokens + (max_tokens ?? 1000);

  const modelResolution = resolvePreferredModel(requestedModel, messages, allowUnknownModel);
  if (modelResolution.notFound) {
    handlers.onModelNotFound(modelResolution.notFound);
    return;
  }
  let preferredModel = modelResolution.preferredModel;

  const skipKeys = new Set<string>();
  let lastError: any = null;

  for (let attempt = 0; attempt < MAX_COMPLETION_RETRIES; attempt++) {
    let route: RouteResult;
    try {
      route = routeRequest(estimatedTotal, skipKeys.size > 0 ? skipKeys : undefined, preferredModel);
    } catch (err: any) {
      if (lastError) {
        handlers.onRateLimited({
          error: {
            message: `All models rate-limited. Last error: ${lastError.message}`,
            type: 'rate_limit_error',
          },
        });
      } else {
        handlers.onRoutingError(err.status ?? 503, {
          error: { message: err.message, type: 'routing_error' },
        });
      }
      return;
    }

    recordRequest(route.platform, route.modelId, route.keyId);

    try {
      if (stream) {
        let totalOutputTokens = 0;
        let streamStarted = false;
        try {
          const gen = route.provider.streamChatCompletion(
            route.apiKey, messages, route.modelId,
            { temperature, max_tokens, top_p, tools, tool_choice, parallel_tool_calls },
          );

          for await (const chunk of gen) {
            if (!streamStarted) {
              handlers.onStreamStart(route, attempt);
              streamStarted = true;
            }
            const text = chunk.choices[0]?.delta?.content ?? '';
            totalOutputTokens += Math.ceil(text.length / 4);
            handlers.onStreamChunk(chunk);
          }

          if (!streamStarted) {
            handlers.onStreamStart(route, attempt);
          }

          handlers.onStreamDone(route, estimatedInputTokens, totalOutputTokens, Date.now() - start);
          recordTokens(route.platform, route.modelId, route.keyId, estimatedInputTokens + totalOutputTokens);
          recordSuccess(route.modelDbId);
          setStickyModel(messages, route.modelDbId);
          logRequest(route.platform, route.modelId, 'success', estimatedInputTokens, totalOutputTokens, Date.now() - start, null);
          return;
        } catch (streamErr: any) {
          if (streamStarted) {
            console.error(`[Proxy] Mid-stream error from ${route.displayName}:`, streamErr.message);
            handlers.onStreamInterrupted(route, estimatedInputTokens, totalOutputTokens, Date.now() - start, streamErr);
            logRequest(route.platform, route.modelId, 'error', estimatedInputTokens, totalOutputTokens, Date.now() - start, streamErr.message);
            return;
          }
          throw streamErr;
        }
      } else {
        const result = await route.provider.chatCompletion(
          route.apiKey, messages, route.modelId,
          { temperature, max_tokens, top_p, tools, tool_choice, parallel_tool_calls },
        );

        const totalTokens = result.usage?.total_tokens ?? 0;
        recordTokens(route.platform, route.modelId, route.keyId, totalTokens);
        recordSuccess(route.modelDbId);
        setStickyModel(messages, route.modelDbId);

        handlers.onSuccess(result, route, attempt, Date.now() - start);

        logRequest(
          route.platform, route.modelId, 'success',
          result.usage?.prompt_tokens ?? 0,
          result.usage?.completion_tokens ?? 0,
          Date.now() - start, null,
        );
        return;
      }
    } catch (err: any) {
      logRequest(route.platform, route.modelId, 'error', estimatedInputTokens, 0, Date.now() - start, err.message);

      if (isRetryableProviderError(err)) {
        const skipId = `${route.platform}:${route.modelId}:${route.keyId}`;
        skipKeys.add(skipId);
        setCooldown(route.platform, route.modelId, route.keyId, 120_000);
        recordRateLimitHit(route.modelDbId);
        lastError = err;
        console.log(`[Proxy] ${err.message.slice(0, 60)} from ${route.displayName}, falling back (attempt ${attempt + 1}/${MAX_COMPLETION_RETRIES})`);
        continue;
      }

      handlers.onProviderError(502, {
        error: {
          message: `Provider error (${route.displayName}): ${err.message}`,
          type: 'provider_error',
        },
      });
      return;
    }
  }

  handlers.onRateLimited({
    error: {
      message: `All models rate-limited after ${MAX_COMPLETION_RETRIES} attempts. Last: ${lastError?.message}`,
      type: 'rate_limit_error',
    },
  });
}

/** Express helpers for OpenAI-style SSE and JSON errors. */
export function openAIStreamHandlers(res: Response): Pick<
  ChatCompletionHandlers,
  'onStreamStart' | 'onStreamChunk' | 'onStreamDone' | 'onStreamInterrupted'
> {
  return {
    onStreamStart(route, attempt) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
      if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
    },
    onStreamChunk(chunk) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    },
    onStreamDone() {
      res.write('data: [DONE]\n\n');
      res.end();
    },
    onStreamInterrupted(route) {
      const payload = {
        error: {
          message: `Provider error (${route.displayName}): stream interrupted`,
          type: 'stream_error',
        },
      };
      try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* socket gone */ }
      try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* socket gone */ }
    },
  };
}
