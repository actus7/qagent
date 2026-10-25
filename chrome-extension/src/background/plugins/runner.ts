import type { PluginTool } from '@extension/storage';

export type PluginArgValue = string | number | boolean;

export type CheckedToolArgs = { ok: true; args: Record<string, PluginArgValue> } | { ok: false; error: string };

/** Checks agent or caller supplied arguments against a tool's declared parameters before anything runs in the page. */
export function checkToolArgs(tool: PluginTool, input: unknown): CheckedToolArgs {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'args must be an object' };
  }
  const given = input as Record<string, unknown>;
  const declared = Object.keys(tool.parameters);
  const unknownKey = Object.keys(given).find(key => !declared.includes(key));
  if (unknownKey !== undefined) return { ok: false, error: `unknown argument "${unknownKey}"` };

  const args: Record<string, PluginArgValue> = {};
  for (const [name, spec] of Object.entries(tool.parameters)) {
    const value = given[name];
    if (value === undefined) {
      if (spec.required) return { ok: false, error: `missing required argument "${name}"` };
      continue;
    }
    if (typeof value !== spec.type) return { ok: false, error: `argument "${name}" must be a ${spec.type}` };
    args[name] = value as PluginArgValue;
  }
  return { ok: true, args };
}

/** Wraps the tool body in an async arrow that receives the checked args, so the page evaluates one expression. */
export function buildToolScript(tool: PluginTool, args: Record<string, PluginArgValue>): string {
  return `(async (args) => {\n${tool.code}\n})(${JSON.stringify(args)})`;
}
