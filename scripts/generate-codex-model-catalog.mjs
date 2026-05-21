#!/usr/bin/env node
/**
 * Build a Codex model_catalog.json from FreeLLMAPIKey's GET /v1/codex/model-catalog.
 * Usage: node scripts/generate-codex-model-catalog.mjs [--base-url http://localhost:3001] [--out ~/.codex/freellmapikey-models.json]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_BASE = 'http://localhost:3001';
const DEFAULT_OUT = join(homedir(), '.codex', 'freellmapikey-models.json');

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
  const res = await fetch(`${baseUrl}/v1/codex/model-catalog`);
  if (!res.ok) {
    console.error(`GET /v1/codex/model-catalog failed: ${res.status} ${res.statusText}`);
    console.error('Start FreeLLMAPIKey first (npm run dev) or pass --base-url.');
    process.exit(1);
  }

  const catalog = await res.json();
  const models = Array.isArray(catalog.models) ? catalog.models : [];

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${models.length} entries to ${outPath}`);
  console.log('');
  console.log('Add to %USERPROFILE%\\.codex\\config.toml (then restart Codex):');
  console.log('model = "auto"');
  console.log('model_provider = "freellmapikey"');
  console.log(`model_catalog_json = "${outPath.replace(/\\/g, '\\\\')}"`);
  console.log('');
  console.log('[model_providers.freellmapikey]');
  console.log('requires_openai_auth = false');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
