import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { resolveActionIndex } from './element-resolver';
import { actionErrorResult, logger } from './shared';
import {
  nextPageActionSchema,
  previousPageActionSchema,
  scrollActionSchema,
  scrollIntoViewActionSchema,
  scrollToBottomActionSchema,
  scrollToPercentActionSchema,
  scrollToTextActionSchema,
  scrollToTopActionSchema,
} from './schemas';

export function createScrollAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof scrollActionSchema.schema>) => {
    const amount = input.pixels ?? 700;
    const intent = input.intent || `Scroll ${input.direction} by ${amount}px`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await context.browserContext.getCurrentPage();
    await page.scrollByDirection(input.direction, amount);

    const msg = `Scrolled ${input.direction} by ${amount}px`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, scrollActionSchema);
}

export function createScrollIntoViewAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof scrollIntoViewActionSchema.schema>) => {
    const intent = input.intent || `Scroll ${input.selector} into view`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    await page.scrollIntoViewBySelector(input.selector);
    const msg = `Scrolled ${input.selector} into view`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, scrollIntoViewActionSchema);
}

export function createScrollToPercentAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof scrollToPercentActionSchema.schema>) => {
    const intent = input.intent || t('act_scrollToPercent_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();

    // index 0 is a valid element, so compare against null
    if (input.index != null) {
      const resolved = await resolveActionIndex(context, page, input.index);
      if ('error' in resolved) {
        return actionErrorResult(context, resolved.error);
      }
      const elementNode = resolved.node;
      logger.info(`Scrolling to percent: ${input.yPercent} with elementNode: ${elementNode.xpath}`);
      await page.scrollToPercent(input.yPercent, elementNode);
    } else {
      await page.scrollToPercent(input.yPercent);
    }
    const msg = t('act_scrollToPercent_ok', [input.yPercent.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, scrollToPercentActionSchema);
}

export function createScrollToTopAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof scrollToTopActionSchema.schema>) => {
    const intent = input.intent || t('act_scrollToTop_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    // index 0 is a valid element, so compare against null
    if (input.index != null) {
      const resolved = await resolveActionIndex(context, page, input.index);
      if ('error' in resolved) {
        return actionErrorResult(context, resolved.error);
      }
      const elementNode = resolved.node;
      await page.scrollToPercent(0, elementNode);
    } else {
      await page.scrollToPercent(0);
    }
    const msg = t('act_scrollToTop_ok');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, scrollToTopActionSchema);
}

export function createScrollToBottomAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof scrollToBottomActionSchema.schema>) => {
    const intent = input.intent || t('act_scrollToBottom_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    // index 0 is a valid element, so compare against null
    if (input.index != null) {
      const resolved = await resolveActionIndex(context, page, input.index);
      if ('error' in resolved) {
        return actionErrorResult(context, resolved.error);
      }
      const elementNode = resolved.node;
      await page.scrollToPercent(100, elementNode);
    } else {
      await page.scrollToPercent(100);
    }
    const msg = t('act_scrollToBottom_ok');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, scrollToBottomActionSchema);
}

// Scroll to previous page
export function createPreviousPageAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof previousPageActionSchema.schema>) => {
    const intent = input.intent || t('act_previousPage_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();

    // index 0 is a valid element, so compare against null
    if (input.index != null) {
      const resolved = await resolveActionIndex(context, page, input.index);
      if ('error' in resolved) {
        return actionErrorResult(context, resolved.error);
      }
      const elementNode = resolved.node;

      // Check if element is already at top of its scrollable area
      try {
        const [elementScrollTop] = await page.getElementScrollInfo(elementNode);
        if (elementScrollTop === 0) {
          const msg = t('act_errors_alreadyAtTop', [input.index.toString()]);
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }
      } catch (error) {
        // If we can't get scroll info, let the scrollToPreviousPage method handle it
        logger.warning(`Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`);
      }

      await page.scrollToPreviousPage(elementNode);
    } else {
      // Check if page is already at top
      const [initialScrollY] = await page.getScrollInfo();
      if (initialScrollY === 0) {
        const msg = t('act_errors_pageAlreadyAtTop');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }

      await page.scrollToPreviousPage();
    }
    const msg = t('act_previousPage_ok');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, previousPageActionSchema);
}

// Scroll to next page
export function createNextPageAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof nextPageActionSchema.schema>) => {
    const intent = input.intent || t('act_nextPage_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();

    // index 0 is a valid element, so compare against null
    if (input.index != null) {
      const resolved = await resolveActionIndex(context, page, input.index);
      if ('error' in resolved) {
        return actionErrorResult(context, resolved.error);
      }
      const elementNode = resolved.node;

      // Check if element is already at bottom of its scrollable area
      try {
        const [elementScrollTop, elementClientHeight, elementScrollHeight] =
          await page.getElementScrollInfo(elementNode);
        if (elementScrollTop + elementClientHeight >= elementScrollHeight) {
          const msg = t('act_errors_alreadyAtBottom', [input.index.toString()]);
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }
      } catch (error) {
        // If we can't get scroll info, let the scrollToNextPage method handle it
        logger.warning(`Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`);
      }

      await page.scrollToNextPage(elementNode);
    } else {
      // Check if page is already at bottom
      const [initialScrollY, initialVisualViewportHeight, initialScrollHeight] = await page.getScrollInfo();
      if (initialScrollY + initialVisualViewportHeight >= initialScrollHeight) {
        const msg = t('act_errors_pageAlreadyAtBottom');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }

      await page.scrollToNextPage();
    }
    const msg = t('act_nextPage_ok');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, nextPageActionSchema);
}

export function createScrollToTextAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof scrollToTextActionSchema.schema>) => {
    const intent = input.intent || t('act_scrollToText_start', [input.text, input.nth.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await context.browserContext.getCurrentPage();
    try {
      const scrolled = await page.scrollToText(input.text, input.nth);
      const msg = scrolled
        ? t('act_scrollToText_ok', [input.text, input.nth.toString()])
        : t('act_scrollToText_notFound', [input.text, input.nth.toString()]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      const msg = t('act_scrollToText_failed', [error instanceof Error ? error.message : String(error)]);
      return actionErrorResult(context, msg);
    }
  }, scrollToTextActionSchema);
}
