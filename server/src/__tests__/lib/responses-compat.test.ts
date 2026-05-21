import { describe, it, expect } from 'vitest';
import {
  responsesRequestToOpenAI,
  openAIResponseToResponses,
  ResponsesStreamEncoder,
  formatResponsesSse,
} from '../../lib/responses-compat.js';
import type { ChatCompletionResponse } from '@freellmapikey/shared/types.js';

describe('responses-compat', () => {
  it('preserves input_image as OpenAI image_url content', () => {
    const openai = responsesRequestToOpenAI({
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is in this image?' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,iVBORw0KGgo=',
            detail: 'auto',
          },
        ],
      }],
    });

    expect(openai.messages).toHaveLength(1);
    expect(openai.messages[0].role).toBe('user');
    expect(Array.isArray(openai.messages[0].content)).toBe(true);
    const parts = openai.messages[0].content as Array<{ type: string }>;
    expect(parts.some(p => p.type === 'text')).toBe(true);
    expect(parts.some(p => p.type === 'image_url')).toBe(true);
  });

  it('converts string input and instructions to OpenAI messages', () => {
    const openai = responsesRequestToOpenAI({
      model: 'gpt-5.4',
      instructions: 'You are helpful.',
      input: 'Hello',
    });

    expect(openai.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(openai.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('converts function_call_output items to tool messages', () => {
    const openai = responsesRequestToOpenAI({
      input: [{
        type: 'function_call_output',
        call_id: 'call_abc',
        output: '{"ok":true}',
      }],
    });

    expect(openai.messages).toEqual([{
      role: 'tool',
      tool_call_id: 'call_abc',
      content: '{"ok":true}',
    }]);
  });

  it('converts Responses tools to OpenAI tool definitions', () => {
    const openai = responsesRequestToOpenAI({
      input: 'hi',
      tools: [{
        type: 'function',
        name: 'get_weather',
        description: 'Weather lookup',
        parameters: { type: 'object', properties: {} },
      }],
      tool_choice: 'auto',
    });

    expect(openai.tools?.[0].function.name).toBe('get_weather');
    expect(openai.tool_choice).toBe('auto');
  });

  it('maps chat completion to Responses object', () => {
    const result: ChatCompletionResponse = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'groq/llama',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hi there!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const response = openAIResponseToResponses(result, { input: 'Hello' }, 'gpt-5.4');
    expect(response.object).toBe('response');
    expect(response.status).toBe('completed');
    expect(response.output_text).toBe('Hi there!');
    expect(response.output[0].type).toBe('message');
    expect(response.usage?.total_tokens).toBe(15);
  });

  it('emits Responses SSE events from stream chunks', () => {
    const encoder = new ResponsesStreamEncoder({ input: 'Hi', model: 'gpt-5.4' }, 'gpt-5.4');
    encoder.setInputTokens(4);

    const events: string[] = [];
    for (const event of encoder.encodeChunk({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    })) {
      events.push(event.event);
    }
    for (const event of encoder.finalize()) {
      events.push(event.event);
    }

    expect(events).toContain('response.created');
    expect(events).toContain('response.output_text.delta');
    expect(events).toContain('response.completed');

    const sse = formatResponsesSse({
      event: 'response.output_text.delta',
      data: { type: 'response.output_text.delta', delta: 'x' },
    });
    expect(sse).toContain('event: response.output_text.delta');
    expect(sse).toContain('"delta":"x"');
  });

  it('coerces object/array stream deltas to text (avoids [object Object])', () => {
    const encoder = new ResponsesStreamEncoder({ input: 'Hi', model: 'auto' }, 'auto');
    encoder.setInputTokens(1);

    const deltas: string[] = [];
    for (const event of encoder.encodeChunk({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [{
        index: 0,
        delta: { content: [{ type: 'text', text: 'Hi' }] as unknown as string },
        finish_reason: null,
      }],
    })) {
      if (event.event === 'response.output_text.delta') {
        deltas.push((event.data as { delta: string }).delta);
      }
    }

    expect(deltas).toEqual(['Hi']);
    expect(deltas.join('')).not.toContain('[object Object]');
  });
});
