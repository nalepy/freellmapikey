import crypto from 'crypto';
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatContentPart,
  ChatMessage,
  ChatToolChoice,
  ChatToolDefinition,
} from '@freellmapi/shared/types.js';
import { deltaContentToString, estimateContentTokens } from './message-content.js';
import type { OpenAICompletionParams } from './anthropic-compat.js';

// ---- OpenAI Responses API (subset for Codex / Responses wire clients) ----

export interface ResponsesCreateRequest {
  model?: string;
  input?: string | ResponsesInputItem[];
  instructions?: string | null;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  stream?: boolean;
  tools?: ResponsesToolDefinition[];
  tool_choice?: ResponsesToolChoice;
  parallel_tool_calls?: boolean;
  store?: boolean;
  reasoning?: { effort?: string | null; summary?: string | null } | null;
  metadata?: Record<string, string>;
  truncation?: string;
}

export type ResponsesInputItem =
  | { role: 'user' | 'assistant' | 'system' | 'developer'; content: string | ResponsesContentPart[] }
  | { type: 'message'; role: 'user' | 'assistant' | 'system' | 'developer'; content: string | ResponsesContentPart[] }
  | { type: 'function_call'; id?: string; call_id: string; name: string; arguments: string; status?: string }
  | { type: 'function_call_output'; call_id: string; output: string | ResponsesContentPart[] }
  | { type: string; [key: string]: unknown };

export type ResponsesContentPart =
  | { type: 'input_text' | 'output_text' | 'text'; text: string }
  | { type: string; [key: string]: unknown };

export interface ResponsesToolDefinition {
  type: 'function' | string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export type ResponsesToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; name: string };

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  output_tokens_details?: { reasoning_tokens: number };
}

export type ResponsesOutputItem =
  | {
    id: string;
    type: 'message';
    status: 'in_progress' | 'completed' | 'incomplete';
    role: 'assistant';
    content: Array<{ type: 'output_text'; text: string; annotations: unknown[] }>;
  }
  | {
    id: string;
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
    status: 'in_progress' | 'completed' | 'incomplete';
  };

export interface ResponsesObject {
  id: string;
  object: 'response';
  created_at: number;
  status: 'in_progress' | 'completed' | 'failed' | 'incomplete';
  error: null | { message: string; type: string };
  incomplete_details: null;
  instructions: string | null;
  max_output_tokens: number | null;
  model: string;
  output: ResponsesOutputItem[];
  parallel_tool_calls: boolean;
  previous_response_id: string | null;
  reasoning: { effort: string | null; summary: string | null };
  store: boolean;
  temperature: number | null;
  text: { format: { type: 'text' } };
  tool_choice: ResponsesToolChoice | string;
  tools: ResponsesToolDefinition[];
  top_p: number | null;
  truncation: string;
  usage: ResponsesUsage | null;
  user: null;
  metadata: Record<string, string>;
  output_text?: string;
}

export interface ResponsesStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function responsesPartToOpenAI(part: unknown): ChatContentPart | null {
  if (typeof part !== 'object' || part === null) return null;
  const p = part as Record<string, unknown>;
  const type = p.type;

  if (
    (type === 'input_text' || type === 'output_text' || type === 'text')
    && typeof p.text === 'string'
  ) {
    return { type: 'text', text: p.text };
  }

  if (type === 'input_image') {
    let url: string | null = null;
    if (typeof p.image_url === 'string') {
      url = p.image_url;
    } else if (typeof p.image_url === 'object' && p.image_url !== null && typeof (p.image_url as { url?: string }).url === 'string') {
      url = (p.image_url as { url: string }).url;
    }
    if (url) {
      const detail = p.detail;
      return {
        type: 'image_url',
        image_url: {
          url,
          detail: detail === 'low' || detail === 'high' || detail === 'auto' ? detail : 'auto',
        },
      };
    }
  }

  return null;
}

