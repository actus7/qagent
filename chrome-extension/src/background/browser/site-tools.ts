// WebMCP: tools a page registers through navigator.modelContext. The two page functions below run in the MAIN
// world through chrome.scripting, so they must stay self-contained (no references to this module).
// The page is untrusted: everything it returns is validated here before the model sees it.

const SITE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_SCHEMA_CHARS = 2000;
export const MAX_SITE_TOOLS = 50;

export interface SiteToolDescriptor {
  name: string;
  description: string;
  inputSchema: string;
}

/** Keeps the entries that look like tools: a valid name, strings clipped, schema reduced to bounded JSON text. */
export function parseSiteToolList(raw: unknown): SiteToolDescriptor[] {
  if (!Array.isArray(raw)) return [];
  const tools: SiteToolDescriptor[] = [];
  for (const entry of raw) {
    if (tools.length >= MAX_SITE_TOOLS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as { name?: unknown; description?: unknown; inputSchema?: unknown };
    if (typeof item.name !== 'string' || !SITE_TOOL_NAME_PATTERN.test(item.name)) continue;
    const description = typeof item.description === 'string' ? item.description.slice(0, MAX_DESCRIPTION_CHARS) : '';
    const schema = item.inputSchema === undefined ? '' : safeJson(item.inputSchema).slice(0, MAX_SCHEMA_CHARS);
    tools.push({ name: item.name, description, inputSchema: schema });
  }
  return tools;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** Reads the page's registered tools. Returns plain JSON text, since functions in the result cannot be cloned out. */
export function readSiteToolsInPage(): { api: string | null; json: string } | { error: string } {
  const host =
    (document as { modelContext?: unknown }).modelContext ?? (navigator as { modelContext?: unknown }).modelContext;
  if (!host) return { api: null, json: '[]' };
  const api = (document as { modelContext?: unknown }).modelContext
    ? 'document.modelContext'
    : 'navigator.modelContext';
  const model = host as { getTools?: () => unknown; listTools?: () => unknown };
  const list = model.getTools ?? model.listTools;
  if (typeof list !== 'function') return { api, json: '[]' };
  try {
    const raw = list.call(host);
    const tools = Array.isArray(raw) ? raw : (raw as { tools?: unknown } | null)?.tools;
    const plain = Array.isArray(tools)
      ? tools.map(tool => {
          const item = (tool ?? {}) as { name?: unknown; description?: unknown; inputSchema?: unknown };
          return { name: item.name, description: item.description, inputSchema: item.inputSchema };
        })
      : [];
    return { api, json: JSON.stringify(plain) ?? '[]' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Runs one registered tool with a timeout. Resolves to a JSON string of the result, or { error }. */
export async function callSiteToolInPage(
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
  const host =
    (document as { modelContext?: unknown }).modelContext ?? (navigator as { modelContext?: unknown }).modelContext;
  if (!host) return { ok: false, error: 'This page registers no site tools.' };
  const model = host as {
    executeTool?: (n: string, a: unknown) => unknown;
    callTool?: (n: string, a: unknown) => unknown;
  };
  const invoke = model.executeTool ?? model.callTool;
  if (typeof invoke !== 'function') return { ok: false, error: 'The page offers no way to run its tools.' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const value = await Promise.race([Promise.resolve(invoke.call(host, name, args)), timeout]);
    const json = JSON.stringify(value);
    return { ok: true, json: json === undefined ? 'null' : json };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function formatSiteTools(tools: SiteToolDescriptor[]): string {
  return tools
    .map(
      tool =>
        `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}${tool.inputSchema ? ` | input ${tool.inputSchema}` : ''}`,
    )
    .join('\n');
}
