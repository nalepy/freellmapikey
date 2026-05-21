import type { ReactNode } from 'react'
import { getOpenAiBaseUrl } from '@/lib/proxy-url'

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
        <code className="font-mono">{KEY_PLACEHOLDER}</code>) with VS Code extensions and other OpenAI-compatible clients at{' '}
        <code className="font-mono">{openAiBase}</code>. Claude Code and Codex should use their factory Anthropic/OpenAI
        endpoints — restore sections below if you previously aimed them at this proxy. Vision requests through the proxy
        route to vision-capable models (Gemini, Llama 4, etc.).
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

      <p className="text-xs font-medium text-foreground pt-2">Claude Code &amp; Codex — factory settings</p>

      <IntegrationCard
        title="Claude Code (CLI &amp; Desktop)"
        subtitle="Restore default Anthropic routing — do not use the local FreeLLMAPIKey endpoint"
      >
        <p className="text-xs text-muted-foreground">
          Factory behavior sends traffic to <code className="font-mono">https://api.anthropic.com</code> with your Anthropic
          or claude.ai subscription. For free-tier routing through this proxy, use <strong>Continue</strong> or{' '}
          <strong>Cline</strong> in VS Code instead.
        </p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Remove proxy overrides from your shell profile, terminal session, and{' '}
            <code className="font-mono">{claudeSettingsPath}</code> (delete the whole{' '}
            <code className="font-mono">env</code> block if it only existed for FreeLLMAPIKey).
          </li>
          <li>
            Clear session variables (PowerShell example below). Do not leave{' '}
            <code className="font-mono">ANTHROPIC_BASE_URL</code> pointing at <code className="font-mono">localhost</code>.
          </li>
          <li>
            In <code className="font-mono">claude</code>, run <code className="font-mono">/logout</code> if you mixed a
            FreeLLMAPIKey key with a claude.ai login, then sign in again with Anthropic as usual.
          </li>
          <li>
            Claude <strong>Desktop</strong> (Code tab): leave the built-in environment as managed — no custom{' '}
            <code className="font-mono">ANTHROPIC_BASE_URL</code>.
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
        <p className="text-xs font-medium text-foreground">settings.json — remove local proxy block</p>
        <p className="text-xs text-muted-foreground">
          If <code className="font-mono">{claudeSettingsPath}</code> contains{' '}
          <code className="font-mono">ANTHROPIC_BASE_URL</code> aimed at this app, delete those keys or remove the file’s{' '}
          <code className="font-mono">env</code> section. An empty or default file is fine.
        </p>
        <CodeBlock>{`{
  "env": {}
}`}</CodeBlock>
        <p className="text-xs text-muted-foreground">
          After restore, Usage log in this dashboard should stay empty for Claude — that confirms traffic is no longer
          hitting FreeLLMAPIKey.
        </p>
      </IntegrationCard>

      <IntegrationCard
        title="OpenAI Codex (CLI &amp; Desktop)"
        subtitle="Restore default OpenAI routing — remove FreeLLMAPIKey provider from config.toml"
      >
        <p className="text-xs text-muted-foreground">
          Factory Codex uses OpenAI sign-in and <code className="font-mono">api.openai.com</code>, not a custom{' '}
          <code className="font-mono">base_url</code> on localhost. Edit{' '}
          <code className="font-mono">{codexConfigPath}</code> (Codex → Settings → Open config.toml), then fully quit and
          reopen Codex.
        </p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            Delete the <code className="font-mono">[model_providers.freellmapikey]</code> table and any{' '}
            <code className="font-mono">model_provider = "freellmapikey"</code> line.
          </li>
          <li>
            Remove <code className="font-mono">model_catalog_json</code> if it points at{' '}
            <code className="font-mono">{codexCatalogPath}</code> (optional: delete that JSON file too).
          </li>
          <li>
            Unset <code className="font-mono">CUSTOM_API_KEY</code> if you only used it for FreeLLMAPIKey (
            <code className="font-mono">Remove-Item Env:CUSTOM_API_KEY</code> on PowerShell).
          </li>
          <li>
            Set <code className="font-mono">model_provider = "openai"</code> or remove the line so Codex uses its default
            OpenAI provider, then sign in with your OpenAI account in Codex Settings.
          </li>
          <li>
            Remove freellmapikey-only sandbox overrides (<code className="font-mono">sandbox_mode</code>,{' '}
            <code className="font-mono">[windows] sandbox</code>, etc.) unless you added them for other reasons.
          </li>
        </ol>
        <p className="text-xs font-medium text-foreground">Minimal factory-oriented config.toml</p>
        <CodeBlock>{`# Remove FreeLLMAPIKey / localhost base_url blocks entirely.
model_provider = "openai"
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
          . For local free-tier models, use Continue or Cline on the Guides tab instead of routing Codex through this
          proxy.
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
