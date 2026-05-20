#!/usr/bin/env node
/**
 * Build a Codex model_catalog.json from FreeLLMAPI's GET /v1/models.
 * Usage: node scripts/generate-codex-model-catalog.mjs [--base-url http://localhost:3001] [--out ~/.codex/freellmapi-models.json]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_BASE = 'http://localhost:3001';
const DEFAULT_OUT = join(homedir(), '.codex', 'freellmapi-models.json');
const PROVIDER = 'freellmapi';

const REASONING_LEVELS = [
  { effort: 'low', description: 'Fast responses with lighter reasoning' },
  { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
  { effort: 'high', description: 'Greater reasoning depth for complex problems' },
];

/** Minimal Codex ModelInfo shape (see ~/.codex/models_cache.json). */
function modelEntry(slug, display_name, priority) {
  return {
    slug,
    display_name,
    description: slug === 'auto' ? 'FreeLLMAPI auto-routes via fallback chain' : `FreeLLMAPI model ${slug}`,
    default_reasoning_level: 'medium',
    supported_reasoning_levels: REASONING_LEVELS,
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority,
    additional_speed_tiers: [],
    service_tiers: [],
    supports_reasoning_summaries: false,
    default_reasoning_summary: 'none',
    support_verbosity: false,
    apply_patch_tool_type: 'freeform',
    web_search_tool_type: 'text_and_image',
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: 128000,
    max_context_window: 128000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    supports_search_tool: false,
    base_instructions: 'You are a helpful coding assistant routed through FreeLLMAPI.',
    truncation_policy: { mode: 'tokens', limit: 10000 },
  };
}

function parseArgs(argv) {
  let baseUrl = DEFAULT_BASE;
  let outPath = DEFAULT_OUT;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--base-url' && argv[i + 1]) {
      baseUrl = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      outPath = argv[++i].replace(/^~(?=$|[\\/])/, homedir());
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`Usage: node scripts/generate-codex-model-catalog.mjs [--base-url URL] [--out PATH]`);
      process.exit(0);
    }
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), outPath: resolve(outPath) };
}

async function main() {
  const { baseUrl, outPath } = parseArgs(process.argv);
  const res = await fetch(`${baseUrl}/v1/models`);
  if (!res.ok) {
    console.error(`GET /v1/models failed: ${res.status} ${res.statusText}`);
    console.error('Start FreeLLMAPI first (npm run dev) or pass --base-url.');
    process.exit(1);
  }

  const body = await res.json();
  const data = Array.isArray(body.data) ? body.data : [];

  const models = [
    modelEntry('auto', 'Auto (fallback chain)', 0),
    ...data.map((m, i) => modelEntry(m.id, m.name ?? m.id, i + 1)),
  ];

  const catalog = { models };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${models.length} entries (${data.length} from API + auto) to ${outPath}`);
  console.log('');
  console.log('Add to %USERPROFILE%\\.codex\\config.toml:');
  console.log(`model_catalog_json = "${outPath.replace(/\\/g, '\\\\')}"`);
  console.log('model = "auto"');
  console.log('model_provider = "freellmapi"');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
