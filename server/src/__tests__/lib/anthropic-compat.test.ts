import { describe, it, expect } from 'vitest';
import {
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
  AnthropicStreamEncoder,
  formatAnthropicSse,
} from '../../lib/anthropic-compat.js';
import type { ChatCompletionResponse } from '@freellmapi/shared/types.js';

describe('anthropic-compat', () => {
  it('converts system + user messages to OpenAI format', () => {
    const openai = anthropicRequestToOpenAI({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(openai.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(openai.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(openai.max_tokens).toBe(1024);
  });

  it('converts assistant tool_use blocks to OpenAI tool_calls', () => {
    const openai = anthropicRequestToOpenAI({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_abc',
          name: 'get_weather',
          input: { city: 'Karachi' },
        }],
      }],
    });

    const assistant = openai.messages.find(m => m.role === 'assistant');
    expect(assistant?.tool_calls).toHaveLength(1);
    expect(assistant?.tool_calls?.[0].function.name).toBe('get_weather');
    expect(assistant?.tool_calls?.[0].function.arguments).toBe('{"city":"Karachi"}');
  });

  it('converts user tool_result blocks to OpenAI tool messages', () => {
    const openai = anthropicRequestToOpenAI({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_abc',
          content: '{"temp_c":30}',
        }],
      }],
    });

    expect(openai.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'toolu_abc',
      content: '{"temp_c":30}',
    });
  });

  it('maps Anthropic tools and tool_choice to OpenAI', () => {
    const openai = anthropicRequestToOpenAI({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{
        name: 'get_weather',
        description: 'Weather lookup',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    });

    expect(openai.tools?.[0].function.name).toBe('get_weather');
    expect(openai.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
  });

  it('converts OpenAI completion to Anthropic message response', () => {
    const openai: ChatCompletionResponse = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'gemini-2.5-flash',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello there',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const anthropic = openAIResponseToAnthropic(openai, 'claude-sonnet-4-20250514');
    expect(anthropic.type).toBe('message');
    expect(anthropic.content[0]).toEqual({ type: 'text', text: 'Hello there' });
    expect(anthropic.stop_reason).toBe('end_turn');
    expect(anthropic.usage.input_tokens).toBe(10);
  });

  it('emits Anthropic SSE events from OpenAI stream chunks', () => {
    const encoder = new AnthropicStreamEncoder('claude-sonnet-4-20250514');
    const events = [
      ...encoder.encodeChunk({
        id: 'x',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'm',
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
      }),
      ...encoder.finalize(),
    ];

    expect(events[0].event).toBe('message_start');
    expect(events.some(e => e.event === 'content_block_delta')).toBe(true);
    expect(events.some(e => e.event === 'message_stop')).toBe(true);

    const sse = formatAnthropicSse(events[0]);
    expect(sse).toContain('event: message_start');
    expect(sse).toContain('data: ');
  });
});