function contentToChatContent(content: unknown): string | ChatContentPart[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: ChatContentPart[] = [];
  for (const part of content) {
    const mapped = responsesPartToOpenAI(part);
    if (mapped) parts.push(mapped);
  }

  if (parts.length === 0) return '';
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

/** Text-only flattening for tool outputs and token fallbacks. */
function flattenContent(content: unknown): string {
  const converted = contentToChatContent(content);
  if (typeof converted === 'string') return converted;
  return converted
    .filter((p): p is Extract<ChatContentPart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function flattenToolOutput(output: string | ResponsesContentPart[]): string {
  if (typeof output === 'string') return output;
  return flattenContent(output);
}

function responsesToolsToOpenAI(tools?: ResponsesToolDefinition[]): ChatToolDefinition[] | undefined {
  if (!tools?.length) return undefined;
  const mapped = tools
    .filter((t): t is ResponsesToolDefinition & { name: string } => t.type === 'function' && !!t.name)
    .map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: t.strict,
      },
    }));
  return mapped.length > 0 ? mapped : undefined;
}

function responsesToolChoiceToOpenAI(choice?: ResponsesToolChoice): ChatToolChoice | undefined {
  if (choice === undefined) return undefined;
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
  if (typeof choice === 'object' && choice.type === 'function') {
    return { type: 'function', function: { name: choice.name } };
  }
  return 'auto';
}

function parseInputItems(input: string | ResponsesInputItem[] | undefined): ChatMessage[] {
  if (input === undefined) return [];
  if (typeof input === 'string') {
    return input.length > 0 ? [{ role: 'user', content: input }] : [];
  }

  const messages: ChatMessage[] = [];

  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue;

    if (item.type === 'function_call_output' && typeof item.call_id === 'string') {
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id,
        content: flattenToolOutput(item.output as string | ResponsesContentPart[]),
      });
      continue;
    }

    if (item.type === 'function_call' && typeof item.call_id === 'string' && typeof item.name === 'string') {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id,
          type: 'function',
          function: {
            name: item.name,
            arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
          },
        }],
      });
      continue;
    }

    const role = 'role' in item ? item.role : undefined;
    if (!role) continue;

    const openaiRole = role === 'developer' ? 'system' : role;
    if (openaiRole !== 'user' && openaiRole !== 'assistant' && openaiRole !== 'system') continue;

    const content = 'content' in item ? contentToChatContent(item.content) : '';
    if (openaiRole === 'assistant' && (content === '' || (Array.isArray(content) && content.length === 0))) {
      messages.push({ role: 'assistant', content: '' });
    } else {
      messages.push({ role: openaiRole, content });
    }
  }

  return messages;
}

export function responsesRequestToOpenAI(body: ResponsesCreateRequest): OpenAICompletionParams {
  const messages: ChatMessage[] = [];

  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }

  messages.push(...parseInputItems(body.input));

  if (messages.length === 0) {
    messages.push({ role: 'user', content: '' });
  }

  return {
    messages,
    model: body.model,
    temperature: body.temperature,
    max_tokens: body.max_output_tokens,
    top_p: body.top_p,
    stream: body.stream,
    tools: responsesToolsToOpenAI(body.tools),
    tool_choice: responsesToolChoiceToOpenAI(body.tool_choice),
    parallel_tool_calls: body.parallel_tool_calls,
  };
}

export function estimateResponsesInputTokens(body: ResponsesCreateRequest): number {
  const openai = responsesRequestToOpenAI(body);
  return openai.messages.reduce((sum, m) => sum + estimateContentTokens(m.content), 0);
}

export function buildResponseSkeleton(
  body: ResponsesCreateRequest,
  displayModel: string,
  responseId: string,
  status: ResponsesObject['status'] = 'in_progress',
): ResponsesObject {
  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    error: null,
    incomplete_details: null,
    instructions: body.instructions ?? null,
    max_output_tokens: body.max_output_tokens ?? null,
    model: displayModel,
    output: [],
    parallel_tool_calls: body.parallel_tool_calls ?? true,
    previous_response_id: null,
    reasoning: {
      effort: body.reasoning?.effort ?? null,
      summary: body.reasoning?.summary ?? null,
    },
    store: body.store ?? false,
    temperature: body.temperature ?? null,
    text: { format: { type: 'text' } },
    tool_choice: body.tool_choice ?? 'auto',
    tools: body.tools ?? [],
    top_p: body.top_p ?? null,
    truncation: body.truncation ?? 'disabled',
    usage: null,
    user: null,
    metadata: body.metadata ?? {},
  };
}

