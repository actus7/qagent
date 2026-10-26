import type { BrowserPlugin, Workflow } from '@extension/storage';
import { pluginAppliesToUrl } from '../../plugins/urlMatch';
import type { JevAnswers } from './runtime';
import { readChoice, readNoul } from './runtime';
import { hostOf } from './tool-routing';

export const PLUGIN_ROUTING_CHOICE_ID = 'which';
export const PLUGIN_ROUTING_SOLVES_ID = 'solves';
// The Choice question accepts at most 255 options; candidates keep their listing order when cut.
const MAX_CANDIDATES = 255;

export type RoutingCandidate =
  | { kind: 'plugin_tool'; pluginName: string; toolName: string; description: string }
  | { kind: 'workflow'; workflowName: string; description: string };

const candidateKey = (index: number) => `c${index}`;

function workflowAppliesToUrl(workflow: Workflow, url: string): boolean {
  const navigateHosts = workflow.steps
    .flatMap(step => (step.kind === 'navigate' ? [hostOf(step.url)] : []))
    .filter(Boolean);
  // A workflow that never navigates is not tied to a site, so it is offered everywhere.
  return navigateHosts.length === 0 || navigateHosts.includes(hostOf(url));
}

/** Enabled plugin tools and saved workflows that apply to the page, in a stable order, capped to the Choice limit. */
export function buildRoutingCandidates(
  plugins: readonly BrowserPlugin[],
  workflows: readonly Workflow[],
  url: string,
): RoutingCandidate[] {
  const pluginTools: RoutingCandidate[] = plugins
    .filter(plugin => plugin.enabled && pluginAppliesToUrl(plugin, url))
    .flatMap(plugin =>
      plugin.tools.map(tool => ({
        kind: 'plugin_tool' as const,
        pluginName: plugin.name,
        toolName: tool.name,
        description: tool.description,
      })),
    );
  const savedWorkflows: RoutingCandidate[] = workflows
    .filter(workflow => workflowAppliesToUrl(workflow, url))
    .map(workflow => ({ kind: 'workflow' as const, workflowName: workflow.name, description: workflow.description }));
  return [...pluginTools, ...savedWorkflows].slice(0, MAX_CANDIDATES);
}

function describeCandidate(candidate: RoutingCandidate): string {
  return candidate.kind === 'plugin_tool'
    ? `Plugin tool ${candidate.toolName} of ${candidate.pluginName}: ${candidate.description}`
    : `Saved workflow ${candidate.workflowName}: ${candidate.description}`;
}

export function buildPluginRoutingRequest(task: string, url: string, candidates: readonly RoutingCandidate[]) {
  return {
    state: { task, url },
    questions: {
      [PLUGIN_ROUTING_CHOICE_ID]: {
        type: 'choice' as const,
        instructions:
          'Which of these plugin tools or saved workflows is the right one to run for `state.task` on `state.url`? ' +
          'Pick the closest match.',
        criteria: Object.fromEntries(
          candidates.map((candidate, index) => [candidateKey(index), describeCandidate(candidate)]),
        ),
      },
      [PLUGIN_ROUTING_SOLVES_ID]: {
        type: 'noul' as const,
        instructions:
          'Does one of these candidates fully solve `state.task` on its own, with no other browser steps needed?',
      },
    },
  };
}

/** The candidate to hint at, or null when Jev is not confident that one candidate solves the task. */
export function decidePluginRouting(
  answers: JevAnswers,
  candidates: readonly RoutingCandidate[],
  threshold: number,
): RoutingCandidate | null {
  const which = readChoice(answers, PLUGIN_ROUTING_CHOICE_ID);
  const solves = readNoul(answers, PLUGIN_ROUTING_SOLVES_ID);
  if (!which || solves === null || which.confidence < threshold || solves < threshold) return null;
  const index = candidates.findIndex((_, position) => candidateKey(position) === which.choice);
  return index === -1 ? null : candidates[index];
}

/** Hint for the navigator's first step. It names only the kind and identifiers, never the plugin or workflow text. */
export function pluginHintText(candidate: RoutingCandidate): string {
  return candidate.kind === 'plugin_tool'
    ? `A browser plugin tool fits this task: run tool "${candidate.toolName}" of plugin "${candidate.pluginName}" with call_plugin_tool before other steps, filling its arguments from the task.`
    : `A saved workflow fits this task: run workflow "${candidate.workflowName}" with run_workflow before other steps, filling its variables from the task.`;
}
