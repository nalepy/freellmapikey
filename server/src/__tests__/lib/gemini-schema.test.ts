import { describe, expect, it } from 'vitest';
import { isGeminiToolSchemaError, sanitizeGeminiParametersSchema } from '../../lib/gemini-schema.js';

describe('sanitizeGeminiParametersSchema', () => {
  it('removes additionalProperties and strict at root and nested properties', () => {
    const result = sanitizeGeminiParametersSchema({
      type: 'object',
      additionalProperties: false,
      strict: true,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
          additionalProperties: false,
        },
        filters: {
          type: 'object',
          additionalProperties: true,
          properties: {
            limit: { type: 'integer' },
          },
        },
      },
      required: ['query'],
    });

    expect(result).not.toHaveProperty('additionalProperties');
    expect(result).not.toHaveProperty('strict');
    expect(result.properties).toEqual({
      query: {
        type: 'string',
        description: 'Search query',
      },
      filters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
        },
      },
    });
    expect(result.required).toEqual(['query']);
  });

  it('returns empty object schema when parameters are missing', () => {
    expect(sanitizeGeminiParametersSchema(undefined)).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('sanitizes anyOf branches', () => {
    const result = sanitizeGeminiParametersSchema({
      anyOf: [
        { type: 'string', additionalProperties: false },
        { type: 'number', strict: true },
      ],
    });

    expect(result.anyOf).toEqual([
      { type: 'string' },
      { type: 'number' },
    ]);
  });

  it('removes exclusiveMinimum and exclusiveMaximum in nested properties', () => {
    const result = sanitizeGeminiParametersSchema({
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          exclusiveMinimum: 0,
          exclusiveMaximum: 100,
        },
      },
    });

    expect(result.properties).toEqual({
      count: { type: 'integer' },
    });
  });

  it('detects Gemini tool schema API errors', () => {
    expect(isGeminiToolSchemaError(
      'Google API error 400: Invalid JSON payload received. Unknown name "exclusiveMinimum" at \'tools[0].function_declarations[6].parameters.properties[2].value\'',
    )).toBe(true);
    expect(isGeminiToolSchemaError('Google API error 400: Function calling config is set without function_declarations.')).toBe(true);
    expect(isGeminiToolSchemaError('SambaNova API error 400: could not process')).toBe(false);
  });
});
