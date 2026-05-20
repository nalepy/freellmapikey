import crypto from 'crypto';
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatContentPart,
  ChatMessage,
  ChatToolCall,
  ChatToolChoice,
  ChatToolDefinition,
} from '@freellmapi/shared/types.js';

// ---- Anthropic request/response shapes (subset used by Claude Code) ----

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[]; is_error?: boolean }
  | { type: string; [key: string]: unknown };

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: 'auto'; disable_parallel_tool_use?: boolean }
  | { type: 'any'; disable_parallel_tool_use?: boolean }
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
  | { type: 'none' };

export interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string | AnthropicContentBlock[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  tools?: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice;
  stop_sequences?: string[];
}

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface OpenAICompletionParams {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
}

function flattenSystem(system: string | AnthropicContentBlock[] | undefined): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  return system
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof (b as any).text === 'string')
    .map(b => b.text)
    .join('\n');
}

function toolResultContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map(block => {
      if (block.type === 'text' && typeof (block as any).text === 'string') return (block as any).text;
      return JSON.stringify(block);
    })
    .join('\n');
}

function anthropicAssistantToOpenAI(blocks: AnthropicContentBlock[]): ChatMessage {
  const textParts: string[] = [];
  const toolCalls: NonNullable<ChatMessage['tool_calls']> = [];

  for (const block of blocks) {
    if (block.type === 'text' && typeof (block as any).text === 'string') {
      textParts.push((block as any).text);
    } else if (block.type === 'tool_use') {
      const tu = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
      toolCalls.push({
        id: tu.id,
        type: 'function',
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input ?? {}),
        },
      });
    }
  }

  return {
    role: 'assistant',
    content: textParts.length > 0 ? textParts.join('') : (toolCalls.length > 0 ? null : ''),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function anthropicImageToOpenAI(block: AnthropicContentBlock): ChatContentPart | null {
  if (block.type !== 'image') return null;
  const src = (block as { source?: { type?: string; media_type?: string; data?: string } }).source;
  if (src?.type !== 'base64' || !src.media_type || !src.data) return null;
  return {
    type: 'image_url',
    image_url: {
      url: `data:${src.media_type};base64,${src.data}`,
      detail: 'auto',
    },
  };
}

function anthropicUserToOpenAI(blocks: AnthropicContentBlock[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const textParts: string[] = [];
  const multimodalParts: ChatContentPart[] = [];

  for (const block of blocks) {
    if (block.type === 'text' && typeof (block as any).text === 'string') {
      const text = (block as any).text as string;
      textParts.push(text);
      multimodalParts.push({ type: 'text', text });
    } else if (block.type === 'image') {
      const imagePart = anthropicImageToOpenAI(block);
      if (imagePart) multimodalParts.push(imagePart);
    } else if (block.type === 'tool_result') {
      const tr = block as { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] };
      out.push({
        role: 'tool',
        tool_call_id: tr.tool_use_id,
        content: toolResultContent(tr.content),
      });
    }
  }

  if (multimodalParts.length > 0) {
    const hasImage = multimodalParts.some(p => p.type === 'image_url');
    const content: string | ChatContentPart[] = hasImage
      ? multimodalParts
      : (multimodalParts.length === 1 && multimodalParts[0].type === 'text'
        ? multimodalParts[0].text
        : textParts.join(''));
    out.unshift({ role: 'user', content });
  } else if (textParts.length > 0) {
    out.unshift({ role: 'user', content: textParts.join('') });
  }

  if (out.length === 0) {
    out.push({ role: 'user', content: '' });
  }

  return out;
}

export function anthropicRequestToOpenAI(body: AnthropicMessageRequest): OpenAICompletionParams {
  const messages: ChatMessage[] = [];
  const systemText = flattenSystem(body.system);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      messages.push(anthropicAssistantToOpenAI(msg.content));
    } else {
      messages.push(...anthropicUserToOpenAI(msg.content));
    }
  }

  let tools: ChatToolDefinition[] | undefined;
  if (body.tools?.length) {
    tools = body.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  let tool_choice: ChatToolChoice | undefined;
  let parallel_tool_calls: boolean | undefined;
  if (body.tool_choice) {
    switch (body.tool_choice.type) {
      case 'none':
        tool_choice = 'none';
        break;
      case 'any':
        tool_choice = 'required';
        break;
      case 'tool':
        tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
        break;
      case 'auto':
      default:
        tool_choice = 'auto';
        break;
    }
    if (body.tool_choice.type !== 'none' && body.tool_choice.disable_parallel_tool_use === true) {
      parallel_tool_calls = false;
    }
  }

  return {
    messages,
    model: body.model,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    stream: body.stream,
    tools,
    tool_choice,
    parallel_tool_calls,
  };
}

