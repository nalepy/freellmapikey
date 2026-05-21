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

  const continueConfigPath = isWindows
    ? '%USERPROFILE%\\.continue\\config.yaml'
    : '~/.continue/config.yaml'

  const continueConfig = `name: FreeLLMAPI (local)
version: 1.0.0
schema: v1
models:
  - name: FreeLLMAPI
    provider: openai
    model: auto
    apiBase: ${openAiBase}
    apiKey: ${KEY_PLACEHOLDER}
    roles:
      - chat
      - edit
      - apply
    capabilities:
      - tool_use
    defaultCompletionOptions:
      temperature: 0.7
      maxTokens: 4096`

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
        <h2 className="text-sm font-medium">Claude Code, Codex &amp; Continue</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Anthropic Messages (<code className="font-mono">/v1/messages</code>) for the <strong>Claude Code CLI</strong>{' '}
          (terminal only — not the Claude Desktop Code tab), OpenAI Responses (
          <code className="font-mono">/v1/responses</code>) for Codex, and Chat Completions (
          <code className="font-mono">/v1/chat/completions</code>) for <strong>Continue in VS Code</strong> and other
          OpenAI-compatible clients — now with vision: pasted images in Codex and image parts in chat requests are routed
          to vision-capable models (Gemini, Llama 4, etc.). Add provider keys above, then paste your unified key wherever
          you see <code className="font-mono">{KEY_PLACEHOLDER}</code>.
        </p>
      </div>

      <IntegrationCard
        title="Claude Code CLI"
        subtitle="Terminal only — Anthropic-shaped API; freellmapi key, not an Anthropic account key"
      >
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
          role="note"
        >
          <strong>CLI only.</strong> FreeLLMAPI supports the <code className="font-mono">claude</code> command in a
          terminal. The Claude Desktop app (Code tab, Local + gear) cannot set{' '}
          <code className="font-mono">ANTHROPIC_BASE_URL</code> — Desktop shows it as managed and keeps routing to
          Anthropic.
        </div>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Add provider keys on this page — Groq, Google, Hugging Face, Together AI, OpenRouter, etc. (include Google or
            Llama 4 if you use images).
          </li>
          <li>Copy the unified key from the section above.</li>
          <li>Run <code className="font-mono">claude</code> from a terminal with the env vars below (not from Claude Desktop).</li>
        </ol>
        <p className="text-xs font-medium text-foreground">Setup</p>
        <p className="text-xs text-muted-foreground">macOS / Linux</p>
        <CodeBlock>{`export ANTHROPIC_BASE_URL="${origin}"
export ANTHROPIC_API_KEY="${KEY_PLACEHOLDER}"
claude`}</CodeBlock>
        <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
        <CodeBlock>{`$env:ANTHROPIC_BASE_URL = "${origin}"
$env:ANTHROPIC_API_KEY = "${KEY_PLACEHOLDER}"
cd C:\\path\\to\\your\\project
claude`}</CodeBlock>
        <p className="text-xs font-medium text-foreground">Optional: settings.json</p>
        <p className="text-xs text-muted-foreground">
          CLI also reads{' '}
          <code className="font-mono">{isWindows ? '%USERPROFILE%\\.claude\\settings.json' : '~/.claude/settings.json'}</code>:
        </p>
        <CodeBlock>{`{
  "env": {
    "ANTHROPIC_BASE_URL": "${origin}",
    "ANTHROPIC_API_KEY": "${KEY_PLACEHOLDER}"
  }
}`}</CodeBlock>
        <p className="text-xs font-medium text-foreground">Auth conflict (claude.ai login)</p>
        <p className="text-xs text-muted-foreground">
          If you see a yellow warning that both a <strong>claude.ai token</strong> and{' '}
          <code className="font-mono">ANTHROPIC_API_KEY</code> are set, type{' '}
          <code className="font-mono">/logout</code> in the CLI, exit, set only the env vars above, and run{' '}
          <code className="font-mono">claude</code> again. Test with{' '}
          <code className="font-mono">Reply with exactly: FREELLMAPI-OK</code> — then confirm a new row in{' '}
          <strong>Analytics → Usage log</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          Endpoints: <code className="font-mono">POST /v1/messages</code> and{' '}
          <code className="font-mono">POST /v1/messages/count_tokens</code>. Model names like{' '}
          <code className="font-mono">claude-sonnet-4-…</code> are labels — the proxy auto-routes through your fallback chain.
          Image blocks in messages use the same vision routing as Codex (vision-capable models only when images are present).
          After a message, check <strong>Analytics → Usage log</strong> for a new row (provider should be google/groq/huggingface/together, not
          anthropic).
        </p>
        <p className="text-xs font-medium text-foreground">Not supported: Claude Desktop (Code tab)</p>
        <p className="text-xs text-muted-foreground">
          Even with <strong>Local</strong> selected, Pro/Max Desktop blocks{' '}
          <code className="font-mono">ANTHROPIC_BASE_URL</code> in the environment editor (
          <em>managed by Claude Desktop and cannot be overridden</em>). <code className="font-mono">settings.json</code> is
          ignored for routing too — Usage log stays empty and traffic goes to <code className="font-mono">api.anthropic.com</code>.
          Use Cursor or the CLI for FreeLLMAPI; use Desktop only for native Anthropic models and billing.
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
        <p className="text-xs text-muted-foreground">
          Requests from <code className="font-mono">127.0.0.1</code> may work without a bearer key, but setting{' '}
          <code className="font-mono">CUSTOM_API_KEY</code> is still recommended.
        </p>
        <p className="text-xs font-medium text-foreground">Model catalog (optional)</p>
        <p className="text-xs text-muted-foreground">
          Not required for <code className="font-mono">model = "auto"</code> — routing uses your fallback chain either way.
          Codex does not read <code className="font-mono">GET /v1/models</code> for custom providers; use{' '}
          <code className="font-mono">model_catalog_json</code> when you want catalog slugs (e.g.{' '}
          <code className="font-mono">gemini-2.5-flash</code>) in config or CLI. The Desktop UI usually still shows only
          Intelligence (Low / Medium / High). Regenerate the catalog after you add keys or change the fallback chain.
          Server endpoint: <code className="font-mono">GET /v1/codex/model-catalog</code>.
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
        title="Continue (VS Code)"
        subtitle="Continue extension — config.yaml with apiBase → local /v1/chat/completions"
      >
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Install the{' '}
            <a
              href="https://marketplace.visualstudio.com/items?itemName=Continue.continue"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Continue
            </a>{' '}
            extension in VS Code (recommended in this repo&apos;s <code className="font-mono">.vscode/extensions.json</code>
            ).
          </li>
          <li>Start FreeLLMAPI and add provider keys on this page.</li>
          <li>Copy your unified key from the section above.</li>
          <li>
            Open Continue&apos;s config: chat input → configs dropdown (top right) → cog beside{' '}
            <strong>Local Config</strong>, or edit{' '}
            <code className="font-mono">{continueConfigPath}</code> directly.
          </li>
          <li>
            Paste the YAML below, replace <code className="font-mono">{KEY_PLACEHOLDER}</code>, save, then reload the VS
            Code window if the model does not appear (<code className="font-mono">Developer: Reload Window</code>).
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">config.yaml</p>
        <CodeBlock>{continueConfig}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          <code className="font-mono">apiBase</code> must end with <code className="font-mono">/v1</code> (same as the
          OpenAI SDK <code className="font-mono">base_url</code>). Use <code className="font-mono">model: auto</code> to
          follow your dashboard fallback chain, or a slug from{' '}
          <code className="font-mono">GET {openAiBase}/models</code> (e.g.{' '}
          <code className="font-mono">gemini-2.5-flash</code>). <code className="font-mono">tool_use</code> enables
          Continue Agent mode when your routed model supports tools.
        </p>
        <p className="text-xs text-muted-foreground">
          Verify: send a short chat message, then check <strong>Analytics → Usage log</strong> for a new row. Response
          headers include <code className="font-mono">x-routed-via</code> with the provider/model that handled the
          request. Continue uses Chat Completions only — it does not use Codex&apos;s{' '}
          <code className="font-mono">/v1/responses</code> or Claude&apos;s{' '}
          <code className="font-mono">/v1/messages</code>.
        </p>
        <p className="text-xs text-muted-foreground">
          Docs:{' '}
          <a
            href="https://docs.continue.dev/reference/"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            config.yaml reference
          </a>
          .
        </p>
      </IntegrationCard>

      <IntegrationCard
        title="OpenAI SDK &amp; other Chat Completions clients"
        subtitle="Cursor, custom apps — standard /v1/chat/completions"
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
