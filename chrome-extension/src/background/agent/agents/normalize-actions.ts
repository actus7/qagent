type ActionObject = Record<string, unknown>;

const INVALID_ACTION_FORMAT = 'Invalid action output format';
// A string can only be encoded a few times before it is not a model slip any more.
const MAX_JSON_LAYERS = 3;

const isActionObject = (value: unknown): value is ActionObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJsonString(text: string, repair: (text: string) => string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(repair(text));
    } catch {
      throw new Error(INVALID_ACTION_FORMAT);
    }
  }
}

function collect(value: unknown, repair: (text: string) => string, layers: number, into: ActionObject[]): void {
  if (value === null) return;
  if (isActionObject(value)) {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, repair, layers, into);
    return;
  }
  if (typeof value === 'string' && layers < MAX_JSON_LAYERS) {
    collect(parseJsonString(value, repair), repair, layers + 1, into);
    return;
  }
  throw new Error(INVALID_ACTION_FORMAT);
}

/**
 * Turns the model's `action` field into a flat list of `{ name: args }` objects. Models that send tool arguments
 * as JSON text may encode the list as a string, encode it twice, wrap each item in an array or send items as JSON
 * strings; without this the executor reads such an item's first key as the action name ("0").
 */
export function normalizeActions(raw: unknown, repair: (text: string) => string): ActionObject[] {
  const actions: ActionObject[] = [];
  collect(raw, repair, 0, actions);
  return actions;
}
