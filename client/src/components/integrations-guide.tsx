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

  const claudeSettingsPath = isWindows
    ? '%USERPROFILE%\\.claude\\settings.json'
    : '~/.claude/settings.json'

  const codexConfigPath = isWindows
    ? '%USERPROFILE%\\.codex\\config.toml'
    : '~/.codex/config.toml'

  const codexCatalogPath = isWindows
    ? '%USERPROFILE%\\.codex\\freellmapikey-models.json'
    : '~/.codex/freellmapikey-models.json'

  const codexCatalogPathToml = isWindows
    ? 'C:\\\\Users\\\\<you>\\\\.codex\\\\freellmapikey-models.json'
    : '/Users/<you>/.codex/freellmapikey-models.json'

  const syncCatalog = useMutation({
    mutationFn: () =>
      apiFetch<{ path: string; modelCount: number; configSnippet: string }>('/api/codex/sync-catalog', {
        method: 'POST',
        body: '{}',
      }),
  })

  const codexConfig = `model_provider = "freellmapikey"
model = "auto"
model_reasoning_effort = "medium"
model_catalog_json = "${codexCatalogPathToml}"

[model_providers.freellmapikey]
name = "FreeLLMAPIKey (local)"
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

  const continueConfigPath = isWindows
    ? '%USERPROFILE%\\.continue\\config.yaml'
    : '~/.continue/config.yaml'

  const continueModelEntry = `  - name: FreeLLMAPIKey
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

  const continueConfigFull = `name: FreeLLMAPIKey (local)
version: 1.0.0
schema: v1
models:
${continueModelEntry}`

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Add provider keys on the <strong>Keys</strong> page first. Use your unified key (
        <code className="font-mono">{KEY_PLACEHOLDER}</code>) wherever a snippet shows it. VS Code extensions and other
        OpenAI-compatible clients use <code className="font-mono">{openAiBase}</code>. Claude Code CLI and Codex each have{' '}
        <strong>configure local proxy</strong> and <strong>restore factory</strong> sections below. Vision requests through
        the proxy route to vision-capable models (Gemini, Llama 4, etc.).
      </p>

      <p className="text-xs font-medium text-foreground pt-1">VS Code extensions</p>

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
          <li>Start FreeLLMAPIKey and add provider keys on the Keys page.</li>
          <li>Copy your unified key from above.</li>
          <li>
            Open Continue&apos;s config: chat input → configs dropdown (top right) → cog beside{' '}
            <strong>Local Config</strong>, or edit{' '}
            <code className="font-mono">{continueConfigPath}</code> directly.
          </li>
          <li>
            Add FreeLLMAPIKey using one of the YAML blocks below (replace{' '}
            <code className="font-mono">{KEY_PLACEHOLDER}</code>), save, then reload the VS Code window if the model does
            not appear (<code className="font-mono">Developer: Reload Window</code>).
          </li>
          <li>
            In Continue, pick <strong>FreeLLMAPIKey</strong> from the model/config dropdown before chatting.
          </li>
        </ol>
        <div
          className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-foreground"
          role="note"
        >
          <strong>Already have a config?</strong> Do not replace the whole file. Keep your existing{' '}
          <code className="font-mono">name</code>, <code className="font-mono">version</code>,{' '}
          <code className="font-mono">schema</code>, <code className="font-mono">context</code>, and other{' '}
          <code className="font-mono">models</code> entries — append one new list item under{' '}
          <code className="font-mono">models:</code> (there must be only one <code className="font-mono">models:</code>{' '}
          key). Replace the entire file only if you want FreeLLMAPIKey as your sole model.
        </div>
        <p className="text-xs font-medium text-foreground">Existing config — append under models:</p>
        <CodeBlock>{continueModelEntry}</CodeBlock>
        <p className="text-xs font-medium text-foreground">New install — full config.yaml:</p>
        <CodeBlock>{continueConfigFull}</CodeBlock>
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
        <p className="text-xs font-medium text-foreground">Using Continue after config</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Open the Continue sidebar: <code className="font-mono">Ctrl+L</code> (Windows/Linux) or{' '}
            <code className="font-mono">Cmd+L</code> (macOS), or click the Continue icon in the Activity Bar.
          </li>
          <li>
            Above the chat input, open the config/agent dropdown → choose <strong>Local Config</strong> if prompted.
          </li>
          <li>
            Select <strong>FreeLLMAPIKey</strong> as the active model, then send a message (e.g.{' '}
            <code className="font-mono">Reply with exactly: freellmapikey-OK</code>).
          </li>
          <li>
            Confirm a new row in <strong>Analytics → Usage log</strong>. Tab autocomplete uses a separate model unless you
            add an <code className="font-mono">autocomplete</code> role entry.
          </li>
        </ol>
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
        title="Cline (VS Code)"
        subtitle="OpenAI Compatible provider — settings UI, Plan/Act agent"
      >
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Install{' '}
            <a
              href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Cline
            </a>{' '}
            in VS Code (also listed in <code className="font-mono">.vscode/extensions.json</code>).
          </li>
          <li>Start FreeLLMAPIKey and add provider keys on the Keys page.</li>
          <li>Copy your unified key from above.</li>
          <li>
            Open the Cline panel (Activity Bar) → <strong>Settings</strong> (gear icon) → set{' '}
            <strong>API Provider</strong> to <strong>OpenAI Compatible</strong> (may appear as{' '}
            <code className="font-mono">openai-compatible</code>).
          </li>
          <li>
            Fill in <strong>Base URL</strong> <code className="font-mono">{openAiBase}</code>, <strong>API Key</strong>{' '}
            <code className="font-mono">{KEY_PLACEHOLDER}</code>, and <strong>Model ID</strong>{' '}
            <code className="font-mono">auto</code> (or a slug from{' '}
            <code className="font-mono">GET {openAiBase}/models</code>).
          </li>
          <li>Use <strong>Verify</strong> if the settings panel offers it, then start a task in the Cline chat.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Cline uses <code className="font-mono">/v1/chat/completions</code> with tool calling for its agent loop. If
          Plan and Act modes show separate model fields, set both to <code className="font-mono">auto</code> or the same
          slug. Check <strong>Analytics → Usage log</strong> after your first message.
        </p>
        <p className="text-xs text-muted-foreground">
          Docs:{' '}
          <a
            href="https://docs.cline.bot/provider-config/openai-compatible"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAI Compatible provider
          </a>
          .
        </p>
      </IntegrationCard>

      <p className="text-xs font-medium text-foreground pt-2">Claude Code &amp; Codex</p>

      <IntegrationCard
        title="Claude Code (CLI)"
        subtitle="Configure local proxy or restore factory Anthropic routing"
      >
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
          role="note"
        >
          <strong>CLI only.</strong> Local proxy works with the <code className="font-mono">claude</code> terminal command.
          Claude <strong>Desktop</strong> (Code tab) cannot override{' '}
          <code className="font-mono">ANTHROPIC_BASE_URL</code> — it stays on{' '}
          <code className="font-mono">api.anthropic.com</code>.
        </div>

        <p className="text-xs font-medium text-foreground">Configure local proxy</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Add provider keys on the Keys page (include Google or Llama 4 if you send images).</li>
          <li>Copy your unified key from above.</li>
          <li>
            Run <code className="font-mono">claude</code> from a terminal with the env vars below (not from Claude Desktop).
          </li>
        </ol>
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
          CLI also reads <code className="font-mono">{claudeSettingsPath}</code>:
        </p>
        <CodeBlock>{`{
  "env": {
    "ANTHROPIC_BASE_URL": "${origin}",
    "ANTHROPIC_API_KEY": "${KEY_PLACEHOLDER}"
  }
}`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          If you see a warning about both a <strong>claude.ai token</strong> and{' '}
          <code className="font-mono">ANTHROPIC_API_KEY</code>, run <code className="font-mono">/logout</code> in the CLI,
          exit, set only the env vars above, and run <code className="font-mono">claude</code> again. Test with{' '}
          <code className="font-mono">Reply with exactly: freellmapikey-OK</code>, then confirm a row in{' '}
          <strong>Analytics → Usage log</strong> (provider should be google/groq/cerebras, not anthropic).
        </p>
        <p className="text-xs text-muted-foreground">
          Endpoints: <code className="font-mono">POST /v1/messages</code> and{' '}
          <code className="font-mono">POST /v1/messages/count_tokens</code>. Names like{' '}
          <code className="font-mono">claude-sonnet-4-…</code> are labels — the proxy auto-routes through your fallback chain.
        </p>

        <p className="text-xs font-medium text-foreground pt-2 border-t pt-3">Restore factory Anthropic routing</p>
        <p className="text-xs text-muted-foreground">
          Use this when you want <code className="font-mono">https://api.anthropic.com</code> and your Anthropic or claude.ai
          subscription again.
        </p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Remove proxy overrides from your shell profile, session, and{' '}
            <code className="font-mono">{claudeSettingsPath}</code> (delete the{' '}
            <code className="font-mono">env</code> block if it only existed for FreeLLMAPIKey).
          </li>
          <li>
            In <code className="font-mono">claude</code>, run <code className="font-mono">/logout</code> if you mixed a
            FreeLLMAPIKey key with claude.ai login, then sign in with Anthropic as usual.
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">macOS / Linux — clear proxy env</p>
        <CodeBlock>{`unset ANTHROPIC_BASE_URL
unset ANTHROPIC_API_KEY   # only if you set the FreeLLMAPIKey unified key here
claude`}</CodeBlock>
        <p className="text-xs font-medium text-foreground">Windows (PowerShell) — clear proxy env</p>
        <CodeBlock>{`Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
claude`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          After restore, Usage log in this dashboard should stay empty for Claude — traffic is no longer hitting
          FreeLLMAPIKey.
        </p>
      </IntegrationCard>

      <IntegrationCard
        title="OpenAI Codex (CLI &amp; Desktop)"
        subtitle="Configure local proxy or restore factory OpenAI routing"
      >
        <p className="text-xs font-medium text-foreground">Configure local proxy</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Start FreeLLMAPIKey and add provider keys on the Keys page.</li>
          <li>Set <code className="font-mono">CUSTOM_API_KEY</code> to your unified key (same value as above).</li>
          <li>
            Edit <code className="font-mono">{codexConfigPath}</code> (Codex → Settings → Open config.toml), paste the
            block below, save, then fully quit and reopen Codex.
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">Environment variable</p>
        <CodeBlock>
          {isWindows
            ? `set CUSTOM_API_KEY=${KEY_PLACEHOLDER}`
            : `export CUSTOM_API_KEY="${KEY_PLACEHOLDER}"`}
        </CodeBlock>
        <p className="text-xs font-medium text-foreground">Model catalog (optional)</p>
        <p className="text-xs text-muted-foreground">
          Not required for <code className="font-mono">model = "auto"</code>. Use{' '}
          <code className="font-mono">model_catalog_json</code> when you want catalog slugs (e.g.{' '}
          <code className="font-mono">gemini-2.5-flash</code>) in config or CLI. Regenerate after you change keys or the
          fallback chain.
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
          Default path: <code className="font-mono">{codexCatalogPath}</code>. CLI:{' '}
          <code className="font-mono">npm run codex:model-catalog</code>
        </p>
        <p className="text-xs font-medium text-foreground">config.toml (local proxy)</p>
        <CodeBlock>{codexConfig}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          Use <code className="font-mono">model = "auto"</code> to follow your fallback chain. Pin a slug such as{' '}
          <code className="font-mono">gemini-2.5-flash</code> to force one backend. Check{' '}
          <strong>Analytics → Usage log</strong> after a Codex message.
        </p>

        <p className="text-xs font-medium text-foreground pt-2 border-t pt-3">Restore factory OpenAI routing</p>
        <p className="text-xs text-muted-foreground">
          Use this when you want Codex on OpenAI sign-in and <code className="font-mono">api.openai.com</code> again.
        </p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Delete <code className="font-mono">[model_providers.freellmapikey]</code> and any{' '}
            <code className="font-mono">model_provider = "freellmapikey"</code> line from{' '}
            <code className="font-mono">{codexConfigPath}</code>.
          </li>
          <li>
            Remove <code className="font-mono">model_catalog_json</code> if it points at{' '}
            <code className="font-mono">{codexCatalogPath}</code> (optional: delete that JSON file).
          </li>
          <li>
            Unset <code className="font-mono">CUSTOM_API_KEY</code> if you only used it here (
            <code className="font-mono">Remove-Item Env:CUSTOM_API_KEY</code> on PowerShell).
          </li>
          <li>
            Set <code className="font-mono">model_provider = "openai"</code>, sign in with OpenAI in Codex Settings, quit
            and reopen Codex.
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">config.toml (factory)</p>
        <CodeBlock>{`model_provider = "openai"
# model = "gpt-5.3-codex"   # optional — pick in Codex UI after sign-in`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          Docs:{' '}
          <a
            href="https://developers.openai.com/codex/config"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Codex configuration
          </a>
          .
        </p>
      </IntegrationCard>

      <p className="text-xs font-medium text-foreground pt-2">Local proxy (OpenAI-compatible)</p>

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
