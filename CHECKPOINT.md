# Session Checkpoint — 2026-06-03 (updated)

## What was completed

### Session 1 — Embeddings + CLI (commit cd2b625)
See the original CHECKPOINT.md content — fully shipped. Summary:
- `POST /v1/embeddings` routing through Google and Mistral, with cooldown
  awareness, request recording, and error surfacing.
- `npx freellmapikey` CLI (`bin/cli.mjs`) + `package.json` made publishable.
- 148 tests passing at end of session 1.

---

### Session 2 — Custom endpoint + Docker (commit 94456eb)

#### Feature 1 — Custom OpenAI-compatible endpoint

Users can point FreeLLMAPIKey at any local or self-hosted server (llama.cpp,
LM Studio, vLLM, local Ollama, etc.) by POSTing to `/api/keys/custom`.

**Files modified:**

| File | Change |
|------|--------|
| `shared/types.ts` | Added `'custom'` to `Platform` union |
| `server/src/providers/openai-compat.ts` | Added `keyless?: boolean` constructor option + `readonly keyless` field |
| `server/src/providers/index.ts` | Added placeholder `custom` registration; added `resolveProvider(platform, baseUrl?)` export |
| `server/src/routes/keys.ts` | Full rewrite: `POST /custom`, `PATCH /platform/:platform`, label editing in `PATCH /:id`, `baseUrl` in `GET /` response, optional `key` field for keyless providers |
| `server/src/db/index.ts` | Added `ensureApiKeysBaseUrlColumn()` + call in `initDb()` |
| `server/src/services/router.ts` | Added `base_url` to `KeyRow`; imports `resolveProvider`; uses it for `custom` platform keys in the routing loop |
| `server/src/__tests__/routes/keys.test.ts` | +6 tests: label patch, POST /custom happy path, validation errors, idempotency, platform toggle |

**How the routing works:**
1. `POST /api/keys/custom` stores the base URL in `api_keys.base_url` and
   inserts a model row (`platform='custom'`) into the fallback chain.
2. When the router selects a `custom` model, it calls
   `resolveProvider('custom', key.base_url)` to build a fresh
   `OpenAICompatProvider` with the stored base URL and a 120s timeout.
3. The registered placeholder provider (empty `baseUrl`) is never used for
   actual requests — it only exists so `getProvider/hasProvider` work.

---

#### Feature 2 — Docker support

**Files created:**

| File | What it does |
|------|-------------|
| `Dockerfile` | 3-stage build (deps → build → runtime). Stage 1 installs Python3/make/g++ to compile `better-sqlite3` native module. Stage 2 builds and prunes. Stage 3 is the slim runtime image: copies built artifacts, creates `/app/server/data`, runs as `node` user, exposes `:3001`. |
| `docker-compose.yml` | Single service `freellmapikey`. Binds to `127.0.0.1` by default (`HOST_BIND=0.0.0.0` to expose on LAN). Named volume `freellmapikey-data` for SQLite persistence. Healthcheck via `GET /api/ping`. |
| `.dockerignore` | Excludes `node_modules`, `dist`, `server/data`, `.env`, `*.db` files from build context. |

**To run with Docker:**
```bash
# Copy and fill in your encryption key
cp .env.example .env
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env

# Build and start
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

The server serves both the API (`:3001/v1/...`) and the React dashboard
(`http://localhost:3001`) from the same port.

**Multi-arch:** The Dockerfile supports `linux/amd64` and `linux/arm64`
(Raspberry Pi 4 / M-series Mac) because it compiles `better-sqlite3` from
source rather than relying on prebuilt binaries. To build multi-arch:
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/nalepy/freellmapikey:latest --push .
```

---

## What is in progress

Nothing is mid-edit. All files are committed and pushed (commit `94456eb`).

---

## What still needs to be done

### Known missing (not started, not requested)
- **Image generation** — `POST /v1/images/*` not implemented.
- **Audio / speech** — `POST /v1/audio/*` not implemented.
- **Legacy completions** — `POST /v1/completions` not implemented.
- **Moderation** — `POST /v1/moderations` not implemented.
- **Dashboard UI for custom endpoint** — The `POST /api/keys/custom` API is
  complete, but the React dashboard has no form for it yet. Users must call
  the API directly or use curl/Postman. The upstream's dashboard had a custom
  provider form — that UI was NOT ported (would require client-side changes).
- **CI/CD pipeline** — No GitHub Actions workflow for building and pushing
  the Docker image to ghcr.io/nalepy/freellmapikey. The Dockerfile is ready
  but the push workflow isn't wired up.
- **`npx freellmapikey` — not yet published to npm**. The `package.json` is
  configured (`private: false`, `bin`, `files`, `version: 1.0.0`) but
  `npm publish` has not been run. Needs an npm account + `npm login`.

### Deferred from earlier sessions
- Docker / custom endpoint prompt clarification (now completed).

---

## Decisions made and gotchas

### One shared `custom` api_keys row, not one per model
The upstream design stores a single `custom` key row that holds the base URL.
When the user re-submits `/custom` with a different `baseUrl`, the row is
updated (not duplicated). Multiple models can be registered to the same
endpoint. If the user wants two different local endpoints simultaneously
(e.g., llama.cpp on :11434 and vLLM on :8000), only the last one wins —
this is a limitation of the single-row design inherited from upstream.

### `resolveProvider` vs `getProvider` for custom
`getProvider('custom')` returns the placeholder with an empty `baseUrl` that
would always fail routing. `resolveProvider('custom', baseUrl)` builds a
fresh `OpenAICompatProvider` bound to the actual stored URL. The router was
updated to use `resolveProvider` only for the `custom` platform case; all
other platforms still use the cached singleton via `getProvider`.

### `base_url` column is nullable
`ALTER TABLE api_keys ADD COLUMN base_url TEXT` defaults to NULL for all
existing rows. Only `custom` platform rows ever have a non-null value.
`ensureApiKeysBaseUrlColumn` is idempotent — safe to re-run.

### Dockerfile compiles better-sqlite3 from source on arm64
The `node:20-bookworm-slim` base image has no prebuilt `better-sqlite3`
binary for arm64 under QEMU. The `deps` stage installs `python3 make g++`
so node-gyp can compile it. Those tools are NOT in the final `runtime` stage
(which copies already-compiled `node_modules` from `build`), keeping the
runtime image small.

### `.dockerignore` excludes `server/data`
The `server/data` directory (SQLite DB) is excluded from the build context
and managed as a named Docker volume (`freellmapikey-data`). This means
each `docker compose up --build` starts with a fresh DB unless the volume
already exists.

### Tests: 154 passing (was 148 after session 1, +6 new custom endpoint tests)
All 24 test files pass. The new tests cover: label editing via PATCH, custom
endpoint registration, validation, idempotent re-submission, and platform
bulk-toggle.
