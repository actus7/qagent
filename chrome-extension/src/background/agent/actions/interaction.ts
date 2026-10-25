import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { Action } from './action';
import { describeTargetSpec, type TargetSpec } from '../../browser/target-resolver';
import {
  actionFailedResult,
  elementNotExistResult,
  engineUnsupportedResult,
  logger,
  missingLocatorResult,
} from './shared';
import {
  clickActionSchema,
  clickElementActionSchema,
  fillActionSchema,
  getDropdownOptionsActionSchema,
  inputTextActionSchema,
  pressActionSchema,
  selectDropdownOptionActionSchema,
  sendKeysActionSchema,
  typeActionSchema,
  uploadFileActionSchema,
} from './schemas';

async function clickBySelector(context: AgentContext, selector: string, intent: string): Promise<ActionResult> {
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

  const normalizedSelector = selector.trim();
  if (!normalizedSelector) {
    throw new Error('Selector cannot be empty');
  }

  const page = await context.browserContext.getCurrentPage();
  const state = await page.getState();
  const elementNode = page.getDomElementBySelector(normalizedSelector, state.selectorMap);

  if (elementNode && page.isFileUploader(elementNode)) {
    const msg = t('act_click_fileUploader', [normalizedSelector]);
    logger.info(msg);
    return new ActionResult({
      extractedContent: msg,
      includeInMemory: true,
    });
  }

  try {
    const initialTabIds = await context.browserContext.getAllTabIds();
    // The overlay ripples where the agent cursor lands, so no separate ripple from stale pre-scroll coordinates
    await page.clickBySelector(context.options.useVision, normalizedSelector, elementNode);

    const elementText = elementNode?.getAllTextTillNextClickableElement(2) || normalizedSelector;
    let msg = t('act_click_ok', [normalizedSelector, elementText]);
    logger.info(msg);

    // TODO: could be optimized by chrome extension tab api
    const currentTabIds = await context.browserContext.getAllTabIds();
    if (currentTabIds.size > initialTabIds.size) {
      const newTabMsg = t('act_click_newTabOpened');
      msg += ` - ${newTabMsg}`;
      logger.info(newTabMsg);
      const newTabId = Array.from(currentTabIds).find(id => !initialTabIds.has(id));
      if (newTabId) {
        await context.browserContext.switchTab(newTabId);
      }
    }
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  } catch (error) {
    const msg = t('act_errors_elementNoLongerAvailable', [normalizedSelector]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
    return new ActionResult({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A readable target is tried first, then a ref or CSS selector. Either way the page does the lookup. */
interface WriteLocator {
  selector?: string;
  target?: TargetSpec;
}

async function writeText(
  context: AgentContext,
  locator: WriteLocator,
  text: string,
  intent: string,
  clearBeforeTyping: boolean,
): Promise<ActionResult> {
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
  const page = await context.browserContext.getCurrentPage();

  if (locator.target) {
    if (!page.inputTextByTarget) return engineUnsupportedResult(context);
    try {
      await page.inputTextByTarget(locator.target, text, clearBeforeTyping);
    } catch (error) {
      return actionFailedResult(context, error);
    }
    const msg = t('act_inputText_ok', [text, describeTargetSpec(locator.target)]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  const normalizedSelector = (locator.selector ?? '').trim();
  if (!normalizedSelector) {
    throw new Error('Selector cannot be empty');
  }
  await page.inputTextBySelector(context.options.useVision, normalizedSelector, text, {
    clearBeforeTyping,
  });

  const msg = t('act_inputText_ok', [text, normalizedSelector]);
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
  return new ActionResult({ extractedContent: msg, includeInMemory: true });
}

async function clickByTarget(context: AgentContext, target: TargetSpec, intent: string): Promise<ActionResult> {
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
  const page = await context.browserContext.getCurrentPage();
  if (!page.clickByTarget) return engineUnsupportedResult(context);
  try {
    await page.clickByTarget(target);
  } catch (error) {
    return actionFailedResult(context, error);
  }
  const msg = t('act_clickTarget_ok', [describeTargetSpec(target)]);
  context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
  return new ActionResult({ extractedContent: msg, includeInMemory: true });
}

export function createClickAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof clickActionSchema.schema>) => {
      if (input.target) {
        return clickByTarget(
          context,
          input.target,
          input.intent || t('act_clickTarget_ok', [describeTargetSpec(input.target)]),
        );
      }
      if (!input.selector) return missingLocatorResult(context);
      const intent = input.intent || t('act_click_start', [input.selector]);
      return clickBySelector(context, input.selector, intent);
    },
    clickActionSchema,
    true,
  );
}

// Legacy alias kept for compatibility with older histories/prompts.
export function createClickElementAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof clickElementActionSchema.schema>) => {
      const intent = input.intent || t('act_click_start', [input.index.toString()]);
      return clickBySelector(context, `@e${input.index}`, intent);
    },
    clickElementActionSchema,
    true,
  );
}

function locatorLabel(input: { selector?: string; target?: TargetSpec }): string {
  return input.target ? describeTargetSpec(input.target) : (input.selector ?? '');
}

export function createFillAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof fillActionSchema.schema>) => {
      if (!input.selector && !input.target) return missingLocatorResult(context);
      const intent = input.intent || t('act_inputText_start', [locatorLabel(input)]);
      return writeText(context, input, input.text, intent, true);
    },
    fillActionSchema,
    true,
  );
}

