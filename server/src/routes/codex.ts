import { Router } from 'express';
import type { Request, Response } from 'express';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { getDb } from '../db/index.js';
import { buildCodexModelCatalog } from '../lib/codex-model-catalog.js';

export const codexRouter = Router();

const DEFAULT_CATALOG_PATH = join(homedir(), '.codex', 'freellmapikey-models.json');

function loadEnabledModels() {
  const db = getDb();
  return db.prepare(`
    SELECT model_id, display_name, context_window, requires_vision
    FROM models
    WHERE enabled = 1
    ORDER BY intelligence_rank
  `).all() as Array<{
    model_id: string;
    display_name: string;
    context_window: number | null;
    requires_vision: number;
  }>;
}

codexRouter.get('/model-catalog', (_req: Request, res: Response) => {
  const catalog = buildCodexModelCatalog(loadEnabledModels());
  res.json(catalog);
});

/** Write ~/.codex/freellmapikey-models.json for Codex Desktop model picker (local dashboard only). */
codexRouter.post('/sync-catalog', async (req: Request, res: Response) => {
  const outPath = typeof req.body?.path === 'string' && req.body.path.length > 0
    ? req.body.path
    : DEFAULT_CATALOG_PATH;

  const catalog = buildCodexModelCatalog(loadEnabledModels());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  res.json({
    path: outPath,
    modelCount: catalog.models.length,
    configSnippet: [
      'model = "auto"',
      'model_provider = "freellmapikey"',
      `model_catalog_json = "${outPath.replace(/\\/g, '\\\\')}"`,
    ].join('\n'),
  });
});
