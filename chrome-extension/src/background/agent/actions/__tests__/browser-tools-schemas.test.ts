import { describe, expect, it } from 'vitest';
import {
  clickAtActionSchema,
  dragActionSchema,
  executeJavascriptActionSchema,
  readNetworkRequestsActionSchema,
  resizeViewportActionSchema,
} from '../schemas';

describe('browser tool action schemas', () => {
  it('click_at defaults are optional and button/click_count are validated', () => {
    expect(clickAtActionSchema.schema.safeParse({ x: 10, y: 20 }).success).toBe(true);
    expect(clickAtActionSchema.schema.safeParse({ x: 10, y: 20, button: 'back' }).success).toBe(false);
    expect(clickAtActionSchema.schema.safeParse({ x: 10, y: 20, click_count: 4 }).success).toBe(false);
    expect(clickAtActionSchema.schema.safeParse({ x: 10, y: 20, modifiers: ['Hyper'] }).success).toBe(false);
  });

  it('drag steps are bounded', () => {
    expect(dragActionSchema.schema.safeParse({ from_x: 1, from_y: 2, to_x: 3, to_y: 4, steps: 10 }).success).toBe(true);
    expect(dragActionSchema.schema.safeParse({ steps: 0 }).success).toBe(false);
    expect(dragActionSchema.schema.safeParse({ steps: 51 }).success).toBe(false);
  });

  it('read_network_requests limit is bounded', () => {
    expect(readNetworkRequestsActionSchema.schema.safeParse({ limit: 200, only_failed: true }).success).toBe(true);
    expect(readNetworkRequestsActionSchema.schema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('execute_javascript requires a non-empty script', () => {
    expect(executeJavascriptActionSchema.schema.safeParse({ script: '' }).success).toBe(false);
    expect(executeJavascriptActionSchema.schema.safeParse({ script: 'document.title' }).success).toBe(true);
  });

  it('resize_viewport bounds the size', () => {
    expect(resizeViewportActionSchema.schema.safeParse({ width: 390, height: 844, mobile: true }).success).toBe(true);
    expect(resizeViewportActionSchema.schema.safeParse({ width: 10, height: 844 }).success).toBe(false);
    expect(resizeViewportActionSchema.schema.safeParse({ reset: true }).success).toBe(true);
  });
});
