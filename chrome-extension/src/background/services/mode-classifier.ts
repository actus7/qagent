import { inferMode, resolveMode, type AssistantMode, type AssistantTaskOptions } from '@extension/shared';
import { jevStore } from '@extension/storage';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { MessageContent } from '@langchain/core/messages';
import { createLogger } from '../log';
import { loadAssistantModel } from './assistant-model';

const logger = createLogger('mode-classifier');

const SHORT_REPLY_WORDS = 3;
const LLM_TIMEOUT_MS = 8000;

const routerPrompt = (previous: AssistantMode) =>
  'You route messages sent to a browser assistant. Reply with exactly one word: act, plan or chat.\n' +
  'act: the user wants something done in the browser (go to a page or section, open, click, fill, submit, ' +
  'search, buy, download, log in, record or test a flow).\n' +
  'plan: the user wants a plan or a list of steps written down, not executed.\n' +
  'chat: a question, explanation, summary, comparison or opinion about the open pages, or small talk.\n' +
  `The previous message used "${previous}"; a short follow-up such as "yes" or "continue" keeps it.`;

const contentText = (content: MessageContent): string =>
  typeof content === 'string'
    ? content
    : content.map(part => (part.type === 'text' && 'text' in part ? part.text : '')).join('');

/**
 * Decides whether a message is answered from the pages (chat), planned (plan) or executed in the browser (act).
 * Cheap and certain first: the verb heuristic when it matched, then Jev when configured, then the user's own
 * model with a one-word reply. The heuristic's 'chat' default is only used when everything else is unavailable.
 */
export async function classifyMode(
  text: string,
  previous: AssistantMode,
  modelAgent: AssistantTaskOptions['modelAgent'],
): Promise<AssistantMode> {
  const guess = inferMode(text, previous);
  const isShortReply = text.trim().split(/\s+/).length <= SHORT_REPLY_WORDS;
  if (guess !== 'chat' || isShortReply) return guess;

  const jev = await jevStore.getConfig().catch(() => null);
  if (jev?.apiKey) {
    return resolveMode(text, previous, jev, error => logger.error('Jev mode inference failed:', error));
  }

  try {
    const model = await loadAssistantModel(modelAgent);
    const reply = await model.invoke([new SystemMessage(routerPrompt(previous)), new HumanMessage(text)], {
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    const word = contentText(reply.content)
      .toLowerCase()
      .match(/\b(act|plan|chat)\b/)?.[1];
    if (word) return word as AssistantMode;
    logger.warning('Model mode reply was not one of act/plan/chat; using the heuristic');
  } catch (error) {
    logger.error('Model mode inference failed; using the heuristic:', error);
  }
  return guess;
}
