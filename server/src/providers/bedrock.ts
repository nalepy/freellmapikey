import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '@freellmapikey/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';
import { normalizeChoices, normalizeStreamChunk } from './openai-compat.js';
import { bedrockSignedFetch, type BedrockIamCredentials } from '../lib/bedrock-sigv4.js';

type BedrockAuth =
  | { kind: 'bearer'; region: string; token: string; baseUrl: string }
  | { kind: 'iam'; creds: BedrockIamCredentials; baseUrl: string };

/**
 * AWS Bedrock OpenAI-compatible Chat Completions API.
 *
 * Stored key formats:
 * - Bedrock API key: `region:ABSK…` (Bearer on bedrock-mantle)
 * - IAM access keys: `region:AKIA…:secret` or `region:AKIA…:secret:sessionToken`
 *   (SigV4 on bedrock-runtime — same style as Cursor / AWS CLI)
 */
export class BedrockProvider extends BaseProvider {
  readonly platform = 'bedrock' as const;
  readonly name = 'AWS Bedrock';

  private parseAuth(apiKey: string): BedrockAuth {
    const parts = apiKey.split(':').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      throw new Error(
        'Bedrock key must be region:bedrock_api_key (ABSK…) or region:access_key_id:secret_access_key (IAM).',
      );
    }

    const region = parts[0];
    if (!region) {
      throw new Error('Bedrock key must include an AWS region (e.g. us-east-1).');
    }

    if (parts.length >= 3) {
      const accessKeyId = parts[1];
      const secretAccessKey = parts.length === 4 ? parts[2] : parts.slice(2).join(':');
      const sessionToken = parts.length === 4 ? parts[3] : undefined;
      if (!accessKeyId || !secretAccessKey) {
        throw new Error('IAM credentials need access key id and secret access key.');
      }
      return {
        kind: 'iam',
        creds: { region, accessKeyId, secretAccessKey, sessionToken },
        baseUrl: `https://bedrock-runtime.${region}.amazonaws.com/v1`,
      };
    }

    const token = parts[1];
    if (/^(AKIA|ASIA)[0-9A-Z]{8,}$/i.test(token)) {
      throw new Error(
        'Access Key ID alone is not enough. Add Secret Access Key (IAM) or use a Bedrock API key (ABSK…) from the Bedrock console.',
      );
    }
    return {
      kind: 'bearer',
      region,
      token,
      baseUrl: `https://bedrock-mantle.${region}.api.aws/v1`,
    };
  }

  private async request(
    auth: BedrockAuth,
    path: string,
    init: { method: string; body?: string; stream?: boolean },
    timeoutMs?: number,
  ): Promise<Response> {
    if (auth.kind === 'bearer') {
      return this.fetchWithTimeout(`${auth.baseUrl}${path}`, {
        method: init.method,
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: init.body,
      }, timeoutMs);
    }

    return bedrockSignedFetch(auth.creds, init.method, path, {
      body: init.body,
      timeoutMs,
    });
  }

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    const auth = this.parseAuth(apiKey);
    const res = await this.request(auth, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        top_p: options?.top_p,
        tools: options?.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: options?.parallel_tool_calls,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`AWS Bedrock API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const data = await res.json() as ChatCompletionResponse;
    normalizeChoices(data);
    data._routed_via = { platform: 'bedrock', model: modelId };
    return data;
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const auth = this.parseAuth(apiKey);
    const res = await this.request(auth, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        top_p: options?.top_p,
        tools: options?.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: options?.parallel_tool_calls,
        stream: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`AWS Bedrock API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          yield normalizeStreamChunk(JSON.parse(data) as ChatCompletionChunk);
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async validateKey(apiKey: string): Promise<boolean> {
    const auth = this.parseAuth(apiKey);
    const res = await this.request(auth, '/models', { method: 'GET' }, 10000);
    return res.status !== 401 && res.status !== 403;
  }
}
