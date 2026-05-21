/**
 * Gemini function_declarations.parameters use a restricted JSON Schema subset.
 * OpenAI/Codex tool schemas often include keys (e.g. additionalProperties, strict)
 * that the API rejects with 400 "Unknown name".
 */

/** JSON Schema keys OpenAI/Codex emit that Gemini function_declarations reject. */
const STRIP_KEYS = new Set([
  'additionalProperties',
  'strict',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'patternProperties',
  'unevaluatedProperties',
  'additionalItems',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'const',
  'default',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minContains',
  'maxContains',
  'contentMediaType',
  'contentEncoding',
]);

function sanitizeNode(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return { type: 'object', properties: {} };
  }

  const input = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (STRIP_KEYS.has(key)) continue;

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        props[propName] = sanitizeNode(propSchema);
      }
      out.properties = props;
      continue;
    }

    if (key === 'items') {
      out.items = Array.isArray(value)
        ? value.map((item) => sanitizeNode(item))
        : sanitizeNode(value);
      continue;
    }

    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf' || key === 'prefixItems') {
      out[key] = Array.isArray(value) ? value.map((item) => sanitizeNode(item)) : value;
      continue;
    }

    if ((key === 'not' || key === 'if' || key === 'then' || key === 'else') && value && typeof value === 'object') {
      out[key] = Array.isArray(value) ? value.map((item) => sanitizeNode(item)) : sanitizeNode(value);
      continue;
    }

    out[key] = value;
  }

  if (out.type === 'object' && out.properties === undefined) {
    out.properties = {};
  }

  return out;
}

/** Gemini 400s that repeat on every model when the same tool payload is retried. */
export function isGeminiToolSchemaError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('function calling config is set without function_declarations')
    || (
      (m.includes('invalid json payload') || m.includes('unknown name'))
      && m.includes('function_declarations')
    )
  );
}

/** Prepare tool parameter JSON Schema for Gemini functionDeclarations. */
export function sanitizeGeminiParametersSchema(
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { type: 'object', properties: {} };
  }
  return sanitizeNode(parameters);
}
