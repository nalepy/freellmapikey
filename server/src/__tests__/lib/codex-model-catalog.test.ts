import { describe, expect, it } from 'vitest';
import { buildCodexModelCatalog, buildCodexModelEntry } from '../../lib/codex-model-catalog.js';

describe('buildCodexModelCatalog', () => {
  it('includes auto plus provider-tagged models with hidden false', () => {
    const catalog = buildCodexModelCatalog([
      {
        model_id: 'gemini-2.5-flash',
        display_name: 'Gemini 2.5 Flash',
        context_window: 1048576,
        requires_vision: 1,
      },
    ]);

    expect(catalog.models).toHaveLength(2);
    const auto = catalog.models[0] as Record<string, unknown>;
    const flash = catalog.models[1] as Record<string, unknown>;

    expect(auto.slug).toBe('auto');
    expect(flash.slug).toBe('gemini-2.5-flash');
    expect(flash.provider).toBe('freellmapi');
    expect(flash.hidden).toBe(false);
    expect(flash.displayName).toBe('Gemini 2.5 Flash');
    expect(flash.input_modalities).toEqual(['text', 'image']);
    expect(flash.context_window).toBe(1048576);
  });

  it('does not include additionalProperties-style fields (not applicable here)', () => {
    const entry = buildCodexModelEntry('test-model', 'Test', 1);
    expect(entry).not.toHaveProperty('additionalProperties');
  });
});
