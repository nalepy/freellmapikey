import { describe, it, expect, vi, beforeEach } from 'vitest';

const bedrockSignedFetch = vi.hoisted(() => vi.fn());

vi.mock('../../lib/bedrock-sigv4.js', () => ({
  bedrockSignedFetch,
}));

import { BedrockProvider } from '../../providers/bedrock.js';

describe('BedrockProvider', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    provider = new BedrockProvider();
    vi.restoreAllMocks();
    bedrockSignedFetch.mockReset();
  });

  it('should have correct platform and name', () => {
    expect(provider.platform).toBe('bedrock');
    expect(provider.name).toBe('AWS Bedrock');
  });

  it('should call Bedrock Mantle with Bearer token for API key auth', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = url as string;
      capturedHeaders = (init as any).headers;
      return {
        ok: true,
        json: () => Promise.resolve({
          id: 'chatcmpl-bedrock',
          object: 'chat.completion',
          created: 123,
          model: 'openai.gpt-oss-20b-1:0',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
      } as any;
    });

    await provider.chatCompletion(
      'us-west-2:ABSK-test-key',
      [{ role: 'user', content: 'Hi' }],
      'openai.gpt-oss-20b-1:0',
    );

    expect(capturedUrl).toBe('https://bedrock-mantle.us-west-2.api.aws/v1/chat/completions');
    expect(capturedHeaders['Authorization']).toBe('Bearer ABSK-test-key');
    expect(bedrockSignedFetch).not.toHaveBeenCalled();
  });

  it('should reject access key id without secret', async () => {
    await expect(
      provider.chatCompletion('us-east-2:AKIAEXAMPLEKEY', [{ role: 'user', content: 'Hi' }], 'openai.gpt-oss-20b-1:0'),
    ).rejects.toThrow(/Secret Access Key|ABSK/);
  });

  it('should use SigV4 bedrock-runtime for IAM credentials', async () => {
    bedrockSignedFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'chatcmpl-bedrock',
        object: 'chat.completion',
        created: 123,
        model: 'us.anthropic.claude-sonnet-4-6',
        choices: [{ index: 0, message: { role: 'assistant', content: 'IAM ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
      body: null,
    } as Response);

    const result = await provider.chatCompletion(
      'us-east-2:AKIAEXAMPLE:secret-key-value',
      [{ role: 'user', content: 'Hi' }],
      'us.anthropic.claude-sonnet-4-6',
    );

    expect(bedrockSignedFetch).toHaveBeenCalledWith(
      {
        region: 'us-east-2',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secret-key-value',
        sessionToken: undefined,
      },
      'POST',
      '/chat/completions',
      expect.objectContaining({ body: expect.any(String) }),
    );
    expect(result.choices[0].message.content).toBe('IAM ok');
  });
});
