import type { JevAnswers } from './runtime';
import { readNoul } from './runtime';

/**
 * Optional action groups. Actions that belong to no group (click, fill, type, press, navigation, scroll, done,
 * get_text, wait, ask_user, todo, ...) are always offered, so the core flow never depends on routing.
 */
export const ACTION_GROUPS = {
  forms: {
    actions: [
      'input_text',
      'send_keys',
      'get_dropdown_options',
      'select_dropdown_option',
      'click_at',
      'hover',
      'drag',
      'switch_frame',
    ],
    description: 'the task selects form options, uses coordinate clicks, drags, hovers or enters an iframe',
  },
  tabs: {
    actions: ['switch_tab', 'open_tab', 'close_tab'],
    description: 'the task works across several browser tabs',
  },
  files: {
    actions: ['upload_file', 'capture_download', 'list_downloads'],
    description: 'the task uploads a file or downloads and checks a file',
  },
  captcha: {
    actions: ['find_captcha', 'solve_captcha'],
    description: 'the page shows a captcha the task has to pass',
  },
  monitors: {
    actions: ['start_monitor', 'monitor_status', 'await_monitor', 'stop_monitor'],
    description: 'the task watches a page for a change over time',
  },
  siteTools: {
    actions: ['list_site_tools', 'call_site_tool'],
    description: 'the page exposes site tools (WebMCP) that the task should use',
  },
  plugins: {
    actions: ['list_plugins', 'call_plugin_tool', 'save_plugin', 'run_workflow'],
    description: 'the task uses browser plugins or saved workflows',
  },
  mcp: {
    actions: ['list_mcp_tools', 'call_mcp_tool'],
    description: 'the task needs an external MCP server tool',
  },
  host: {
    actions: ['shell_exec', 'fs_read', 'fs_write', 'fs_list', 'fs_search'],
    description: 'the task reads or writes local files or runs a shell command on this computer',
  },
  visual: {
    actions: ['screenshot', 'read_theme', 'audit_contrast', 'resize_viewport'],
    description: 'the task checks the visual look: screenshots, theme, colour contrast or viewport size',
  },
  diagnostics: {
    actions: [
      'read_console_messages',
      'read_network_requests',
      'page_info',
      'find_progress',
      'execute_javascript',
      'wait_for_element',
    ],
    description: 'the task inspects console, network or page internals, or runs page JavaScript',
  },
} as const;

export type ActionGroup = keyof typeof ACTION_GROUPS;

const GROUPS = Object.keys(ACTION_GROUPS) as ActionGroup[];

const GROUP_BY_ACTION = new Map<string, ActionGroup>(
  GROUPS.flatMap(group => (ACTION_GROUPS[group].actions as readonly string[]).map(action => [action, group] as const)),
);

export function actionGroupOf(actionName: string): ActionGroup | null {
  return GROUP_BY_ACTION.get(actionName) ?? null;
}

/** Host of a page URL, or '' for a blank or invalid URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

const groupQuestionId = (group: ActionGroup) => `group_${group}`;

export function buildToolRoutingRequest(task: string, host: string) {
  return {
    state: { task, host },
    questions: Object.fromEntries(
      GROUPS.map(group => [
        groupQuestionId(group),
        {
          type: 'noul' as const,
          instructions:
            `Is this needed to complete \`state.task\` on \`state.host\`: ${ACTION_GROUPS[group].description}? ` +
            'Answer no when the task does not need it.',
        },
      ]),
    ),
  };
}

/**
 * Groups to keep for the navigator. A group is dropped only on a clear no (below the threshold); a group with no
 * answer is kept, so a partial answer never removes a tool that might be needed.
 */
export function selectActionGroups(answers: JevAnswers, threshold: number): ActionGroup[] {
  return GROUPS.filter(group => {
    const needed = readNoul(answers, groupQuestionId(group));
    return needed === null || needed >= threshold;
  });
}

/** Names to offer to the model: every ungrouped action plus the members of the selected groups. */
export function actionNamesForGroups(allActionNames: readonly string[], selected: readonly ActionGroup[]): Set<string> {
  const keep = new Set<ActionGroup>(selected);
  return new Set(
    allActionNames.filter(name => {
      const group = actionGroupOf(name);
      return group === null || keep.has(group);
    }),
  );
}
