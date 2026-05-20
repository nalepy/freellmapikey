import type { ChatContentPart, ChatMessage } from '@freellmapi/shared/types.js';

export function messagesHaveImages(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part.type === 'image_url') return true;
    }
  }
  return false;
}

export function textFromMessageContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p): p is Extract<ChatContentPart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('');
}

/** Rough token estimate for routing (text ≈ chars/4; images ≈ fixed budget). */
export function estimateContentTokens(content: ChatMessage['content']): number {
  if (typeof content === 'string') return Math.ceil(content.length / 4);
  if (!Array.isArray(content)) return 0;

  let tokens = 0;
  for (const part of content) {
    if (part.type === 'text') {
      tokens += Math.ceil(part.text.length / 4);
    } else if (part.type === 'image_url') {
      tokens += 512;
    }
  }
  return tokens;
}

/**
 * Heuristic: models in the fallback catalog that accept image inputs.
 * Used when Codex / clients send multimodal messages.
 */
export function modelSupportsVision(platform: string, modelId: string): boolean {
  const id = modelId.toLowerCase();

  if (platform === 'google' && id.includes('gemini')) return true;

  if (
    id.includes('llama-4-scout')
    || id.includes('llama-4-maverick')
    || id.includes('meta-llama/llama-4')
    || id.includes('@cf/meta/llama-4')
  ) {
    return true;
  }

  if (id.includes('gpt-4o') || id.includes('gpt-4.1')) return true;
  if (id.includes('-vl-') || id.includes('vision') || id.includes('pixtral')) return true;

  return false;
}

export function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}
