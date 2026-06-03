# Session Checkpoint — 2026-06-03

## What was completed

### Task 1 — `POST /v1/embeddings` endpoint (fully shipped, tested, pushed)

**New files:**
- `server/src/routes/embeddings.ts` — route handler: zod validation, model routing, cooldown-aware key selection, provider fallback loop, request recording, error surfacing.
- `server/src/__tests__/routes/embeddings.test.ts` — 8 integration tests (validation, single/batch dispatch, auto-routing, Mistral fallback, 503 on no keys, multilingual model routing). All pass.

**Modified files:**
- `shared/types.ts` — added `EmbeddingsRequest`, `EmbeddingObject`, `EmbeddingsResponse` types.
- `server/src/providers/base.ts` — added `declare readonly supportsEmbeddings?: boolean` and optional `embeddings()` method.
- `server/src/providers/google.ts` — added `supportsEmbeddings = true` and `embeddings()` using Gemini `embedContent` (single) and `batchEmbedContents` (array) APIs.
- `server/src/providers/openai-compat.ts` — added `embeddingModels?` constructor option, `supportsEmbeddings` getter, and `embeddings()` calling `${baseUrl}/embeddings`.
- `server/src/providers/index.ts` — Mistral instance gets `embeddingModels: ['mistral-embed']`.
- `server/src/app.ts` — `embeddingsRouter` imported and registered under `/v1`.
- `server/src/db/index.ts` — added `migrateModelsV17Embeddings()` (called in `initDb`): inserts 3 embedding-only model rows (`text-embedding-004`, `text-multilingual-embedding-002`, `mistral-embed`) with `enabled=0` and creates their `fallback_config` entries.

**Bugs fixed during code review (all in same commit):**
- `google.ts`: `data.embedding?.values` null-checked before deref — Google can return 200 with a non-standard body shape.
- `embeddings.ts`: `lastError` tracked; 503 response now includes actual provider error message.
- `embeddings.ts`: `pickKey` iterates all keys and skips any on cooldown (`isOnCooldown`), returns `{key, keyId}` instead of bare string.
- `embeddings.ts`: 429 errors trigger `setCooldown(platform, modelId, keyId)` so the key is not immediately retried.
- `embeddings.ts`: every attempt (success and failure) writes a row to the `requests` table so analytics are not blind to embedding traffic.

---

### Task 2 — `npx freellmapikey` CLI (fully shipped, pushed)

**New files:**
- `bin/cli.mjs` — Node.js ESM CLI. Subcommands: `setup` (clone + install + build), `start`, `update` (pull + rebuild + start), `auto` (default: setup if needed, then start). Installs to `~/.freellmapikey`.

**Modified files:**
- `package.json` — `"private": false`, added `"bin"`, `"files"`, `"version": "1.0.0"`, `"description"`, `"keywords"`, `"homepage"`, `"repository"`, `"license"`, `"engines"`.

---

### README updates (same commit)
- **Features**: added embeddings bullet with model/dim/limit summary.
- **Not yet supported**: removed `Embeddings (/v1/embeddings)` bullet.
- **Quick start**: added Option A (`npx freellmapikey`) before the existing clone-and-run option.
- **Using the API**: added `### Embeddings` section with provider table and Python + curl examples.
- **Table of contents**: added `Embeddings` sub-entry under Using the API.
- **How it works**: updated provider adapters line to mention `embeddings()`.
- **Contributing**: updated "Add an endpoint" bullet (embeddings is done; images/audio/moderations are next).

---

### Git state
- Branch: `main`
- Last commit: `cd2b625` — `feat: add /v1/embeddings endpoint and npx freellmapikey CLI`
- Pushed to `origin/main` ✅
- 148 tests passing, 0 failures

---

## What is in progress

Nothing is mid-edit. All files are clean and committed.

The session ended with an unanswered question: the user asked to **"Run the custom endpoint + Docker prompt"** but the intent was unclear (no Dockerfile exists, no prompt file found). This was the last message before the checkpoint — needs clarification next session.

---

## What still needs to be done

### Pending clarification
- **Docker / custom endpoint prompt** — user asked for this at the very end; unclear whether they want:
  - A `Dockerfile` + `docker-compose.yml` for running the full stack in Docker
  - A specific prompt or task definition file they had in mind
  - Something else entirely

### Known missing (not started)
- **Docker support** — no `Dockerfile` exists. If wanted: multi-stage build (Node 20 builder → slim runner), expose `:3001`, mount `server/data` as a volume for the SQLite DB.
- **Image generation** — `POST /v1/images/*` not implemented.
- **Audio / speech** — `POST /v1/audio/*` not implemented.
- **Legacy completions** — `POST /v1/completions` not implemented.
- **Moderation** — `POST /v1/moderations` not implemented.
- **`n > 1`** (multiple completions per request) not implemented.

### Nice-to-have follow-ups from code review
- The `auto` and `else` (unknown model) branches in `embeddings.ts:53–64` are intentionally identical for readability — could be collapsed if the code grows.
- `pickKey` in `embeddings.ts` is simpler than `routeRequest` in `router.ts` (no RPM/TPM budget enforcement, no round-robin). If the embeddings endpoint starts getting high traffic, consider routing embedding keys through the full `routeRequest` machinery.

---

## Decisions made and gotchas

### `declare readonly supportsEmbeddings` in BaseProvider
TypeScript `target: ES2022` implies `useDefineForClassFields: true`. Without `declare`, the base class field initializes to `undefined` on every instance, shadowing `OpenAICompatProvider`'s getter. The `declare` keyword tells TypeScript the field exists for type-checking only — no JavaScript field initialization is emitted — so the getter is not shadowed. This is the correct pattern for ES2022 abstract/base class fields that subclasses override with getters.

### Embedding model rows use `enabled = 0`
The three embedding-only rows (`text-embedding-004`, `text-multilingual-embedding-002`, `mistral-embed`) are inserted with `enabled = 0` to prevent them from appearing in the chat fallback chain or `GET /v1/models`. The embeddings route addresses them directly by model ID.

### V17 migration must include the fallback-adding block
Every migration that inserts model rows must also include the "add missing `fallback_config` entries" pattern at the end of its transaction. Without it, a subsequent migration's fallback-adding code finds the orphaned rows on the second `initDb` call and adds them, making the migration non-idempotent. The idempotency test (`every catalog row has exactly one fallback_config entry`) would catch this.

### SIGINT on Windows — not a bug
`bin/cli.mjs` uses `process.on('SIGINT', () => child.kill('SIGINT'))`. On Windows, `child.kill('SIGINT')` calls `TerminateProcess` (POSIX signals don't exist). Because the server is spawned with `stdio: 'inherit'`, Ctrl+C is also broadcast by the OS to the child's console group directly. Either path terminates the child and fires `child.on('exit')`, which calls `process.exit`. No hang.

### Mistral embedding endpoint
Mistral's OpenAI-compat embeddings endpoint is `POST https://api.mistral.ai/v1/embeddings` — same base URL as chat, just `/embeddings` not `/chat/completions`. The `OpenAICompatProvider.embeddings()` method calls `${this.baseUrl}/embeddings`, which resolves correctly.

### Google single vs batch API
The Gemini embeddings API has two distinct endpoints:
- `POST /models/{model}:embedContent` — single text input
- `POST /models/{model}:batchEmbedContents` — array of inputs

The route dispatches based on `input.length === 1`. Both endpoints require `model: "models/{modelId}"` in the request body (the `models/` prefix is mandatory).
