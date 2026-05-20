import { describe, it, expect } from 'vitest';
import {
  messagesHaveImages,
  modelSupportsVision,
  estimateContentTokens,
} from '../../lib/message-content.js';
import type { ChatMessage } from '@freellmapi/shared/types.js';

describe('message-content', () => {
  it('detects image_url in user messages', () => {
    const messages: ChatMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
      ],
    }];
    expect(messagesHaveImages(messages)).toBe(true);
    expect(estimateContentTokens(messages[0].content)).toBeGreaterThan(512);
  });

  it('classifies vision-capable catalog models', () => {
    expect(modelSupportsVision('google', 'gemini-2.5-flash')).toBe(true);
    expect(modelSupportsVision('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')).toBe(true);
    expect(modelSupportsVision('cohere', 'command-a-03-2025')).toBe(false);
  });
});
