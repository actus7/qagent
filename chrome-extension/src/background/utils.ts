import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { createLogger } from '@src/background/log';

const logger = createLogger('Utils');

export function getCurrentTimestampStr(): string {
  /**
   * Get the current timestamp as a string in the format yyyy/MM/dd HH:mm:ss
   * using local timezone.
   *
   * @returns Formatted datetime string in local time
   */
  return new Date()
    .toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(',', '');
}

/**
 * Fix malformed action string using the jsonrepair library
 * Only called when initial JSON.parse fails
 */
export function repairJsonString(actionString: string): string {
  try {
    // Use jsonrepair to fix malformed JSON
    const repairedJson = jsonrepair(actionString.trim());
    logger.info('Successfully repaired JSON string', { original: actionString, repaired: repairedJson });
    return repairedJson;
  } catch (error) {
    // If jsonrepair fails, log the error and return the original string
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warning('jsonrepair failed to fix JSON string', { original: actionString, error: errorMessage });
    return actionString.trim();
  }
}

// Helper function to capitalize first letter and convert to proper title case
function capitalizeFirstLetter(str: string): string {
  // Handle snake_case: convert to Title Case
  if (str.includes('_')) {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Handle camelCase: add spaces before capital letters and capitalize
  const withSpaces = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

// Post-process callback to add titles to properties
function addTitlesToProperties(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return jsonSchema;
  }

  // If this object has properties, add titles to them
  if (jsonSchema.properties && typeof jsonSchema.properties === 'object') {
    for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties)) {
      if (propertySchema && typeof propertySchema === 'object') {
        const schema = propertySchema as Record<string, unknown>;
        // Only add title if it doesn't already exist
        if (!schema.title) {
          schema.title = capitalizeFirstLetter(propertyName);
        }
        // Recursively process nested properties
        addTitlesToProperties(schema);
      }
    }
  }

  // Handle array items
  if (jsonSchema.items) {
    addTitlesToProperties(jsonSchema.items as Record<string, unknown>);
  }

  // Handle oneOf, anyOf, allOf
  if (Array.isArray(jsonSchema.oneOf)) {
    for (const schema of jsonSchema.oneOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }
  if (Array.isArray(jsonSchema.anyOf)) {
    for (const schema of jsonSchema.anyOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }
  if (Array.isArray(jsonSchema.allOf)) {
    for (const schema of jsonSchema.allOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }

  return jsonSchema;
}

export function convertZodToJsonSchema(zodSchema: z.ZodType, name: string, addTitle = false): Record<string, unknown> {
  // `io: 'input'` keeps fields with defaults optional, as the model may omit them; reused sub-schemas are inlined.
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(zodSchema, {
    target: 'openapi-3.0',
    io: 'input',
    // .int() emits ±MAX_SAFE_INTEGER bounds; they say nothing to the model and cost tokens on every call.
    override: ({ jsonSchema: node }) => {
      if (node.minimum === Number.MIN_SAFE_INTEGER) delete node.minimum;
      if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
      // The openapi-3.0 target writes .positive() as {minimum: 0, exclusiveMinimum: true}. Tool parameters are plain
      // JSON Schema, where the bound must be numeric; strict providers (Xiaomi MiMo) reject the boolean with a 400.
      for (const [flag, bound] of [
        ['exclusiveMinimum', 'minimum'],
        ['exclusiveMaximum', 'maximum'],
      ] as const) {
        if (typeof node[flag] !== 'boolean') continue;
        if (node[flag] && typeof node[bound] === 'number') node[flag] = node[bound];
        else delete node[flag];
        if (typeof node[flag] === 'number') delete node[bound];
      }
    },
  });
  delete jsonSchema.$schema; // the dialect URI is noise for the model
  const named = { ...jsonSchema, title: name };
  // Titles of the properties of the schema will make some models follow the schema better, especially for Haiku
  return addTitle ? addTitlesToProperties(named) : named;
}
