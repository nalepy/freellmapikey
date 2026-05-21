/** Origin of the FreeLLMAPIKey server (no trailing slash). */
export function getProxyOrigin(): string {
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:${__SERVER_PORT__}`
  }
  return window.location.origin
}

/** OpenAI-compatible base URL (`…/v1`). */
export function getOpenAiBaseUrl(): string {
  return `${getProxyOrigin()}/v1`
}