function openAIFinishToAnthropic(reason: string | null | undefined): AnthropicMessageResponse['stop_reason'] {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
    case 'stop_sequence':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

export function openAIResponseToAnthropic(
  result: ChatCompletionResponse,
  requestedModel: string,
): AnthropicMessageResponse {
  const choice = result.choices[0];
  const msg = choice?.message;
  const content: AnthropicContentBlock[] = [];

  if (msg?.content) {
    content.push({ type: 'text', text: msg.content });
  }

  for (const tc of msg?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      input = { _raw: tc.function.arguments };
    }
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input,
    });
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return {
    id: result.id.startsWith('msg_') ? result.id : `msg_${result.id}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: openAIFinishToAnthropic(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: result.usage?.prompt_tokens ?? 0,
      output_tokens: result.usage?.completion_tokens ?? 0,
    },
  };
}

export function estimateAnthropicInputTokens(body: AnthropicMessageRequest): number {
  const openai = anthropicRequestToOpenAI(body);
  return openai.messages.reduce((sum, m) => {
    if (typeof m.content !== 'string') return sum;
    return sum + Math.ceil(m.content.length / 4);
  }, 0);
}

// ---- Anthropic SSE streaming encoder ----

export interface AnthropicStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

type ToolStreamState = {
  index: number;
  id: string;
  name: string;
  arguments: string;
  blockStarted: boolean;
  blockStopped: boolean;
};

export class AnthropicStreamEncoder {
  readonly messageId: string;
  readonly model: string;
  private messageStarted = false;
  private textBlockStarted = false;
  private textBlockStopped = false;
  private readonly toolStates = new Map<number, ToolStreamState>();
  private inputTokens = 0;
  private outputTokens = 0;
  private stopReason: AnthropicMessageResponse['stop_reason'] = 'end_turn';
  private messageStopped = false;

  constructor(model: string) {
    this.messageId = `msg_${crypto.randomBytes(12).toString('hex')}`;
    this.model = model;
  }

  setInputTokens(n: number) {
    this.inputTokens = n;
  }

  *encodeChunk(chunk: ChatCompletionChunk): Generator<AnthropicStreamEvent> {
    if (!this.messageStarted) {
      this.messageStarted = true;
      yield {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: this.messageId,
            type: 'message',
            role: 'assistant',
            model: this.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: this.inputTokens, output_tokens: 0 },
          },
        },
      };
    }

    const choice = chunk.choices[0];
    const delta = choice?.delta;
    if (!delta) return;

    if (delta.content) {
      if (!this.textBlockStarted) {
        this.textBlockStarted = true;
        yield {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
        };
      }
      this.outputTokens += Math.ceil(delta.content.length / 4);
      yield {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: delta.content },
        },
      };
    }

    type StreamToolCallDelta = ChatToolCall & { index?: number };
    for (const tc of (delta.tool_calls ?? []) as StreamToolCallDelta[]) {
      const idx = tc.index ?? 0;
      let state = this.toolStates.get(idx);
      if (!state) {
        state = {
          index: idx + 1,
          id: tc.id ?? `toolu_${crypto.randomBytes(8).toString('hex')}`,
          name: tc.function?.name ?? '',
          arguments: '',
          blockStarted: false,
          blockStopped: false,
        };
        this.toolStates.set(idx, state);
      }

      if (tc.id) state.id = tc.id;
      if (tc.function?.name) state.name = tc.function.name;
      if (tc.function?.arguments) {
        state.arguments += tc.function.arguments;
        this.outputTokens += Math.ceil(tc.function.arguments.length / 4);
      }

      if (!state.blockStarted) {
        state.blockStarted = true;
        yield {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: state.index,
            content_block: {
              type: 'tool_use',
              id: state.id,
              name: state.name,
              input: {},
            },
          },
        };
      }

      if (tc.function?.arguments) {
        yield {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: state.index,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          },
        };
      }
    }

    if (choice.finish_reason) {
      this.stopReason = openAIFinishToAnthropic(choice.finish_reason);
    }
  }

  *finalize(): Generator<AnthropicStreamEvent> {
    if (!this.messageStarted) {
      this.messageStarted = true;
      yield {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: this.messageId,
            type: 'message',
            role: 'assistant',
            model: this.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: this.inputTokens, output_tokens: 0 },
          },
        },
      };
      yield {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      };
    }

    if (this.textBlockStarted && !this.textBlockStopped) {
      this.textBlockStopped = true;
      yield {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      };
    } else if (!this.textBlockStarted && this.toolStates.size === 0) {
      yield {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      };
      yield {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      };
    }

    for (const state of this.toolStates.values()) {
      if (!state.blockStopped) {
        state.blockStopped = true;
        yield {
          event: 'content_block_stop',
          data: { type: 'content_block_stop', index: state.index },
        };
      }
    }

    if (!this.messageStopped) {
      this.messageStopped = true;
      yield {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: this.stopReason, stop_sequence: null },
          usage: { output_tokens: this.outputTokens },
        },
      };
      yield {
        event: 'message_stop',
        data: { type: 'message_stop' },
      };
    }
  }
}

export function formatAnthropicSse(event: AnthropicStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
