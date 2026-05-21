/**
 * Build Codex model_catalog.json entries from FreeLLMAPI enabled models.
 * @see scripts/generate-codex-model-catalog.mjs
 */

export const CODEX_MODEL_PROVIDER_ID = 'freellmapi';

export interface CodexCatalogModelRow {
  model_id: string;
  display_name: string;
  context_window: number | null;
  requires_vision?: number;
}

const REASONING_LEVELS = [
  { effort: 'low', description: 'Fast responses with lighter reasoning' },
  { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
  { effort: 'high', description: 'Greater reasoning depth for complex problems' },
];

function defaultContextWindow(contextWindow: number | null | undefined): number {
  if (typeof contextWindow === 'number' && contextWindow > 0) return contextWindow;
  return 128000;
}

/** Minimal Codex ModelInfo shape (see ~/.codex/models_cache.json). */
export function buildCodexModelEntry(
  slug: string,
  displayName: string,
  priority: number,
  options?: { contextWindow?: number | null; requiresVision?: boolean },
): Record<string, unknown> {
  const ctx = defaultContextWindow(options?.contextWindow);
  const inputModalities = options?.requiresVision ? ['text', 'image'] : ['text'];

  return {
    slug,
    display_name: displayName,
    displayName,
    description: slug === 'auto'
      ? 'FreeLLMAPI auto-routes via fallback chain'
      : `FreeLLMAPI model ${slug}`,
    provider: CODEX_MODEL_PROVIDER_ID,
    hidden: false,
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
    context_window: ctx,
    max_context_window: ctx,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: inputModalities,
    supports_search_tool: false,
    base_instructions: 'You are a helpful coding assistant routed through FreeLLMAPI.',
    truncation_policy: { mode: 'tokens', limit: 10000 },
  };
}

export function buildCodexModelCatalog(rows: CodexCatalogModelRow[]): { models: Record<string, unknown>[] } {
  const models = [
    buildCodexModelEntry('auto', 'Auto (fallback chain)', 0),
    ...rows.map((m, i) =>
      buildCodexModelEntry(m.model_id, m.display_name, i + 1, {
        contextWindow: m.context_window,
        requiresVision: m.requires_vision === 1,
      }),
    ),
  ];
  return { models };
}
