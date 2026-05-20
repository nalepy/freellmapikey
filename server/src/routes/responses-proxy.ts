import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateProxyRequest } from '../lib/proxy-auth.js';
import {
  ResponsesStreamEncoder,
  estimateResponsesInputTokens,
  formatResponsesSse,
  openAIResponseToResponses,
  responsesRequestToOpenAI,
  type ResponsesCreateRequest,
} from '../lib/responses-compat.js';
import { runChatCompletion } from '../services/chat-completion.js';

export const responsesProxyRouter = Router();

const responsesContentPartSchema = z.union([
  z.object({ type: z.literal('input_text'), text: z.string() }),
  z.object({ type: z.literal('output_text'), text: z.string() }),
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('input_image'),
    image_url: z.union([
      z.string(),
      z.object({ url: z.string() }),
    ]),
    detail: z.enum(['auto', 'low', 'high', 'original']).optional(),
  }),
  z.object({ type: z.string() }).passthrough(),
]);

const responsesInputItemSchema = z.union([
  z.object({
    role: z.enum(['user', 'assistant', 'system', 'developer']),
    content: z.union([z.string(), z.array(responsesContentPartSchema)]),
  }),
  z.object({
    type: z.literal('message'),
    role: z.enum(['user', 'assistant', 'system', 'developer']),
    content: z.union([z.string(), z.array(responsesContentPartSchema)]),
  }),
  z.object({
    type: z.literal('function_call'),
    call_id: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string(),
    id: z.string().optional(),
    status: z.string().optional(),
  }),
  z.object({
    type: z.literal('function_call_output'),
    call_id: z.string().min(1),
    output: z.union([z.string(), z.array(responsesContentPartSchema)]),
  }),
  z.object({ type: z.string() }).passthrough(),
]);

const responsesToolSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
});

const responsesToolChoiceSchema = z.union([
  z.enum(['auto', 'none', 'required']),
  z.object({
    type: z.literal('function'),
    name: z.string().min(1),
  }),
]);

const responsesCreateSchema = z.object({
  model: z.string().optional(),
  input: z.union([z.string(), z.array(responsesInputItemSchema)]).optional(),
  instructions: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  tools: z.array(responsesToolSchema).optional(),
  tool_choice: responsesToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  store: z.boolean().optional(),
  reasoning: z.object({
    effort: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
  }).nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  truncation: z.string().optional(),
});

function responsesError(res: Response, status: number, message: string, type = 'invalid_request_error') {
  res.status(status).json({
    error: { message, type },
  });
}

responsesProxyRouter.post('/responses', async (req: Request, res: Response) => {
  if (!authenticateProxyRequest(req)) {
    responsesError(res, 401, 'Invalid API key', 'authentication_error');
    return;
  }

  const parsed = responsesCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    responsesError(res, 400, parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const body = parsed.data as ResponsesCreateRequest;
  const openaiParams = responsesRequestToOpenAI(body);
  const displayModel = body.model ?? 'freellmapi-auto';

  if (openaiParams.stream) {
    const encoder = new ResponsesStreamEncoder(body, displayModel);
    encoder.setInputTokens(estimateResponsesInputTokens(body));

    await runChatCompletion(
      { ...openaiParams, allowUnknownModel: true, endpoint: 'responses' },
      {
        onRoutingError: (status, errBody) => {
          res.status(status).json(errBody);
        },
        onModelNotFound: (errBody) => {
          res.status(400).json(errBody);
        },
        onRateLimited: (errBody) => {
          res.status(429).json(errBody);
        },
        onProviderError: (status, errBody) => {
          res.status(status).json(errBody);
        },
        onSuccess: () => {},
        onStreamStart(route, attempt) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
          if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
        },
        onStreamChunk(chunk) {
          for (const event of encoder.encodeChunk(chunk)) {
            res.write(formatResponsesSse(event));
          }
        },
        onStreamDone() {
          for (const event of encoder.finalize()) {
            res.write(formatResponsesSse(event));
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
            res.write(formatResponsesSse({ event: 'error', data: payload }));
          } catch { /* socket gone */ }
          try { res.end(); } catch { /* socket gone */ }
        },
      },
    );
    return;
  }

  await runChatCompletion(
    { ...openaiParams, allowUnknownModel: true, endpoint: 'responses' },
    {
      onRoutingError: (status, errBody) => {
        res.status(status).json(errBody);
      },
      onModelNotFound: (errBody) => {
        res.status(400).json(errBody);
      },
      onRateLimited: (errBody) => {
        res.status(429).json(errBody);
      },
      onProviderError: (status, errBody) => {
        res.status(status).json(errBody);
      },
      onStreamStart: () => {},
      onStreamChunk: () => {},
      onStreamDone: () => {},
      onStreamInterrupted: () => {},
      onSuccess: (result, route, attempt) => {
        res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
        if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
        res.json(openAIResponseToResponses(result, body, displayModel));
      },
    },
  );
});
