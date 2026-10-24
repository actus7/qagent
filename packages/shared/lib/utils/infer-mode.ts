import type { AssistantMode } from './agent-port-messages';
import { askSystemOne, type JevCredentials } from './jev';

const POLITE = String.raw`(?:por favor,?\s+|pode(?:ria)?\s+|você pode\s+|ajude-me a\s+|please\s+|can you\s+|could you\s+)?`;
const ACTION_VERBS = [
  // pt
  'clique',
  'clicar',
  'abra',
  'abrir',
  'vá',
  'va para',
  'ir para',
  'navegue',
  'acesse',
  'preencha',
  'preencher',
  'digite',
  'envie',
  'enviar',
  'submeta',
  'busque',
  'pesquise',
  'procure',
  'compre',
  'baixe',
  'baixar',
  'selecione',
  'role',
  'rolar',
  'marque',
  'desmarque',
  'faça',
  'fazer',
  'realizar',
  'execute',
  'executar',
  'entre',
  'feche',
  'cadastre',
  'agende',
  'crie',
  'criar',
  'adicione',
  'remova',
  'apague',
  'exclua',
  'edite',
  'atualize',
  // en
  'click',
  'open',
  'go to',
  'navigate',
  'fill',
  'type',
  'submit',
  'search',
  'buy',
  'download',
  'select',
  'scroll',
  'log in',
  'sign in',
  'close',
  'book',
  'create',
  'add',
  'remove',
  'delete',
  'edit',
  'update',
];
const ACTION_START = new RegExp(String.raw`^\s*${POLITE}(?:${ACTION_VERBS.join('|')})(?![\p{L}])`, 'iu');
const PLAN_START =
  /^\s*(?:por favor,?\s+)?(?:crie|faça|monte|elabore|make|create|write|draft)\s+(?:um|a)\s+(?:plano|plan)(?![\p{L}])/iu;
const SHORT_REPLY_WORDS = 3;

const MODES: readonly AssistantMode[] = ['chat', 'plan', 'act'];
const isMode = (value: string): value is AssistantMode => (MODES as readonly string[]).includes(value);

/**
 * Picks the assistant mode from the message so the user never has to: requests that start with an action verb
 * drive the browser; everything else (questions, explanations) is answered from the selected pages.
 * A short reply with no verb ("sim", "continue") keeps the mode of the previous message.
 */
export function inferMode(text: string, previous: AssistantMode = 'chat'): AssistantMode {
  if (PLAN_START.test(text)) return 'plan';
  if (ACTION_START.test(text)) return 'act';
  const words = text.trim().split(/\s+/).length;
  return words <= SHORT_REPLY_WORDS ? previous : 'chat';
}

// Below this the Choice distribution is too flat to trust over the verb heuristic.
export const JEV_MODE_MIN_CONFIDENCE = 0.5;

export const JEV_MODE_QUESTION = {
  type: 'choice',
  instructions:
    'Which mode should the browser assistant use to handle `message`? `previous_mode` is the mode used for the ' +
    "previous message; a short follow-up such as 'yes', 'continue' or 'ok' keeps it.",
  criteria: {
    chat:
      'The user asks a question or wants an explanation, summary, comparison or opinion about the open pages, ' +
      'or is just talking. Answered by reading the pages; nothing is done in the browser.',
    plan: 'The user asks for a plan, a list of steps or a strategy to be written down, without executing it.',
    act:
      'The user asks for something to be done in the browser: click, open, navigate, fill, submit, search, buy, ' +
      'download, log in, record or test a flow.',
  },
} as const;

/**
 * Mode selection with Jev when a key is configured, falling back to {@link inferMode} when Jev is not configured,
 * fails, or is not confident. The heuristic is the floor; Jev only ever improves on it.
 */
export async function resolveMode(
  text: string,
  previous: AssistantMode,
  jev: JevCredentials | null,
  onError: (error: unknown) => void = () => {},
): Promise<AssistantMode> {
  if (jev?.apiKey) {
    try {
      const { mode } = await askSystemOne(jev, { message: text, previous_mode: previous }, { mode: JEV_MODE_QUESTION });
      if (mode?.type === 'choice' && isMode(mode.choice) && mode.confidence >= JEV_MODE_MIN_CONFIDENCE) {
        return mode.choice;
      }
    } catch (error) {
      onError(error);
    }
  }
  return inferMode(text, previous);
}