export function openAIResponseToResponses(
  result: ChatCompletionResponse,
  body: ResponsesCreateRequest,
  displayModel: string,
): ResponsesObject {
  const choice = result.choices[0];
  const msg = choice?.message;
  const output: ResponsesOutputItem[] = [];
  let outputText = '';

  if (msg?.content) {
    const msgId = result.id.startsWith('msg_') ? result.id : `msg_${result.id}`;
    outputText = msg.content;
    output.push({
      id: msgId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: msg.content, annotations: [] }],
    });
  }

  for (const tc of msg?.tool_calls ?? []) {
    output.push({
      id: newId('fc'),
      type: 'function_call',
      call_id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
      status: 'completed',
    });
  }

  const usage: ResponsesUsage = {
    input_tokens: result.usage?.prompt_tokens ?? 0,
    output_tokens: result.usage?.completion_tokens ?? 0,
    total_tokens: result.usage?.total_tokens ?? 0,
    output_tokens_details: { reasoning_tokens: 0 },
  };

  const response: ResponsesObject = {
    ...buildResponseSkeleton(body, displayModel, result.id.startsWith('resp_') ? result.id : `resp_${result.id}`, 'completed'),
    output,
    usage,
  };

  if (outputText) {
    response.output_text = outputText;
  }

  return response;
}

type ToolStreamState = {
  chunkIndex: number;
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  itemAdded: boolean;
  argumentsDone: boolean;
};

export class ResponsesStreamEncoder {
  readonly responseId: string;
  readonly messageId: string;
  readonly displayModel: string;
  private readonly requestBody: ResponsesCreateRequest;
  private responseEmitted = false;
  private nextOutputIndex = 0;
  private textOutputIndex: number | null = null;
  private textPartStarted = false;
  private accumulatedText = '';
  private readonly toolStates = new Map<number, ToolStreamState>();
  private readonly outputItems: ResponsesOutputItem[] = [];
  private inputTokens = 0;
  private outputTokens = 0;
  private status: ResponsesObject['status'] = 'in_progress';
  private usage: ResponsesUsage | null = null;

  constructor(body: ResponsesCreateRequest, displayModel: string) {
    this.requestBody = body;
    this.displayModel = displayModel;
    this.responseId = newId('resp');
    this.messageId = newId('msg');
  }

  setInputTokens(n: number) {
    this.inputTokens = n;
  }

  private skeleton(): ResponsesObject {
    const base = buildResponseSkeleton(this.requestBody, this.displayModel, this.responseId, this.status);
    return {
      ...base,
      output: [...this.outputItems],
      usage: this.usage,
      ...(this.accumulatedText ? { output_text: this.accumulatedText } : {}),
    };
  }

  private *ensureResponseStarted(): Generator<ResponsesStreamEvent> {
    if (this.responseEmitted) return;
    this.responseEmitted = true;
    const skeleton = this.skeleton();
    yield {
      event: 'response.created',
      data: { type: 'response.created', response: skeleton },
    };
    yield {
      event: 'response.in_progress',
      data: { type: 'response.in_progress', response: skeleton },
    };
  }

  *encodeChunk(chunk: ChatCompletionChunk): Generator<ResponsesStreamEvent> {
    yield* this.ensureResponseStarted();

    const choice = chunk.choices[0];
    const delta = choice?.delta;
    if (!delta) return;

    const textDelta = deltaContentToString(delta.content);
    if (textDelta.length > 0) {
      if (this.textOutputIndex === null) {
        this.textOutputIndex = this.nextOutputIndex++;
        this.textPartStarted = true;
        yield {
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            output_index: this.textOutputIndex,
            item: {
              id: this.messageId,
              type: 'message',
              status: 'in_progress',
              role: 'assistant',
              content: [],
            },
          },
        };
        yield {
          event: 'response.content_part.added',
          data: {
            type: 'response.content_part.added',
            item_id: this.messageId,
            output_index: this.textOutputIndex,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          },
        };
      }

      this.accumulatedText += textDelta;
      this.outputTokens += Math.ceil(textDelta.length / 4);
      yield {
        event: 'response.output_text.delta',
        data: {
          type: 'response.output_text.delta',
          item_id: this.messageId,
          output_index: this.textOutputIndex,
          content_index: 0,
          delta: textDelta,
        },
      };
    }

