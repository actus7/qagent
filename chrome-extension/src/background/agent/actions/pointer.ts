import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import type { BrowserPageLike } from '../../browser/types';
import type { Point } from '../../browser/page-pointer';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { resolveActionIndex } from './element-resolver';
import { actionErrorResult, engineUnsupportedResult } from './shared';
import { clickAtActionSchema, dragActionSchema, hoverActionSchema } from './schemas';

const DEFAULT_DRAG_STEPS = 10;

interface PointerTarget {
  index?: number | null;
  x?: number | null;
  y?: number | null;
}

interface ResolvedTarget {
  point: Point;
  label: string;
}

function formatPoint(point: Point): string {
  return `(${Math.round(point.x)}, ${Math.round(point.y)})`;
}

/**
 * Resolves an element index or explicit coordinates to viewport CSS pixels.
 * Returns null when neither an index nor both coordinates are given; throws on lookup failures.
 */
async function resolveTarget(
  context: AgentContext,
  page: BrowserPageLike,
  target: PointerTarget,
): Promise<ResolvedTarget | null> {
  if (target.index != null) {
    if (!page.getElementCenter) throw new Error(t('act_engineUnsupported'));
    // The index refers to the state the model saw; find that element in the page as it is now.
    const resolved = await resolveActionIndex(context, page, target.index);
    if ('error' in resolved) throw new Error(resolved.error);
    const point = await page.getElementCenter(resolved.index);
    return { point, label: `element ${target.index}` };
  }
  if (target.x == null || target.y == null) return null;
  if (!page.toViewportPoint) throw new Error(t('act_engineUnsupported'));
  const point = await page.toViewportPoint({ x: target.x, y: target.y }, context.options.useVision);
  return { point, label: formatPoint({ x: target.x, y: target.y }) };
}

async function failureResult(context: AgentContext, msg: string): Promise<ActionResult> {
  return actionErrorResult(context, msg);
}

async function errorResult(context: AgentContext, error: unknown): Promise<ActionResult> {
  return failureResult(context, t('act_pointer_fail', [error instanceof Error ? error.message : String(error)]));
}

export function createClickAtAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof clickAtActionSchema.schema>) => {
    const label = formatPoint({ x: input.x, y: input.y });
    const intent = input.intent || t('act_clickAt_start', [label]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.clickAt || !page.toViewportPoint) return engineUnsupportedResult(context);
    try {
      const point = await page.toViewportPoint({ x: input.x, y: input.y }, context.options.useVision);
      await page.clickAt(point, {
        button: input.button ?? 'left',
        clickCount: input.click_count ?? 1,
        modifiers: input.modifiers ?? [],
      });
    } catch (error) {
      return errorResult(context, error);
    }
    const msg = t('act_clickAt_ok', [label]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, clickAtActionSchema);
}

export function createHoverAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof hoverActionSchema.schema>) => {
    const page = await context.browserContext.getCurrentPage();
    if (!page.hoverAt) return engineUnsupportedResult(context);
    let target: ResolvedTarget | null;
    try {
      target = await resolveTarget(context, page, input);
    } catch (error) {
      return errorResult(context, error);
    }
    if (!target) return failureResult(context, t('act_pointer_needTarget'));

    const intent = input.intent || t('act_hover_start', [target.label]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    try {
      await page.hoverAt(target.point);
    } catch (error) {
      return errorResult(context, error);
    }
    const msg = t('act_hover_ok', [target.label]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, hoverActionSchema);
}

export function createDragAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof dragActionSchema.schema>) => {
    const page = await context.browserContext.getCurrentPage();
    if (!page.dragBetween) return engineUnsupportedResult(context);
    let from: ResolvedTarget | null;
    let to: ResolvedTarget | null;
    try {
      from = await resolveTarget(context, page, { index: input.from_index, x: input.from_x, y: input.from_y });
      to = await resolveTarget(context, page, { index: input.to_index, x: input.to_x, y: input.to_y });
    } catch (error) {
      return errorResult(context, error);
    }
    if (!from || !to) return failureResult(context, t('act_pointer_needTarget'));

    const intent = input.intent || t('act_drag_start', [from.label, to.label]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    try {
      await page.dragBetween(from.point, to.point, input.steps ?? DEFAULT_DRAG_STEPS);
    } catch (error) {
      return errorResult(context, error);
    }
    const msg = t('act_drag_ok', [from.label, to.label]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, dragActionSchema);
}
