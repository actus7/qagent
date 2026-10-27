import { z } from 'zod';
import type { ActionResult } from '@src/background/agent/types';
import type { ActionSchema } from './schemas';

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

function getObjectSchemaShape(schema: z.ZodType): Record<string, z.ZodTypeAny> | null {
  if (!(schema instanceof z.ZodObject)) {
    return null;
  }
  return schema.shape as Record<string, z.ZodTypeAny>;
}

function parseRefToIndex(selector: unknown): number | null {
  if (typeof selector !== 'string') {
    return null;
  }
  const trimmed = selector.trim();
  const match = /^@e(\d+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

/**
 * An action is a function that takes an input and returns an ActionResult
 */
// `never` default: any Action<X> is assignable to the bare `Action` used by registries and arrays.
export class Action<TInput = never> {
  constructor(
    private readonly handler: (input: TInput) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
    // Whether this action has an index argument
    public readonly hasIndex: boolean = false,
  ) {}

  async call(input: unknown): Promise<ActionResult> {
    // Validate input before calling the handler
    const schema = this.schema.schema;
    const schemaShape = getObjectSchemaShape(schema);

    // check if the schema is schema: z.object({}), if so, ignore the input
    const isEmptySchema = schemaShape !== null && Object.keys(schemaShape).length === 0;

    if (isEmptySchema) {
      return await this.handler({} as TInput);
    }

    const parsedArgs = this.schema.schema.safeParse(input);
    if (!parsedArgs.success) {
      const errorMessage = parsedArgs.error.message;
      throw new InvalidInputError(errorMessage);
    }
    return await this.handler(parsedArgs.data as TInput);
  }

  name() {
    return this.schema.name;
  }

  /**
   * Returns the prompt for the action
   * @returns {string} The prompt for the action
   */
  prompt() {
    const schemaShape = getObjectSchemaShape(this.schema.schema) ?? {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }

  /**
   * Get the index argument from the input if this action has an index
   * @param input The input to extract the index from
   * @returns The index value if found, null otherwise
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (!input || typeof input !== 'object') {
      return null;
    }

    if ('index' in input) {
      const index = (input as { index?: unknown }).index;
      if (typeof index === 'number' && Number.isInteger(index)) {
        return index;
      }
    }

    if ('selector' in input) {
      return parseRefToIndex((input as { selector?: unknown }).selector);
    }

    return null;
  }

  /**
   * Set the index argument in the input if this action has an index
   * @param input The input to update the index in
   * @param newIndex The new index value to set
   * @returns Whether the index was set successfully
   */
  setIndexArg(input: unknown, newIndex: number): boolean {
    if (!this.hasIndex) {
      return false;
    }
    if (input && typeof input === 'object') {
      if ('selector' in input && typeof (input as { selector?: unknown }).selector === 'string') {
        (input as { selector: string }).selector = `@e${newIndex}`;
        return true;
      }

      (input as { index: number }).index = newIndex;
      return true;
    }
    return false;
  }
}

// TODO: can not make every action optional, don't know why
export function buildDynamicActionSchema(actions: Action[]): z.ZodType<Record<string, unknown>> {
  let schema = z.object({});
  for (const action of actions) {
    // create a schema for the action, it could be action.schema.schema or null
    // but don't use default: null as it causes issues with Google Generative AI
    const actionSchema = action.schema.schema;
    schema = schema.extend({
      [action.name()]: actionSchema.nullable().optional().describe(action.schema.description),
    });
  }
  return schema;
}