    type StreamToolCallDelta = {
      index?: number;
      id?: string;
      type?: 'function';
      function?: { name?: string; arguments?: string };
    };

    for (const tc of (delta.tool_calls ?? []) as StreamToolCallDelta[]) {
      const idx = tc.index ?? 0;
      let state = this.toolStates.get(idx);
      if (!state) {
        const outputIndex = this.nextOutputIndex++;
        state = {
          chunkIndex: idx,
          outputIndex,
          itemId: newId('fc'),
          callId: tc.id ?? newId('call'),
          name: tc.function?.name ?? '',
          arguments: '',
          itemAdded: false,
          argumentsDone: false,
        };
        this.toolStates.set(idx, state);
      }

      if (tc.id) state.callId = tc.id;
      if (tc.function?.name) state.name = tc.function.name;

      if (!state.itemAdded && state.name) {
        state.itemAdded = true;
        yield {
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            output_index: state.outputIndex,
            item: {
              id: state.itemId,
              type: 'function_call',
              status: 'in_progress',
              call_id: state.callId,
              name: state.name,
              arguments: '',
            },
          },
        };
      }

      if (tc.function?.arguments) {
        state.arguments += tc.function.arguments;
        this.outputTokens += Math.ceil(tc.function.arguments.length / 4);
        yield {
          event: 'response.function_call_arguments.delta',
          data: {
            type: 'response.function_call_arguments.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            delta: tc.function.arguments,
          },
        };
      }
    }

    if (choice?.finish_reason) {
      this.status = 'completed';
    }
  }

  *finalize(): Generator<ResponsesStreamEvent> {
    yield* this.ensureResponseStarted();

    if (this.textPartStarted && this.textOutputIndex !== null) {
      yield {
        event: 'response.output_text.done',
        data: {
          type: 'response.output_text.done',
          item_id: this.messageId,
          output_index: this.textOutputIndex,
          content_index: 0,
          text: this.accumulatedText,
        },
      };
      yield {
        event: 'response.content_part.done',
        data: {
          type: 'response.content_part.done',
          item_id: this.messageId,
          output_index: this.textOutputIndex,
          content_index: 0,
          part: { type: 'output_text', text: this.accumulatedText, annotations: [] },
        },
      };
      const messageItem: ResponsesOutputItem = {
        id: this.messageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: this.accumulatedText, annotations: [] }],
      };
      this.outputItems.push(messageItem);
      yield {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          output_index: this.textOutputIndex,
          item: messageItem,
        },
      };
    }

    for (const state of this.toolStates.values()) {
      if (!state.argumentsDone) {
        state.argumentsDone = true;
        yield {
          event: 'response.function_call_arguments.done',
          data: {
            type: 'response.function_call_arguments.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            name: state.name,
            arguments: state.arguments,
          },
        };
        const fcItem: ResponsesOutputItem = {
          id: state.itemId,
          type: 'function_call',
          call_id: state.callId,
          name: state.name,
          arguments: state.arguments,
          status: 'completed',
        };
        this.outputItems.push(fcItem);
        yield {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            output_index: state.outputIndex,
            item: fcItem,
          },
        };
      }
    }

    this.usage = {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      total_tokens: this.inputTokens + this.outputTokens,
      output_tokens_details: { reasoning_tokens: 0 },
    };

    yield {
      event: 'response.completed',
      data: {
        type: 'response.completed',
        response: this.skeleton(),
      },
    };
  }
}

export function formatResponsesSse(event: ResponsesStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
