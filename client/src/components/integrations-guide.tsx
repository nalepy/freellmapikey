import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { getOpenAiBaseUrl, getProxyOrigin } from '@/lib/proxy-url'

/** Shown in setup snippets only — never the real key from the API. */
const KEY_PLACEHOLDER = 'YOUR_UNIFIED_KEY'

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="font-mono text-[11px] leading-relaxed bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
      {children}
    </pre>
  )
}

function IntegrationCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="cursor-pointer list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <span className="text-xs text-muted-foreground group-open:rotate-180 transition-transform mt-0.5">
            ▾
          </span>
        </div>
      </summary>
      <div className="px-5 pb-5 pt-0 space-y-3 border-t">{children}</div>
    </details>
  )
}

export function IntegrationsGuide() {
  const origin = getProxyOrigin()
  const openAiBase = getOpenAiBaseUrl()
  const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)

  const codexConfigPath = isWindows
    ? '%USERPROFILE%\\.codex\\config.toml'
    : '~/.codex/config.toml'

  const codexCatalogPath = isWindows
    ? '%USERPROFILE%\\.codex\\freellmapi-models.json'
    : '~/.codex/freellmapi-models.json'

  const codexCatalogPathToml = isWindows
    ? 'C:\\\\Users\\\\<you>\\\\.codex\\\\freellmapi-models.json'
    : '/Users/<you>/.codex/freellmapi-models.json'

  const syncCatalog = useMutation({
    mutationFn: () => apiFetch<{ path: string; modelCount: number; configSnippet: string }>(
      '/api/codex/sync-catalog',
      { method: 'POST', body: '{}' },
    ),
  })

  const codexConfig = `model_provider = "freellmapi"
model = "auto"
model_reasoning_effort = "medium"
model_catalog_json = "${codexCatalogPathToml}"

[model_providers.freellmapi]
name = "FreeLLMAPI (local)"
base_url = "${openAiBase}"
env_key = "CUSTOM_API_KEY"
wire_api = "responses"
requires_openai_auth = false

# Windows only — if Codex shows "Couldn't set up admin sandbox":
sandbox_mode = "danger-full-access"
approval_policy = "never"

[windows]
sandbox = "unelevated"

[sandbox_workspace_write]
network_access = true`

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Claude Code &amp; OpenAI Codex</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Anthropic Messages (<code className="font-mono">/v1/messages</code>) for Claude Code, OpenAI Responses (
          <code className="font-mono">/v1/responses</code>) for Codex, and Chat Completions for other clients — now with{' '}
          vision: pasted images in Codex and image parts in chat
          requests are routed to vision-capable models (Gemini, Llama 4, etc.). Add provider keys above, then paste your
          unified key wherever you see <code className="font-mono">{KEY_PLACEHOLDER}</code>.
        </p>
      </div>

      <IntegrationCard
        title="Claude Code"
        subtitle="Anthropic-shaped API — use your freellmapi key, not an Anthropic account key"
      >
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Add Groq, Google, or other provider keys on this page.</li>
          <li>Copy the unified key from the section above.</li>
          <li>Set environment variables before starting Claude Code (terminal where you run <code className="font-mono">claude</code>).</li>
        </ol>
        <p className="text-xs font-medium text-foreground">macOS / Linux</p>
        <CodeBlock>{`export ANTHROPIC_BASE_URL="${origin}"
export ANTHROPIC_API_KEY="${KEY_PLACEHOLDER}"
claude`}</CodeBlock>
        <p className="text-xs font-medium text-foreground">Windows (PowerShell)</p>
        <CodeBlock>{`$env:ANTHROPIC_BASE_URL = "${origin}"
$env:ANTHROPIC_API_KEY = "${KEY_PLACEHOLDER}"
claude`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          Endpoint: <code className="font-mono">POST /v1/messages</code>. Model names like{' '}
          <code className="font-mono">claude-sonnet-4-…</code> are labels — the proxy auto-routes through your fallback chain.
        </p>
      </IntegrationCard>

      <IntegrationCard
        title="OpenAI Codex"
        subtitle="CLI or Desktop — Responses API, including pasted images (vision)"
      >
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Start FreeLLMAPI and add provider keys.</li>
          <li>Set <code className="font-mono">CUSTOM_API_KEY</code> to your unified key (same value as above).</li>
          <li>Edit Codex config: <code className="font-mono">{codexConfigPath}</code> (Codex → Settings → Open config.toml).</li>
          <li>Restart Codex after saving — config is read at startup.</li>
        </ol>
        <p className="text-xs font-medium text-foreground">Environment variable</p>
        <CodeBlock>{isWindows
          ? `set CUSTOM_API_KEY=${KEY_PLACEHOLDER}`
          : `export CUSTOM_API_KEY="${KEY_PLACEHOLDER}"`}</CodeBlock>
        <p className="text-xs font-medium text-foreground">Model catalog (required for model names in Codex)</p>
        <p className="text-xs text-muted-foreground">
          Codex does not read <code className="font-mono">GET /v1/models</code> for custom providers. It only shows
          Intelligence (Low / Medium / High) until you point <code className="font-mono">model_catalog_json</code> at a
          file with your FreeLLMAPI models. Regenerate that file after you add keys or change the fallback chain.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={syncCatalog.isPending}
            onClick={() => syncCatalog.mutate()}
          >
            {syncCatalog.isPending ? 'Writing catalog…' : 'Write Codex model catalog'}
          </Button>
          {syncCatalog.isSuccess && (
            <span className="text-xs text-muted-foreground">
              Wrote {syncCatalog.data.modelCount} models to {syncCatalog.data.path}
            </span>
          )}
          {syncCatalog.isError && (
            <span className="text-xs text-destructive">Could not write catalog — is the server running?</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Default path: <code className="font-mono">{codexCatalogPath}</code>. CLI alternative:{' '}
          <code className="font-mono">npm run codex:model-catalog</code>
        </p>
        <p className="text-xs font-medium text-foreground">config.toml</p>
        <CodeBlock>{codexConfig}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          Set <code className="font-mono">model = "auto"</code> (not <code className="font-mono">gpt-5.3-codex</code>) so
          routing uses your fallback chain. To pin one backend, use a catalog slug such as{' '}
          <code className="font-mono">gemini-2.5-flash</code>. The Intelligence menu only changes reasoning depth, not which
          FreeLLMAPI model runs. <code className="font-mono">FreeLLMAPI (local)</code> is a label when you have a single
          provider — it is not a second menu. Restart Codex after editing config. Codex Desktop may still hide custom
          models in the picker (
          <a
            href="https://github.com/openai/codex/issues/19694"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            known issue
          </a>
          ); set <code className="font-mono">model</code> in TOML or use the CLI{' '}
          <code className="font-mono">codex -c model=auto</code>.
        </p>
      </IntegrationCard>

      <IntegrationCard
        title="OpenAI SDK &amp; other Chat Completions clients"
        subtitle="Cursor, Continue, custom apps — standard /v1/chat/completions"
      >
        <CodeBlock>{`from openai import OpenAI

client = OpenAI(
    base_url="${openAiBase}",
    api_key="${KEY_PLACEHOLDER}",
)

client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello"}],
)`}</CodeBlock>
      </IntegrationCard>
    </section>
  )
}
