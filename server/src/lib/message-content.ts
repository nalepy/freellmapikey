import type { ChatContentPart, ChatMessage } from '@freellmapikey/shared/types.js';

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

/** Coerce provider stream deltas (string, segment arrays, reasoning fields) to plain text. */
export function deltaContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';

  if (Array.isArray(content)) {
    return content
      .map(seg => {
        if (typeof seg === 'string') return seg;
        if (typeof seg === 'object' && seg !== null) {
          const part = seg as Record<string, unknown>;
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
        }
        return '';
      })
      .join('');
  }

  if (typeof content === 'object') {
    const part = content as Record<string, unknown>;
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (typeof part.reasoning_content === 'string') return part.reasoning_content;
    if (typeof part.reasoning === 'string') return part.reasoning;
  }

  return '';
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

/** Lower = tried earlier when requiresVision is set. */
export function visionRouteSortKey(platform: string, modelId: string): number {
  const id = modelId.toLowerCase();
  const p = platform.toLowerCase();
  if (p === 'google' && id.includes('gemini')) return 0;
  if (p === 'groq' && id.includes('llama-4-scout')) return 1;
  if (p === 'cloudflare' && id.includes('llama-4')) return 2;
  return 3;
}

/**
 * Models that accept image inputs in practice (not just "Llama 4" in the name).
 * SambaNova/Cerebras Maverick return 400 on multimodal OpenAI-style payloads.
 */
export function modelSupportsVision(platform: string, modelId: string): boolean {
  const id = modelId.toLowerCase();
  const p = platform.toLowerCase();

  if (p === 'google' && id.includes('gemini')) return true;
  if (p === 'groq' && id.includes('llama-4-scout')) return true;
  if (p === 'cloudflare' && id.includes('llama-4-scout')) return true;

  if (id.includes('gpt-4o') || id.includes('gpt-4.1')) return true;
  if (id.includes('-vl-') || id.includes('vision') || id.includes('pixtral')) return true;

  return false;
}

export function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}
