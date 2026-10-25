import type { PluginParam, PluginParamType, PluginTool } from './browserPlugins';

export const PLUGIN_LIMITS = {
  id: 64,
  name: 80,
  description: 500,
  version: 32,
  instructions: 4000,
  matches: 20,
  matchLength: 200,
  tools: 20,
  parameters: 10,
  paramDescription: 300,
  code: 10000,
} as const;

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PARAM_TYPES: readonly PluginParamType[] = ['string', 'number', 'boolean'];
const DEFAULT_VERSION = '1.0.0';

/** A plugin as written by a user or the agent, before storage adds its creator and timestamps. */
export interface BrowserPluginInput {
  id?: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  matches: string[];
  instructions: string;
  tools: PluginTool[];
}

export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

function fail(message: string): never {
  throw new PluginValidationError(message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Reads optional or required text. Missing optional text becomes ''. */
function readText(value: unknown, label: string, max: number, required: boolean): string {
  if (value === undefined || value === null) {
    if (required) fail(`${label} is required`);
    return '';
  }
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const text = value.trim();
  if (required && text === '') fail(`${label} is required`);
  if (text.length > max) fail(`${label} must be at most ${max} characters`);
  return text;
}

function readBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(`${label} must be true or false`);
  return value;
}

function readArray(value: unknown, label: string, max: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (value.length > max) fail(`${label} must have at most ${max} items`);
  return value;
}

function parseParameters(value: unknown, toolLabel: string): Record<string, PluginParam> {
  if (value === undefined || value === null) return {};
  const record = asRecord(value, `${toolLabel} parameters`);
  const entries = Object.entries(record);
  if (entries.length > PLUGIN_LIMITS.parameters) {
    fail(`${toolLabel} must have at most ${PLUGIN_LIMITS.parameters} parameters`);
  }
  const parameters: Record<string, PluginParam> = {};
  for (const [name, spec] of entries) {
    if (!PARAM_NAME_PATTERN.test(name)) fail(`parameter "${name}" of ${toolLabel} must be a plain identifier`);
    const param = asRecord(spec, `parameter "${name}" of ${toolLabel}`);
    if (!(PARAM_TYPES as readonly unknown[]).includes(param.type)) {
      fail(`parameter "${name}" of ${toolLabel} must have type string, number or boolean`);
    }
    parameters[name] = {
      type: param.type as PluginParamType,
      description: readText(param.description, `description of "${name}"`, PLUGIN_LIMITS.paramDescription, false),
      required: readBoolean(param.required, false, `required flag of "${name}"`),
    };
  }
  return parameters;
}

function parseTool(value: unknown, index: number): PluginTool {
  const record = asRecord(value, `tool ${index + 1}`);
  const name = readText(record.name, `name of tool ${index + 1}`, PLUGIN_LIMITS.name, true);
  const toolLabel = `tool "${name}"`;
  if (!TOOL_NAME_PATTERN.test(name)) fail(`${toolLabel} must be snake_case (a-z, 0-9, _), starting with a letter`);
  return {
    name,
    description: readText(record.description, `description of ${toolLabel}`, PLUGIN_LIMITS.description, true),
    parameters: parseParameters(record.parameters, toolLabel),
    code: readText(record.code, `code of ${toolLabel}`, PLUGIN_LIMITS.code, true),
  };
}

function parseTools(value: unknown): PluginTool[] {
  const tools = readArray(value, 'tools', PLUGIN_LIMITS.tools).map(parseTool);
  const names = new Set(tools.map(tool => tool.name));
  if (names.size !== tools.length) fail('tool names must be unique within a plugin');
  return tools;
}

function parseMatches(value: unknown): string[] {
  return readArray(value, 'matches', PLUGIN_LIMITS.matches).map((item, index) =>
    readText(item, `match ${index + 1}`, PLUGIN_LIMITS.matchLength, true),
  );
}

/**
 * Validates a plugin received from an import file or from the agent, and returns the normalized input.
 * Throws PluginValidationError with a description of the first problem found.
 */
export function parsePlugin(raw: unknown): BrowserPluginInput {
  const record = asRecord(raw, 'plugin');
  const id = readText(record.id, 'id', PLUGIN_LIMITS.id, false);
  if (id && !ID_PATTERN.test(id)) fail('id may only contain letters, digits, _ and -');
  return {
    ...(id ? { id } : {}),
    name: readText(record.name, 'name', PLUGIN_LIMITS.name, true),
    description: readText(record.description, 'description', PLUGIN_LIMITS.description, false),
    version: readText(record.version, 'version', PLUGIN_LIMITS.version, false) || DEFAULT_VERSION,
    enabled: readBoolean(record.enabled, true, 'enabled'),
    matches: parseMatches(record.matches),
    instructions: readText(record.instructions, 'instructions', PLUGIN_LIMITS.instructions, false),
    tools: parseTools(record.tools),
  };
}
