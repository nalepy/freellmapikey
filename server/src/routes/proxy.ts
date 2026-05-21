import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatMessage } from '@freellmapikey/shared/types.js';
import { getDb } from '../db/index.js';
import { buildCodexModelCatalog } from '../lib/codex-model-catalog.js';
import { authenticateProxyRequest } from '../lib/proxy-auth.js';
import {
  openAIStreamHandlers,
  runChatCompletion,
} from '../services/chat-completion.js';

export const proxyRouter = Router();

// OpenAI-compatible /models endpoint (used by Hermes for metadata)
proxyRouter.get('/models', (_req: Request, res: Response) => {
  const db = getDb();
  const models = db.prepare('SELECT platform, model_id, display_name, context_window FROM models WHERE enabled = 1 ORDER BY intelligence_rank').all() as any[];
  res.json({
    object: 'list',
    data: models.map(m => ({
      id: m.model_id,
      object: 'model',
      created: 0,
      owned_by: m.platform,
      name: m.display_name,
      context_window: m.context_window,
    })),
  });
});

// Codex model_catalog.json shape (Codex does not list custom models from GET /v1/models alone)
proxyRouter.get('/codex/model-catalog', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT model_id, display_name, context_window, requires_vision
    FROM models WHERE enabled = 1 ORDER BY intelligence_rank
  `).all() as Array<{
    model_id: string;
    display_name: string;
    context_window: number | null;
    requires_vision: number;
  }>;
  res.json(buildCodexModelCatalog(rows));
});

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
  thought_signature: z.string().optional(),
});

const systemMessageSchema = z.object({
  role: z.literal('system'),
  content: z.string(),
  name: z.string().optional(),
});

const chatContentPartSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string().min(1),
      detail: z.enum(['auto', 'low', 'high', 'original']).optional(),
    }),
  }),
]);

const userMessageSchema = z.object({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(chatContentPartSchema)]),
  name: z.string().optional(),
});

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
}).refine((msg) => {
  const hasContent = typeof msg.content === 'string' && msg.content.length > 0;
  const hasToolCalls = (msg.tool_calls?.length ?? 0) > 0;
  return hasContent || hasToolCalls;
}, {
  message: 'assistant messages must include non-empty content or tool_calls',
});

const toolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string().min(1),
  name: z.string().optional(),
});

const toolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1),
    }),
  }),
]);

const chatCompletionSchema = z.object({
  messages: z.array(z.union([
    systemMessageSchema,
    userMessageSchema,
    assistantMessageSchema,
    toolMessageSchema,
  ])).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(toolDefinitionSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
});

proxyRouter.post('/chat/completions', async (req: Request, res: Response) => {
  if (!authenticateProxyRequest(req)) {
    res.status(401).json({
      error: { message: 'Invalid API key', type: 'authentication_error' },
    });
    return;
  }

  const parsed = chatCompletionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    });
    return;
  }

  const { model: requestedModel, temperature, max_tokens, top_p, stream, tools, tool_choice, parallel_tool_calls } = parsed.data;
  const messages: ChatMessage[] = parsed.data.messages.map((m): ChatMessage => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content ?? null,
        ...(m.name ? { name: m.name } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
          thought_signature: tc.thought_signature,
        })) } : {}),
      };
    }

    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id,
        ...(m.name ? { name: m.name } : {}),
      };
    }

    return {
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    };
  });

  const streamHandlers = stream ? openAIStreamHandlers(res) : null;

  await runChatCompletion(
    {
      messages,
      model: requestedModel,
      temperature,
      max_tokens,
      top_p,
      stream,
      tools,
      tool_choice,
      parallel_tool_calls,
      endpoint: 'chat-completions',
    },
    {
      onRoutingError: (status, body) => {
        res.status(status).json(body);
      },
      onModelNotFound: (body) => {
        res.status(400).json(body);
      },
      onRateLimited: (body) => {
        res.status(429).json(body);
      },
      onProviderError: (status, body) => {
        res.status(status).json(body);
      },
      onStreamStart: streamHandlers?.onStreamStart ?? (() => {}),
      onStreamChunk: streamHandlers?.onStreamChunk ?? (() => {}),
      onStreamDone: streamHandlers?.onStreamDone ?? (() => {}),
      onStreamInterrupted: streamHandlers?.onStreamInterrupted ?? (() => {}),
      onSuccess: (result, route, attempt) => {
        res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
        if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
        res.json(result);
      },
    },
  );
});
