<div align="center">

# FreeLLMAPI

**One OpenAI-compatible endpoint. 17 integrated providers. ~1B+ tokens per month.**

Aggregate the free tiers from Google, Groq, Cerebras, SambaNova, NVIDIA, Mistral, OpenRouter, GitHub Models, Cohere, Cloudflare, Hugging Face, Together AI, and Z.ai (Zhipu) behind a single `/v1/chat/completions` endpoint. Keys are stored encrypted. A router picks the best available model for each request, falls over to the next provider when one is rate-limited, and tracks per-key usage so you stay under every free-tier cap.

[![CI](https://github.com/tashfeenahmed/freellmapi/actions/workflows/ci.yml/badge.svg)](https://github.com/tashfeenahmed/freellmapi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

![Fallback chain with per-provider token budget](repo-assets/fallback-chain.png)

</div>

---

## Contents

- [Why this exists](#why-this-exists)
- [Supported providers](#supported-providers)
- [Features](#features)
- [Not yet supported](#not-yet-supported)
- [Quick start](#quick-start)
- [Using the API](#using-the-api)
- [Screenshots](#screenshots)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [Terms of Service review](#terms-of-service-review)
- [Disclaimer](#disclaimer)

## Why this exists

Every serious AI lab now offers a free tier — a few million tokens a month, a few thousand requests a day. On its own each tier is a toy. Stacked together, they add up to roughly **1.3 billion tokens per month** of working inference capacity, across dozens of models from small-and-fast to reasonably capable.

The problem is that stacking them by hand is painful: many different SDKs, rate limits, and failure modes per vendor. FreeLLMAPI collapses that into one OpenAI-compatible endpoint. Point any OpenAI client library at your local server, and it routes transparently across whichever providers you've added keys for.

## Supported providers

<table>
<tr>
<td align="center" width="180"><a href="https://ai.google.dev"><b>Google</b><br/>Gemini 2.5 Flash · 3.x previews</a></td>
<td align="center" width="180"><a href="https://groq.com"><b>Groq</b><br/>Llama 3.3, Llama 4, GPT-OSS, Qwen3</a></td>
<td align="center" width="180"><a href="https://cerebras.ai"><b>Cerebras</b><br/>Qwen3 235B</a></td>
<td align="center" width="180"><a href="https://cloud.sambanova.ai"><b>SambaNova</b><br/>DeepSeek V3.x · Llama 4 · Gemma 3</a></td>
</tr>
<tr>
<td align="center"><a href="https://mistral.ai"><b>Mistral</b><br/>Large 3 · Medium 3.5 · Codestral · Devstral</a></td>
<td align="center"><a href="https://openrouter.ai"><b>OpenRouter</b><br/>19 free-tier models</a></td>
<td align="center"><a href="https://github.com/marketplace/models"><b>GitHub Models</b><br/>GPT-4.1 · GPT-4o</a></td>
<td align="center"><a href="https://developers.cloudflare.com/workers-ai"><b>Cloudflare</b><br/>Kimi K2 · GLM-4.7 · GPT-OSS · Granite 4</a></td>
</tr>
<tr>
<td align="center"><a href="https://cohere.com"><b>Cohere</b><br/>Command R+ · Command-A (trial)</a></td>
<td align="center"><a href="https://huggingface.co/docs/inference-providers"><b>Hugging Face</b><br/>GPT-OSS · Llama 3.1/3.3 (router)</a></td>
<td align="center"><a href="https://docs.together.ai"><b>Together AI</b><br/>GPT-OSS 20B · Llama 3.1/3.3 Turbo</a></td>
<td align="center"><a href="https://docs.z.ai"><b>Z.ai (Zhipu)</b><br/>GLM-4.5 · GLM-4.7 Flash</a></td>
</tr>
<tr>
<td align="center"><a href="https://build.nvidia.com"><b>NVIDIA</b><br/>NIM (disabled by default)</a></td>
<td colspan="3" align="center"><i>Adding another? See <a href="#contributing">Contributing</a>.</i></td>
</tr>
</table>

## Features

- **OpenAI-compatible** — `POST /v1/chat/completions` and `GET /v1/models` work with the official OpenAI SDKs and any OpenAI-compatible client (LangChain, LlamaIndex, Continue, Hermes, etc.). Just change `base_url`.
- **Responses API (Codex)** — `POST /v1/responses` with streaming SSE (`response.output_text.delta`, tool-call events) for [OpenAI Codex](https://developers.openai.com/codex) custom providers using the Responses wire protocol.
- **Anthropic-compatible** — `POST /v1/messages` and `POST /v1/messages/count_tokens` translate to the same router and providers, so the [Claude Code CLI](https://code.claude.com/docs/en/llm-gateway) (`claude` in a terminal) can point at your local proxy via `ANTHROPIC_BASE_URL`. The Claude Desktop Code tab cannot override that URL when using a Pro/Max subscription.
- **Streaming and non-streaming** — Server-Sent Events for `stream: true`, JSON response otherwise. Every provider adapter implements both.
- **Tool calling** — OpenAI-style `tools` / `tool_choice` requests are passed through, and assistant `tool_calls` + `tool` role follow-up messages round-trip across providers.
- **Vision (Codex & chat)** — Pasted images in Codex (`input_image` on `/v1/responses`) and multimodal user messages on `/v1/chat/completions` are routed to vision-capable models (Gemini, Llama 4, etc.); text-only backends are skipped when images are present.
- **Automatic fallover** — If the chosen provider returns a 429, 5xx, or times out, the router skips it, puts the key on a short cooldown, and retries on the next model in your fallback chain (up to 20 attempts).
- **Per-key rate tracking** — RPM, RPD, TPM, and TPD counters per `(platform, model, key)` so the router always picks a key that's under its caps.
- **Sticky sessions** — Multi-turn conversations keep talking to the same model for 30 minutes to avoid the hallucination spike that comes from mid-conversation model switches.
- **Encrypted key storage** — API keys are encrypted with AES-256-GCM before hitting SQLite; decryption happens in-memory just before a request.
- **Unified API key** — Clients authenticate to your proxy with a single `freellmapi-…` bearer token. You never expose upstream provider keys to your apps.
- **Health checks** — Periodic probes mark keys as `healthy`, `rate_limited`, `invalid`, or `error` so the router skips dead ones automatically.
- **Admin dashboard** — React + Vite UI to manage keys, reorder the fallback chain, inspect analytics, and run prompts in a playground. Dark mode included.
- **Analytics** — Per-request logging with latency, token counts, success rate, per-provider breakdowns, a **usage log** (timestamped successful routes), and a persistent **error log** for failures.
- **Deploys to a Raspberry Pi** — Runs happily on a Pi 4 under PM2 behind nginx. ~40 MB RSS at idle.

## Not yet supported

The scope is deliberately narrow. If a feature isn't on this list and isn't below, assume it isn't there yet.

- **Embeddings** (`/v1/embeddings`)
- **Image generation** (`/v1/images/*`)
- **Audio / speech** (`/v1/audio/*`)
- **Legacy completions** (`/v1/completions`) — only the chat endpoint is implemented
- **Moderation** (`/v1/moderations`)
- **`n > 1`** (multiple completions per request)
- **Per-user billing / multi-tenant auth** — single-user by design

PRs that add any of these are very welcome. See [Contributing](#contributing).

## Quick start

**Prerequisites:** Node.js 20+, npm.

```bash
git clone https://github.com/tashfeenahmed/freellmapi.git
cd freellmapi
npm install

# Generate an encryption key for at-rest key storage
cp .env.example .env
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env

# Start server + dashboard together
npm run dev
```

Open http://localhost:5173 (the Vite dev UI), add your provider keys on the **Keys** page, reorder the **Fallback Chain** to taste, and grab your unified API key from the **Keys** page header. That unified key is what you point your OpenAI SDK at.

**Hugging Face & Together AI**

| Provider | Where to get a key | Notes |
| --- | --- | --- |
| Hugging Face | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | Create a token with **Inference Providers** permission (`hf_…`). Routed via `https://router.huggingface.co/v1`. |
| Together AI | [api.together.ai/settings/api-keys](https://api.together.ai/settings/api-keys) | Prepaid credits (often a $5 minimum top-up). OpenAI-compatible serverless models. |

For a production build:

```bash
npm run build
node server/dist/index.js     # server + dashboard both served on :3001
```

## Using the API

Any OpenAI-compatible client works. Examples:

**Python**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="freellmapi-your-unified-key",
)

resp = client.chat.completions.create(
    model="auto",  # let the router pick; or specify e.g. "gemini-2.5-flash"
    messages=[{"role": "user", "content": "Summarise the fall of Rome in one sentence."}],
)
print(resp.choices[0].message.content)
print("Routed via:", resp.headers.get("x-routed-via"))
```

**curl**

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-your-unified-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "hi"}]
  }'
```

**Streaming**

```python
stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Stream me a haiku about SQLite."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

**Tool calling**

Pass OpenAI-style `tools` and `tool_choice`; the assistant response round-trips back through the proxy exactly like the OpenAI API. Multi-step flows (assistant `tool_calls` → `tool` role follow-up → final answer) work across every provider the router can reach.

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

# 1. Model asks for a tool call
first = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "What's the weather in Karachi?"}],
    tools=tools,
    tool_choice="required",
)
call = first.choices[0].message.tool_calls[0]

# 2. You execute the tool, feed the result back
final = client.chat.completions.create(
    model="auto",
    messages=[
        {"role": "user", "content": "What's the weather in Karachi?"},
        first.choices[0].message,
        {"role": "tool", "tool_call_id": call.id, "content": '{"temp_c": 32, "cond": "sunny"}'},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

Works with `stream=True` as well — you'll get `delta.tool_calls` chunks followed by a `finish_reason: "tool_calls"` close. Under the hood, OpenAI-compatible providers (Groq, Cerebras, SambaNova, Mistral, OpenRouter, GitHub Models, Hugging Face, Together AI, Cloudflare, Cohere compat) get the request passed through; Gemini requests get translated into Google's `functionDeclarations` / `functionResponse` shape and the response is translated back.

Every response carries an `X-Routed-Via: <platform>/<model>` header so you can see which provider actually served each call. If a request fell over between providers, you'll also see `X-Fallback-Attempts: N`.

**Claude Code CLI (Anthropic-shaped API — no Anthropic account key)**

FreeLLMAPI exposes `POST /v1/messages` in the same wire format Claude Code expects. Traffic goes to **your** server, is translated internally, and is served by your configured free-tier provider keys (Groq, Gemini, etc.). You do **not** put a real Claude/Anthropic API key into this app.

**Supported:** the `claude` command in a terminal (PowerShell, Windows Terminal, macOS/Linux shell).

**Not supported:** the Claude **Desktop** app → **Code** tab. With Pro/Max, Desktop manages `ANTHROPIC_BASE_URL` (“cannot be overridden” in the Local environment editor) and keeps routing to `api.anthropic.com`. Use the CLI or Cursor for FreeLLMAPI.

1. Start FreeLLMAPI and add your **provider** keys on the Keys page (Groq, Google, Hugging Face, Together AI, …).
2. Copy the **unified** key from the dashboard (`freellmapi-…`) — that is the only key the CLI needs.
3. Point **Claude Code CLI** at your proxy:

```bash
# Requests go to FreeLLMAPI, NOT api.anthropic.com
export ANTHROPIC_BASE_URL="http://localhost:3001"

# Claude Code's env name is ANTHROPIC_API_KEY, but the VALUE is your freellmapi-… key
export ANTHROPIC_API_KEY="freellmapi-your-unified-key-from-dashboard"

cd /path/to/your/project
claude
```

On Windows PowerShell:

```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:3001"
$env:ANTHROPIC_API_KEY = "freellmapi-your-unified-key-from-dashboard"
cd C:\path\to\your\project
claude
```

Alternatively, persist env in `%USERPROFILE%\.claude\settings.json` (CLI reads this; Desktop still overrides `ANTHROPIC_BASE_URL` when signed in):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3001",
    "ANTHROPIC_API_KEY": "freellmapi-your-unified-key-from-dashboard"
  }
}
```

4. **Auth conflict:** If the CLI warns that both a **claude.ai token** and `ANTHROPIC_API_KEY` are set, run `/logout` inside `claude`, exit, set only the env vars above (or `settings.json`), and start `claude` again. Do not sign in with Anthropic Pro when testing the proxy.

5. **Verify:** Send a short message (e.g. `Reply with exactly: FREELLMAPI-OK`). Open **Analytics → Usage log** — you should see a new row with provider `google`, `groq`, `cerebras`, etc. (not Anthropic). The CLI header may still show marketing labels like “Opus” or “API Usage Billing”; the usage log is the source of truth.

Claude model names in requests (e.g. `claude-sonnet-4-20250514`) are labels for Claude Code — the proxy **auto-routes** them through your fallback chain to real free models. The OpenAI endpoint (`/v1/chat/completions`) is unchanged and uses the same `freellmapi-…` key with `base_url=http://localhost:3001/v1`.

**OpenAI Codex (Responses API)**

[Codex](https://developers.openai.com/codex) (CLI + Desktop) talks to custom providers through the **Responses** wire protocol (`POST /v1/responses`), not Chat Completions. A stock FreeLLMAPI install only had `/v1/chat/completions`, which produced errors like `404 Cannot POST /v1/responses`. This repo adds a Responses compatibility layer so Codex can use the same router, keys, and fallback chain as every other client.

**What was added in FreeLLMAPI (server)**

| Piece | Role |
| --- | --- |
| `POST /v1/responses` | Accepts Codex Requests/Responses JSON; maps to internal chat completion |
| `server/src/lib/responses-compat.ts` | Request/response translation (stream + non-stream, tool events) |
| `server/src/routes/responses-proxy.ts` | Route handler; `allowUnknownModel` so Codex model labels can auto-route |
| `server/src/lib/proxy-auth.ts` | Shared auth; **localhost** requests skip bearer check (handy for local Codex) |
| `AUTO_MODEL_ALIASES` | Treats `auto`, `freellmapi-auto`, etc. like the dashboard fallback chain |
| `scripts/generate-codex-model-catalog.mjs` | Builds a Codex-shaped `model_catalog_json` from `GET /v1/models` |

Mount order in `server/src/app.ts`: Anthropic routes → **Responses** → OpenAI Chat proxy (so `/v1/responses` is not swallowed by the chat handler).

**1. Start FreeLLMAPI**

```bash
npm run dev
```

Confirm the API is up: `http://localhost:3001/v1/models` should return **200**. Add provider keys on the **Keys** page and set your **fallback chain** (Analytics will show which models actually succeed — tune the chain if one provider is at 0% success).

**2. Copy your unified key**

From the dashboard header: `freellmapi-…` (same key as for curl / OpenAI SDK).

**3. Codex `config.toml` (working template)**

Edit `%USERPROFILE%\.codex\config.toml` (Codex → Settings → Open config.toml). Example that matches a verified Windows + local FreeLLMAPI setup:

```toml
personality = "pragmatic"
model = "auto"
model_reasoning_effort = "medium"
model_provider = "freellmapi"
approval_policy = "never"
sandbox_mode = "danger-full-access"

# Optional: all enabled models in the CLI picker (regenerate after catalog changes)
# model_catalog_json = "C:\\Users\\<you>\\.codex\\freellmapi-models.json"

[model_providers.freellmapi]
name = "FreeLLMAPI (local)"
base_url = "http://localhost:3001/v1"
env_key = "CUSTOM_API_KEY"
wire_api = "responses"

[windows]
sandbox = "unelevated"

[sandbox_workspace_write]
network_access = true

[projects.'C:\\Users\\<you>\\Workspace\\freellmapi']
trust_level = "trusted"
```

**4. API key env var**

```powershell
$env:CUSTOM_API_KEY = "freellmapi-your-unified-key-from-dashboard"
```

Persist it in your user environment or shell profile if you do not want to set it every session.

**5. Restart Codex** after any `config.toml` change (values are read at startup).

**Windows: “Couldn't set up admin sandbox”**

On Windows, Codex tries to create an elevated “admin sandbox” (firewall rules + sandbox users). Older Codex builds often fail with `helper_firewall_rule_create_or_add_failed` / `SetRemoteAddresses` HRESULT `0x80070057` ([openai/codex#17053](https://github.com/openai/codex/issues/17053)). That blocks the Desktop UI even when FreeLLMAPI is fine.

What we did to get Codex working locally:

| Step | Why |
| --- | --- |
| `sandbox_mode = "danger-full-access"` in `config.toml` | Runs tools on the host without the broken admin sandbox (trusted local dev only) |
| `[windows] sandbox = "unelevated"` | Avoids insisting on elevated sandbox setup |
| `[sandbox_workspace_write] network_access = true` | Lets sandboxed/tooling paths reach `localhost:3001` |
| Delete stale `%USERPROFILE%\.codex\.sandbox\setup_marker.json` and `setup_error.json` | Forces a clean retry instead of reusing a failed setup from weeks ago |
| Click **Use backup sandbox** in the Codex UI if the red banner still appears | Official fallback when admin sandbox setup fails |
| Fully quit and reopen Codex after editing `config.toml` | Desktop does not always hot-reload config |

Optional CLI check (close stdin so Codex does not hang waiting for terminal input):

```powershell
cmd /c "cd /d C:\Users\Nestor\Workspace\freellmapi && C:\Users\Nestor\AppData\Local\OpenAI\Codex\bin\codex.exe exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -c model_provider=freellmapi \"Reply with exactly: CODEX_OK\" < NUL"
```

You should see `provider: freellmapi` and a successful reply. If `codex update` is unavailable (Microsoft Store install), stay on `danger-full-access` until a newer Codex build ships with the firewall fix.

**Auto-routing vs the model picker**

| What you set in Codex | What FreeLLMAPI does |
| --- | --- |
| `model = "auto"` (recommended) | Uses your **fallback chain** on the first turn; sticky session keeps the same backend for follow-ups. No need to change the picker mid-session. |
| A Codex label not in the catalog (e.g. `gpt-5.4`, `gpt-5.3-codex`) | Same as auto — name is ignored; router picks from the chain (`allowUnknownModel`). |
| A real id from the catalog (e.g. `gemini-2.5-flash`) | **Pins** that model (and sticky follow-ups). Use when you want one provider on purpose. |

The dashboard **fallback order** is what “auto” means. Check **Analytics → Per-model breakdown** if routing often hits models with low success rate.

**Model catalog for the picker (optional)**

Codex does not always call `GET /v1/models` for custom providers. Generate a local catalog from your running server:

```powershell
npm run codex:model-catalog
```

Writes `%USERPROFILE%\.codex\freellmapi-models.json` (all enabled models plus **Auto**). Uncomment or add in `config.toml`:

```toml
model_catalog_json = "C:\\Users\\<you>\\.codex\\freellmapi-models.json"
```

Regenerate after you add keys or change the catalog. The generator must emit Codex `ModelInfo` fields (`display_name`, `supported_reasoning_levels`, etc.) — see `scripts/generate-codex-model-catalog.mjs`. A hand-edited catalog with wrong field names (`displayName`, `visibility: "visible"`, …) makes Codex fail at startup with `failed to parse model_catalog_json`.

The **Codex Desktop** picker may still hide custom-provider entries ([openai/codex#15138](https://github.com/openai/codex/issues/15138)); the CLI and `model = "auto"` in TOML work regardless.

**Identity / cutoff answers**

Codex may still describe itself as the OpenAI Codex product (e.g. “knowledge cutoff October 2024”) because that is Codex’s own system prompt — not text returned by FreeLLMAPI. Inference still goes through your configured free-tier models; check `X-Routed-Via` on HTTP responses or the dashboard Analytics for the actual backend.

Chat Completions (`/v1/chat/completions`) and Claude Code (`/v1/messages`) are unchanged for other tools.

## Screenshots

### Keys

Manage provider credentials and grab the unified API key your apps connect with. Each key shows a status dot and when it was last health-checked.

![Keys page](repo-assets/keys.png)

### Playground

Send a chat completion through the router and see which provider served it, with the model ID and latency printed right on the message.

![Playground page](repo-assets/playground.png)

### Analytics

Request volume, success rate, tokens in and out, average latency, and per-provider breakdowns over 24h / 7d / 30d windows.

- **Usage log** — Scrollable table of each **successful** routed request (newest first): local timestamp, provider, model, vision flag, input/output tokens, and latency. Use it to confirm Claude Code CLI, Codex, or other clients are hitting the proxy and which backend served the call. Cleared when you **Reset analytics**.
- **Error log (debug)** — Detailed failure rows (endpoint, retry, vision flags, full message) plus `server/data/error.log`. Kept when you reset analytics so you can still debug.

API: `GET /api/analytics/usage-log?range=7d&limit=100` (same `range` as other analytics endpoints: `24h`, `7d`, `30d`).

![Analytics page](repo-assets/analytics.png)

## How it works

```
┌──────────────────┐   Bearer freellmapi-…   ┌─────────────────────────┐
│  OpenAI SDK /    │ ──────────────────────▶ │  Express proxy (:3001)  │
│  curl / any      │ ◀────────────────────── │  /v1/chat/completions   │
│  OpenAI client   │      streamed tokens    └────────────┬────────────┘
└──────────────────┘                                      │
                                                          ▼
                             ┌────────────────────────────────────────────────┐
                             │  Router                                        │
                             │   1. Pick highest-priority model that          │
                             │      (a) has a healthy key and                 │
                             │      (b) is under all its rate limits.         │
                             │   2. Decrypt key, call provider SDK.           │
                             │   3. On 429/5xx → cooldown + retry next model. │
                             └────────────────────────────────────────────────┘
                                          │
   ┌──────────────┬────────────┬──────────┴─────────┬─────────────┬──────────┐
   ▼              ▼            ▼                    ▼             ▼          ▼
 Google         Groq        Cerebras           OpenRouter   Hugging Face  Together AI  …more
```

- **Router** (`server/src/services/router.ts`) — picks a model per request.
- **Rate-limit ledger** (`server/src/services/ratelimit.ts`) — in-memory RPM/RPD/TPM/TPD counters backed by SQLite, with cooldowns on 429s.
- **Provider adapters** (`server/src/providers/*.ts`) — one file per provider, implementing the `Provider` base class: `chatCompletion()` and `streamChatCompletion()`.
- **Health service** (`server/src/services/health.ts`) — periodic probe keeps key status fresh.
- **Dashboard** (`client/`) — React + Vite + shadcn/ui admin surface.
- **Storage** — SQLite (`better-sqlite3`) with AES-256-GCM envelope encryption for keys.

## Limitations

Stacking free tiers has real trade-offs. Be honest with yourself about them:

- **No frontier models.** The free-tier catalog tops out around Llama 3.3 70B, GLM-4.5, Qwen 3 Coder, and Gemini 2.5 Pro. You will not get GPT-5 or Claude Opus class reasoning through this. For hard problems, pay for a real API.
- **Intelligence degrades as the day progresses.** Your top-ranked models (usually Gemini 2.5 Pro, GPT-4o via GitHub Models) have the lowest daily caps. Once they hit their limits, the router falls down your priority chain to smaller/weaker models. Expect the effective intelligence of the endpoint to drop in the late hours of each day — then reset at UTC midnight.
- **Latency is highly variable.** Cerebras and Groq are extremely fast; others are not. You get whichever one is available.
- **Free tiers can change without notice.** Providers regularly tighten, loosen, or remove free tiers. When that happens you'll see 429s or auth errors until you update the catalog. Re-seed scripts live in `server/src/scripts/`.
- **Credit-based providers.** Hugging Face Inference Providers and Together AI use small prepaid credit pools (not unlimited monthly free RPM like Groq). Budget rows in the dashboard reflect that.
- **No SLA, by definition.** If you need reliability, use a paid provider with a contract.
- **Local-first.** There's no multi-tenant auth. Run this for yourself; don't expose it to the internet.

## Contributing

Contributors very welcome! Good first PRs:

- **Add a provider** — copy `server/src/providers/openai-compat.ts` as a template, wire it into `server/src/providers/index.ts`, seed its models in `server/src/db/index.ts`, add a test in `server/src/__tests__/providers/`.
- **Add an endpoint** — embeddings, images, moderations. The provider base class can grow new methods; adapters declare which they support.
- **Improve the router** — cost-aware routing (cheapest-healthy-fastest tradeoffs), better latency-weighted priority, regional pinning.
- **Dashboard polish** — charts on the Analytics page, key rotation UX, batch import of keys from `.env`.
- **Docs** — more examples, client library snippets for Go/Rust/etc., a deployment recipe for Docker or Fly.

**Development loop:**

```bash
npm install
npm run dev      # server on :3001, dashboard on :5173, both with HMR
npm test         # vitest — 75 tests across providers, routes, router, ratelimit
```

PRs should include a test, keep the existing test suite green, and match the `.editorconfig` / tsconfig defaults already in the repo. Issues and discussions are open.

### Contributors

Thanks to everyone who's helped improve FreeLLMAPI:

- [@moaaz12-web](https://github.com/moaaz12-web) — tool-calling support across providers (#3)
- [@lukasulc](https://github.com/lukasulc) — better-sqlite3 bump to fix npm install on Node 24+ (#12)
- [@VinhPhamAI](https://github.com/VinhPhamAI) — root `.env` PORT now propagates to server + Vite dev proxy + UI base URL (#27)
- [@deadc](https://github.com/deadc) — preserve Gemini `thoughtSignature` so multi-turn function calling stops 400-ing (#32); router model-first key-exhaustion tests + per-model `limits` hoist (#42)
- [@zhangyu1324](https://github.com/zhangyu1324) — requested Ollama Cloud integration, now V10 catalog (#14 / #41)
- [@jtbrennan-git](https://github.com/jtbrennan-git) — security review (#35) and Phase 1 hardening: parameterized analytics queries, sort-preset whitelist, timing-safe API key compare, mid-stream error sanitization
- [@praveenkumarpranjal](https://github.com/praveenkumarpranjal) — guard Gemini SSE `JSON.parse` so a malformed frame no longer aborts the whole stream, plus first streaming tests for the Google provider (#47)

## Terms of Service review

A self-hosted, single-user, personal-use setup was re-reviewed against each provider's ToS (May 2026). Summary:

| Provider | Verdict | Notes |
|---|---|---|
| Google Gemini | ⚠️ Caution | March 2026 ToS narrows scope to *"professional or business purposes, not for consumer use"* — a self-hosted developer proxy is still defensible, but the clause is new. |
| Groq | ✅ Likely OK | GroqCloud Services Agreement permits Customer Application integration. |
| Cerebras | ✅ Likely OK | Permitted; explicitly forbids selling/transferring API keys. |
| Mistral | ✅ Likely OK | APIs allowed for personal/internal business use. |
| OpenRouter | ✅ Likely OK | April 2026 ToS sharpens the no-resale / no-competing-service clause; private single-user proxy still fine. |
| SambaNova | ⚠️ Ambiguous | EULA §1.5(c) blocks resale and "service bureau" use; single-user with no third-party access is fine. |
| Cloudflare Workers AI | ⚠️ Ambiguous | No anti-proxy clause; covered by general Self-Serve Subscription Agreement. |
| NVIDIA NIM | ⚠️ Caution | Trial ToS §1.2 / §1.4: *"evaluation only, not production."* Disabled in default catalog. |
| GitHub Models | ⚠️ Caution | Free tier explicitly scoped to *"experimentation"* and *"prototyping."* |
| Cohere | ❌ Avoid | Terms §14 still forbids *"personal, family or household purposes."* |
| Zhipu (open.bigmodel.cn) | ✅ Likely OK | Personal/non-commercial research carve-out still in the platform docs. |
| Z.ai (api.z.ai) | ⚠️ Caution | New row — Singapore entity (distinct from Zhipu CN). §III.3(l) anti-traffic-redirect clause could plausibly be read against a proxy; no explicit personal-use carve-out. |
| Ollama Cloud | ✅ Likely OK | Free plan permits cloud-model access (1 concurrent, 5-hour session caps). No anti-proxy / anti-resale clauses found. |
| Hugging Face | ⚠️ Caution | Inference Providers credits (~$0.10/mo free tier); routed via `router.huggingface.co` OpenAI API. Legacy Fireworks-route model removed in V4 (broken tool calls). |
| Together AI | ⚠️ Caution | Prepaid credits only ($5 minimum purchase since July 2025); signup promos may apply. Serverless API permits customer-application integration. |

Rules of thumb that keep most providers happy: **one account per provider**, **no reselling**, **no sharing your endpoint with other humans**, **don't hammer a free tier as a paid production backend**. This is informational, not legal advice — read each provider's ToS and make your own call.

Removed from the catalog (April 2026 review): Moonshot and MiniMax direct integrations (Moonshot — paid-only; MiniMax — use OpenRouter `minimax/minimax-m2.5:free`). Hugging Face was re-added in V13 via the Inference Providers router with new model ids (the old Fireworks-route Llama row failed structured tool calls).

## Disclaimer

**This project is for personal experimentation and learning, not production.** Free tiers exist so developers can prototype against them; they aren't a stable, supported inference substrate and shouldn't be treated as one. If you build something real on top of FreeLLMAPI, swap in a paid API before you ship. Your relationship with each upstream provider is governed by the terms you accepted when you created your account — those terms still apply when the traffic is proxied through this project, and you're responsible for complying with them.

## License

[MIT](./LICENSE)
