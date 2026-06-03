import { Sha256 } from '@aws-crypto/sha256-js';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';

export interface BedrockIamCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function runtimeHost(region: string): string {
  return `bedrock-runtime.${region}.amazonaws.com`;
}

function toFetchUrl(req: HttpRequest): string {
  const query = req.query
    ? Object.entries(req.query)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const q = query ? `?${query}` : '';
  return `https://${req.hostname}${req.path}${q}`;
}

export async function bedrockSignedFetch(
  creds: BedrockIamCredentials,
  method: string,
  path: string,
  init?: { body?: string; headers?: Record<string, string>; timeoutMs?: number },
): Promise<Response> {
  const hostname = runtimeHost(creds.region);
  const headers: Record<string, string> = {
    host: hostname,
    ...init?.headers,
  };
  if (init?.body != null && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const request = new HttpRequest({
    protocol: 'https:',
    hostname,
    method,
    path,
    headers,
    body: init?.body,
  });

  const signer = new SignatureV4({
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
    region: creds.region,
    service: 'bedrock',
    sha256: Sha256,
  });

  // @aws-sdk/signature-v4 bundles its own @smithy/types, so its HttpRequest
  // differs from @smithy/protocol-http's at the type level (missing `clone`).
  // Both are structurally identical at runtime — double-cast to our local type.
  const signFn = signer.sign.bind(signer) as unknown as (req: HttpRequest) => Promise<HttpRequest>;
  const signed = await signFn(request);
  const url = toFetchUrl(signed);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15000);
  try {
    return await fetch(url, {
      method: signed.method,
      headers: signed.headers as Record<string, string>,
      body: signed.body as string | undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