export function createTypeAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof typeActionSchema.schema>) => {
      if (!input.selector && !input.target) return missingLocatorResult(context);
      const intent = input.intent || t('act_inputText_start', [locatorLabel(input)]);
      return writeText(context, input, input.text, intent, false);
    },
    typeActionSchema,
    true,
  );
}

// Legacy alias kept for compatibility with older histories/prompts.
export function createInputTextAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof inputTextActionSchema.schema>) => {
      const intent = input.intent || t('act_inputText_start', [input.index.toString()]);
      return writeText(context, { selector: `@e${input.index}` }, input.text, intent, true);
    },
    inputTextActionSchema,
    true,
  );
}

export function createPressAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof pressActionSchema.schema>) => {
    const intent = input.intent || t('act_sendKeys_start', [input.key]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    await page.sendKeys(input.key);
    const msg = t('act_sendKeys_ok', [input.key]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, pressActionSchema);
}

export function createSendKeysAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof sendKeysActionSchema.schema>) => {
    const intent = input.intent || t('act_sendKeys_start', [input.keys]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await context.browserContext.getCurrentPage();
    await page.sendKeys(input.keys);
    const msg = t('act_sendKeys_ok', [input.keys]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, sendKeysActionSchema);
}

// Get all options from a native dropdown
export function createGetDropdownOptionsAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof getDropdownOptionsActionSchema.schema>) => {
      const intent = input.intent || t('act_getDropdownOptions_start', [input.index.toString()]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await context.browserContext.getCurrentPage();
      const state = await page.getState();

      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        return elementNotExistResult(context, input.index);
      }

      try {
        // Use the existing getDropdownOptions method
        const options = await page.getDropdownOptions(input.index);

        if (options && options.length > 0) {
          // Format options for display
          const formattedOptions: string[] = options.map(opt => {
            // Encoding ensures AI uses the exact string in select_dropdown_option
            const encodedText = JSON.stringify(opt.text);
            return `${opt.index}: text=${encodedText}`;
          });

          let msg = formattedOptions.join('\n');
          msg += '\n' + t('act_getDropdownOptions_useExactText');
          context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_OK,
            t('act_getDropdownOptions_ok', [options.length.toString()]),
          );
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        }

        // This code should not be reached as getDropdownOptions throws an error when no options found
        // But keeping as fallback
        const msg = t('act_getDropdownOptions_noOptions');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
        });
      } catch (error) {
        const errorMsg = t('act_getDropdownOptions_failed', [error instanceof Error ? error.message : String(error)]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    },
    getDropdownOptionsActionSchema,
    true,
  );
}

// Select dropdown option for interactive element index by the text of the option you want to select'
export function createSelectDropdownOptionAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof selectDropdownOptionActionSchema.schema>) => {
      const intent = input.intent || t('act_selectDropdownOption_start', [input.text, input.index.toString()]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await context.browserContext.getCurrentPage();
      const state = await page.getState();

      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        return elementNotExistResult(context, input.index);
      }

      // Validate that we're working with a select element
      if (!elementNode.tagName || elementNode.tagName.toLowerCase() !== 'select') {
        const errorMsg = t('act_selectDropdownOption_notSelect', [
          input.index.toString(),
          elementNode.tagName || 'unknown',
        ]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }

      logger.debug(`Attempting to select '${input.text}' using xpath: ${elementNode.xpath}`);

      try {
        const result = await page.selectDropdownOption(input.index, input.text);
        const msg = t('act_selectDropdownOption_ok', [input.text, input.index.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({
          extractedContent: result,
          includeInMemory: true,
        });
      } catch (error) {
        const errorMsg = t('act_selectDropdownOption_failed', [error instanceof Error ? error.message : String(error)]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    },
    selectDropdownOptionActionSchema,
    true,
  );
}

export function createUploadFileAction(context: AgentContext) {
  return new Action(
    async (input: z.infer<typeof uploadFileActionSchema.schema>) => {
      const intent = input.intent || t('act_uploadFile_start', [input.file_name, input.index.toString()]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await context.browserContext.getCurrentPage();
      if (!page.uploadFileBySelector) {
        const msg = t('act_uploadFile_unsupported');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      if (!page.getDomElementBySelector(`@e${input.index}`)) return elementNotExistResult(context, input.index);
      // Binary attachments come from the user's task files; text content is the fallback
      const attached = input.attachment ? context.taskFiles.get(input.attachment) : undefined;
      const fileName = input.attachment || input.file_name;
      if (input.attachment && !attached) {
        const msg = t('act_uploadFile_noAttachment', input.attachment);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      if (!attached && input.content == null) {
        const msg = t('act_uploadFile_noContent', fileName);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      try {
        await page.uploadFileBySelector(`@e${input.index}`, {
          name: fileName,
          ...(attached ? { base64: attached.base64 } : { content: input.content ?? '' }),
          mimeType: attached?.mimeType ?? input.mime_type ?? undefined,
        });
      } catch (error) {
        const msg = t('act_uploadFile_fail', [fileName, error instanceof Error ? error.message : String(error)]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      const msg = t('act_uploadFile_ok', [fileName, input.index.toString()]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    },
    uploadFileActionSchema,
    true,
  );
}
