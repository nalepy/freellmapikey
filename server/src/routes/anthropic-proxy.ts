import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  anthropicRequestToOpenAI,
  estimateAnthropicInputTokens,
  formatAnthropicSse,
  openAIResponseToAnthropic,
  AnthropicStreamEncoder,
  type AnthropicMessageRequest,
} from '../lib/anthropic-compat.js';
import { authenticateProxyRequest } from '../lib/proxy-auth.js';
import { runChatCompletion } from '../services/chat-completion.js';

export const anthropicProxyRouter = Router();

const anthropicContentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string().min(1),
    content: z.union([
      z.string(),
      z.array(z.record(z.string(), z.unknown())),
    ]),
    is_error: z.boolean().optional(),
  }),
  z.object({ type: z.string() }).passthrough(),
]);

const anthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(anthropicContentBlockSchema)]),
});

const anthropicToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
});

const anthropicToolChoiceSchema = z.union([
  z.object({ type: z.literal('auto'), disable_parallel_tool_use: z.boolean().optional() }),
  z.object({ type: z.literal('any'), disable_parallel_tool_use: z.boolean().optional() }),
  z.object({
    type: z.literal('tool'),
    name: z.string().min(1),
    disable_parallel_tool_use: z.boolean().optional(),
  }),
  z.object({ type: z.literal('none') }),
]);

const anthropicMessagesSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z.array(anthropicMessageSchema).min(1),
  system: z.union([z.string(), z.array(anthropicContentBlockSchema)]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  tools: z.array(anthropicToolSchema).optional(),
  tool_choice: anthropicToolChoiceSchema.optional(),
  stop_sequences: z.array(z.string()).optional(),
});

function anthropicAuthError(res: Response) {
  res.status(401).json({
    type: 'error',
    error: { type: 'authentication_error', message: 'Invalid API key' },
  });
}

function anthropicInvalidError(res: Response, message: string) {
  res.status(400).json({
    type: 'error',
    error: { type: 'invalid_request_error', message },
  });
}

anthropicProxyRouter.post('/messages/count_tokens', async (req: Request, res: Response) => {
  if (!authenticateProxyRequest(req)) {
    anthropicAuthError(res);
    return;
  }

  const parsed = anthropicMessagesSchema.safeParse(req.body);
  if (!parsed.success) {
    anthropicInvalidError(res, parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const inputTokens = estimateAnthropicInputTokens(parsed.data as AnthropicMessageRequest);
  res.json({ input_tokens: inputTokens });
});

anthropicProxyRouter.post('/messages', async (req: Request, res: Response) => {
  if (!authenticateProxyRequest(req)) {
    anthropicAuthError(res);
    return;
  }

  const parsed = anthropicMessagesSchema.safeParse(req.body);
  if (!parsed.success) {
    anthropicInvalidError(res, parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const anthropicBody = parsed.data as AnthropicMessageRequest;
  const openaiParams = anthropicRequestToOpenAI(anthropicBody);
  const displayModel = anthropicBody.model;

  if (openaiParams.stream) {
    const encoder = new AnthropicStreamEncoder(displayModel);
    encoder.setInputTokens(
      openaiParams.messages.reduce((sum, m) => {
        if (typeof m.content !== 'string') return sum;
        return sum + Math.ceil(m.content.length / 4);
      }, 0),
    );

    await runChatCompletion(
      { ...openaiParams, allowUnknownModel: true, endpoint: 'anthropic' },
      {
        onRoutingError: (status, body) => {
          res.status(status).json({
            type: 'error',
            error: { type: body.error.type, message: body.error.message },
          });
        },
        onModelNotFound: (body) => {
          res.status(400).json({
            type: 'error',
            error: { type: body.error.type, message: body.error.message },
          });
        },
        onRateLimited: (body) => {
          res.status(429).json({
            type: 'error',
            error: { type: body.error.type, message: body.error.message },
          });
        },
        onProviderError: (status, body) => {
          res.status(status).json({
            type: 'error',
            error: { type: body.error.type, message: body.error.message },
          });
        },
        onSuccess: () => {
          // Non-stream path only
        },
        onStreamStart(route, attempt) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
          if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
        },
        onStreamChunk(chunk) {
          for (const event of encoder.encodeChunk(chunk)) {
            res.write(formatAnthropicSse(event));
          }
        },
        onStreamDone() {
          for (const event of encoder.finalize()) {
            res.write(formatAnthropicSse(event));
          }
          res.end();
        },
        onStreamInterrupted(route) {
          const payload = {
            type: 'error',
            error: {
              type: 'api_error',
              message: `Provider error (${route.displayName}): stream interrupted`,
            },
          };
          try {
            res.write(formatAnthropicSse({ event: 'error', data: payload }));
          } catch { /* socket gone */ }
          try { res.end(); } catch { /* socket gone */ }
        },
      },
    );
    return;
  }

  await runChatCompletion(
    { ...openaiParams, allowUnknownModel: true },
    {
      onRoutingError: (status, body) => {
        res.status(status).json({
          type: 'error',
          error: { type: body.error.type, message: body.error.message },
        });
      },
      onModelNotFound: (body) => {
        res.status(400).json({
          type: 'error',
          error: { type: body.error.type, message: body.error.message },
        });
      },
      onRateLimited: (body) => {
        res.status(429).json({
          type: 'error',
          error: { type: body.error.type, message: body.error.message },
        });
      },
      onProviderError: (status, body) => {
        res.status(status).json({
          type: 'error',
          error: { type: body.error.type, message: body.error.message },
        });
      },
      onStreamStart: () => {},
      onStreamChunk: () => {},
      onStreamDone: () => {},
      onStreamInterrupted: () => {},
      onSuccess: (result, route, attempt) => {
        res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
        if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
        res.json(openAIResponseToAnthropic(result, displayModel));
      },
    },
  );
});
