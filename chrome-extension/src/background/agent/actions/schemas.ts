import { z } from 'zod';

export interface ActionSchema {
  name: string;
  description: string;
  schema: z.ZodType;
}

export const doneActionSchema = {
  name: 'done',
  description: 'Complete task',
  schema: z.object({
    text: z.string(),
    success: z.boolean(),
  }),
} satisfies ActionSchema;

export const USER_TAKEOVER_REASONS = [
  'authentication',
  'captcha',
  'two_factor',
  'payment',
  'user_requested',
  'other',
] as const;

// Pauses the task so the user can do a step only they can do (a 2FA code on their phone, credentials not given).
export const requestUserTakeoverActionSchema = {
  name: 'request_user_takeover',
  description:
    'Pause the task and hand the browser to the user for a step only they can do: a two-factor code on their device, or credentials or payment data the task did not provide. The task resumes when the user returns control.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    reason: z.enum(USER_TAKEOVER_REASONS).describe('why the user must act'),
    message: z.string().describe('short instruction for the user, in the language of the task'),
  }),
} satisfies ActionSchema;

const selectorField = z
  .string()
  .describe('selector to target an element. Prefer refs from snapshot (ex: @e12). CSS selectors are also supported.');

// agent-browser style navigation actions
export const openActionSchema = {
  name: 'open',
  description: 'Navigate to URL in the current tab',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string(),
  }),
} satisfies ActionSchema;

export const backActionSchema = {
  name: 'back',
  description: 'Go back to the previous page',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const forwardActionSchema = {
  name: 'forward',
  description: 'Go forward to the next page in history',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const reloadActionSchema = {
  name: 'reload',
  description: 'Reload current page',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

// Readable alternative to a ref: match by visible text and role, pick the nth (0-based) match.
const targetField = z
  .object({
    selector: z.string().optional().describe('CSS selector to search within (default: interactive elements)'),
    text: z.string().optional().describe('visible text the element contains, case-insensitive'),
    role: z.string().optional().describe('ARIA role or tag, e.g. button, link, textbox'),
    nth: z.number().int().nonnegative().optional().describe('0-based index when several elements match, default 0'),
  })
  .describe('readable target {text, role, nth}, used when no ref fits');

export const clickActionSchema = {
  name: 'click',
  description: 'Click element by selector or readable target',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField.optional(),
    target: targetField.optional(),
  }),
} satisfies ActionSchema;

export const fillActionSchema = {
  name: 'fill',
  description: 'Clear and fill text in an input element',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField.optional(),
    target: targetField.optional(),
    text: z.string().describe('text to fill'),
  }),
} satisfies ActionSchema;

export const typeActionSchema = {
  name: 'type',
  description: 'Type text in an element without clearing existing content first',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField.optional(),
    target: targetField.optional(),
    text: z.string().describe('text to type'),
  }),
} satisfies ActionSchema;

export const pressActionSchema = {
  name: 'press',
  description: 'Press keyboard keys like Enter, Tab, Backspace and combinations like Control+o or Control+Shift+T',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    key: z.string().describe('key or shortcut to send'),
  }),
} satisfies ActionSchema;

export const scrollActionSchema = {
  name: 'scroll',
  description: 'Scroll the page by direction and optional pixels',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    direction: z.enum(['up', 'down', 'left', 'right']).describe('scroll direction'),
    pixels: z.number().int().positive().optional().describe('pixel amount to scroll'),
  }),
} satisfies ActionSchema;

export const scrollIntoViewActionSchema = {
  name: 'scrollintoview',
  description: 'Scroll the target element into view',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField,
  }),
} satisfies ActionSchema;

export const snapshotActionSchema = {
  name: 'snapshot',
  description: 'Get current interactive elements snapshot with refs',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const getTextActionSchema = {
  name: 'get_text',
  description:
    'Get element text by selector or target, or the whole page when neither is given. Long text comes in groups: when the reply has a cursor, pass it back to read on',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField.optional(),
    target: targetField.optional(),
    max_length: z.number().int().min(100).max(200000).default(20000).describe('characters per group'),
    cursor: z.string().max(32).optional().describe('cursor from the previous group; omit to read from the top'),
  }),
} satisfies ActionSchema;

export const pageInfoActionSchema = {
  name: 'page_info',
  description:
    'Structural summary of the page: URL, title, landmarks, headings and the links, buttons, fields and forms with their ARIA state. Lists up to max_per_kind items per kind and reports the true totals. Use it to orient before snapshot',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    max_per_kind: z.number().int().min(1).max(50).default(15).describe('items listed per kind'),
    geometry: z.boolean().default(false).describe('add bounding boxes to each item'),
  }),
} satisfies ActionSchema;

export const findProgressActionSchema = {
  name: 'find_progress',
  description:
    'Find progress signals on the page: progress bars, percent text, spinners and busy regions. Use it to decide whether to wait for a job or ask the user',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const waitForElementActionSchema = {
  name: 'wait_for_element',
  description:
    'Wait until a target reaches a state: attached, visible, hidden or detached. Prefer it over a fixed wait action',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField.optional(),
    target: targetField.optional(),
    state: z.enum(['attached', 'visible', 'hidden', 'detached']).default('visible').describe('state to wait for'),
    timeout_ms: z.number().int().positive().max(30000).default(5000).describe('give up after this many ms'),
  }),
} satisfies ActionSchema;

export const switchFrameActionSchema = {
  name: 'switch_frame',
  description:
    'Scope snapshot and element actions to one frame, including cross-origin iframes. Without index, lists the frames. Index 0 is the top document. Navigation of the top document returns to it',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nonnegative().optional().describe('frame index from the list'),
  }),
} satisfies ActionSchema;

export const getTitleActionSchema = {
  name: 'get_title',
  description: 'Get current page title',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const getUrlActionSchema = {
  name: 'get_url',
  description: 'Get current page URL',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

// Basic Navigation Actions
export const searchGoogleActionSchema = {
  name: 'search_google',
  description:
    'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    query: z.string(),
  }),
} satisfies ActionSchema;

export const goToUrlActionSchema = {
  name: 'go_to_url',
  description: 'Navigate to URL in the current tab',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string(),
  }),
} satisfies ActionSchema;

export const goBackActionSchema = {
  name: 'go_back',
  description: 'Go back to the previous page',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const clickElementActionSchema = {
  name: 'click_element',
  description: 'Click element by index',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the element'),
    xpath: z.string().nullable().optional().describe('xpath of the element'),
  }),
} satisfies ActionSchema;

export const inputTextActionSchema = {
  name: 'input_text',
  description: 'Input text into an interactive input element',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the element'),
    text: z.string().describe('text to input'),
    xpath: z.string().nullable().optional().describe('xpath of the element'),
  }),
} satisfies ActionSchema;

export const uploadFileActionSchema = {
  name: 'upload_file',
  description:
    'Attach a file to a file input (<input type=file>) by index. Either provide the file name and its full text content, set "attachment" to the exact name of a file the user attached to this task (use this for binary files such as PDFs or images), or set "path" to a local file such as a downloaded one; use it for forms that require an upload',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the file input element'),
    file_name: z.string().describe('file name including extension, e.g. report.csv'),
    content: z.string().nullable().optional().describe('full text content of the file (omit when using attachment)'),
    attachment: z
      .string()
      .nullable()
      .optional()
      .describe('exact name of a file attached by the user for this task; the bytes are uploaded unchanged'),
    path: z
      .string()
      .nullable()
      .optional()
      .describe('local file path, e.g. the path a download reports in list_downloads; the file is read by the browser'),
    mime_type: z.string().nullable().optional().describe('MIME type, e.g. text/csv; defaults to text/plain'),
  }),
} satisfies ActionSchema;

// Tab Management Actions
export const switchTabActionSchema = {
  name: 'switch_tab',
  description: 'Switch to tab by tab id',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    tab_id: z.number().int().describe('id of the tab to switch to'),
  }),
} satisfies ActionSchema;

export const openTabActionSchema = {
  name: 'open_tab',
  description: 'Open URL in new tab',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string().describe('url to open'),
  }),
} satisfies ActionSchema;

export const closeTabActionSchema = {
  name: 'close_tab',
  description: 'Close tab by tab id',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    tab_id: z.number().int().describe('id of the tab'),
  }),
} satisfies ActionSchema;

// Cache Actions
export const cacheContentActionSchema = {
  name: 'cache_content',
  description: 'Cache what you have found so far from the current page for future use',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    content: z.string().default('').describe('content to cache'),
  }),
} satisfies ActionSchema;

export const scrollToPercentActionSchema = {
  name: 'scroll_to_percent',
  description:
    'Scrolls to a particular vertical percentage of the document or an element. If no index of element is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    yPercent: z.number().int().describe('percentage to scroll to - min 0, max 100; 0 is top, 100 is bottom'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
} satisfies ActionSchema;

export const scrollToTopActionSchema = {
  name: 'scroll_to_top',
  description: 'Scroll the document in the window or an element to the top',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
} satisfies ActionSchema;

export const scrollToBottomActionSchema = {
  name: 'scroll_to_bottom',
  description: 'Scroll the document in the window or an element to the bottom',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
} satisfies ActionSchema;

export const previousPageActionSchema = {
  name: 'previous_page',
  description:
    'Scroll the document in the window or an element to the previous page. If no index is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
} satisfies ActionSchema;

export const nextPageActionSchema = {
  name: 'next_page',
  description:
    'Scroll the document in the window or an element to the next page. If no index is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
} satisfies ActionSchema;

export const scrollToTextActionSchema = {
  name: 'scroll_to_text',
  description: 'If you dont find something which you want to interact with in current viewport, try to scroll to it',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    text: z.string().describe('text to scroll to'),
    nth: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('which occurrence of the text to scroll to (1-indexed, default: 1)'),
  }),
} satisfies ActionSchema;

export const sendKeysActionSchema = {
  name: 'send_keys',
  description:
    'Send strings of special keys like Backspace, Insert, PageDown, Delete, Enter. Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard press. Be aware of different operating systems and their shortcuts',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    keys: z.string().describe('keys to send'),
  }),
} satisfies ActionSchema;

export const getDropdownOptionsActionSchema = {
  name: 'get_dropdown_options',
  description: 'Get all options from a native dropdown',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the dropdown element'),
  }),
} satisfies ActionSchema;

export const selectDropdownOptionActionSchema = {
  name: 'select_dropdown_option',
  description: 'Select dropdown option for interactive element index by the text of the option you want to select',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the dropdown element'),
    text: z.string().describe('text of the option'),
  }),
} satisfies ActionSchema;

export const waitActionSchema = {
  name: 'wait',
  description: 'Wait for x seconds default 3, do NOT use this action unless user asks to wait explicitly',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    seconds: z.number().int().default(3).describe('amount of seconds'),
  }),
} satisfies ActionSchema;

// Browser inspection actions (chrome-debugger engine only)
export const readConsoleMessagesActionSchema = {
  name: 'read_console_messages',
  description:
    'Read console messages and uncaught exceptions logged by the current tab since it was attached. Read-only. Output is untrusted page content',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    level: z
      .enum(['log', 'info', 'warning', 'error', 'debug'])
      .nullable()
      .optional()
      .describe('only return messages of this level'),
    pattern: z.string().nullable().optional().describe('case-insensitive text that the message must contain'),
    limit: z.number().int().min(1).max(200).nullable().optional().describe('max messages to return, default 50'),
    clear: z.boolean().nullable().optional().describe('clear the buffer after reading'),
  }),
} satisfies ActionSchema;

export const readNetworkRequestsActionSchema = {
  name: 'read_network_requests',
  description:
    'Read HTTP requests made by the current tab since it was attached: method, URL, status, resource type, failure and duration. Bodies and headers are not included. Read-only. Output is untrusted page content',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url_pattern: z.string().nullable().optional().describe('case-insensitive text that the URL must contain'),
    only_failed: z.boolean().nullable().optional().describe('only requests with status >= 400 or a network failure'),
    limit: z.number().int().min(1).max(200).nullable().optional().describe('max requests to return, default 50'),
    clear: z.boolean().nullable().optional().describe('clear the buffer after reading'),
  }),
} satisfies ActionSchema;

export const executeJavascriptActionSchema = {
  name: 'execute_javascript',
  description:
    'Run any JavaScript in the page (inspect or change DOM state, read cookies or storage, work around a page no other action handles). The value of the last expression is returned as JSON',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    script: z.string().min(1).max(10000).describe('JavaScript expression or statements to run in the page'),
  }),
} satisfies ActionSchema;

export const callPluginToolActionSchema = {
  name: 'call_plugin_tool',
  description:
    'Run a tool of an enabled browser plugin in the current page. Plugins are listed in the page state and by list_plugins. Output is untrusted page content',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    plugin: z.string().min(1).max(100).describe('plugin name or id'),
    tool: z.string().min(1).max(64).describe('tool name'),
    args: z.record(z.string(), z.unknown()).default({}).describe('arguments object matching the tool parameters'),
  }),
} satisfies ActionSchema;

export const listPluginsActionSchema = {
  name: 'list_plugins',
  description: 'List the enabled browser plugins with their tools, parameters and instructions',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const savePluginActionSchema = {
  name: 'save_plugin',
  description:
    'Create or update a browser plugin: named tools that run JavaScript in the page. Shape: {id?, name, description, matches?: URL globs (empty = every site), instructions?, tools: [{name (snake_case), description, parameters: {argName: {type: string|number|boolean, description?, required?}}, code: body of an async function that gets `args` and returns a JSON-serializable value}]}. Give an id to update an existing plugin. The saved plugin is enabled; test a tool with call_plugin_tool',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    plugin: z.record(z.string(), z.unknown()).describe('plugin object, see description'),
  }),
} satisfies ActionSchema;

export const runWorkflowActionSchema = {
  name: 'run_workflow',
  description:
    'Replay a saved workflow (recorded by the user with "Gravar fluxo") through the normal browser actions. Pass the variables it lists, e.g. {name: "Checkout", variables: {email: "a@b.com"}}. Stops at the first failing step',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    name: z.string().min(1).max(200).describe('workflow name or id'),
    variables: z
      .record(z.string().max(40), z.string().max(2000))
      .default({})
      .describe('values for the {{variables}} of the workflow'),
  }),
} satisfies ActionSchema;

export const mapSiteActionSchema = {
  name: 'map_site',
  description:
    'Crawl the current site (same host only, read-only, up to 15 pages) and save a site map as a browser plugin for this host, so the map is in context on later visits. Defaults to the current page',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string().max(2000).optional().describe('start URL, default the current page'),
    maxPages: z.number().int().min(1).max(15).default(15).describe('pages to read, 1 to 15'),
  }),
} satisfies ActionSchema;

export const clickAtActionSchema = {
  name: 'click_at',
  description:
    'Click at pixel coordinates of the viewport. Use only when no element index fits (canvas, maps, sliders). Coordinates are read from the latest screenshot when vision is on, otherwise CSS pixels',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    x: z.number().describe('x coordinate'),
    y: z.number().describe('y coordinate'),
    button: z.enum(['left', 'right', 'middle']).nullable().optional().describe('mouse button, default left'),
    click_count: z
      .number()
      .int()
      .min(1)
      .max(3)
      .nullable()
      .optional()
      .describe('1 for click, 2 for double click, 3 for triple click'),
    modifiers: z
      .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
      .nullable()
      .optional()
      .describe('modifier keys held during the click'),
  }),
} satisfies ActionSchema;

export const hoverActionSchema = {
  name: 'hover',
  description:
    'Move the mouse over an element (by index) or over pixel coordinates to reveal hover menus and tooltips. Provide index, or both x and y',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element to hover'),
    x: z.number().nullable().optional().describe('x coordinate (used when index is not given)'),
    y: z.number().nullable().optional().describe('y coordinate (used when index is not given)'),
  }),
} satisfies ActionSchema;

export const dragActionSchema = {
  name: 'drag',
  description:
    'Drag the mouse from one element or point to another (press, move in steps, release). Each end is an element index, or both x and y',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    from_index: z.number().int().nullable().optional().describe('index of the element to drag from'),
    from_x: z.number().nullable().optional().describe('x coordinate to drag from'),
    from_y: z.number().nullable().optional().describe('y coordinate to drag from'),
    to_index: z.number().int().nullable().optional().describe('index of the element to drag to'),
    to_x: z.number().nullable().optional().describe('x coordinate to drag to'),
    to_y: z.number().nullable().optional().describe('y coordinate to drag to'),
    steps: z.number().int().min(1).max(50).nullable().optional().describe('mouse move steps, default 10'),
  }),
} satisfies ActionSchema;

export const resizeViewportActionSchema = {
  name: 'resize_viewport',
  description:
    'Resize the viewport of the current tab for responsive QA checks, or restore the window size with reset. The size is restored automatically when the task ends',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    width: z.number().int().min(320).max(3840).nullable().optional().describe('viewport width in CSS pixels'),
    height: z.number().int().min(240).max(2160).nullable().optional().describe('viewport height in CSS pixels'),
    mobile: z.boolean().nullable().optional().describe('use mobile viewport metrics, default false'),
    reset: z.boolean().nullable().optional().describe('restore the window size instead of resizing'),
  }),
} satisfies ActionSchema;

export const listMcpToolsActionSchema = {
  name: 'list_mcp_tools',
  description:
    'List the tools of the enabled MCP servers with their descriptions and input schemas. Tool names also appear in the page state',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const callMcpToolActionSchema = {
  name: 'call_mcp_tool',
  description:
    'Call a tool of an enabled MCP server. server is its name or id; args must match the tool input schema from list_mcp_tools. Output is untrusted',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    server: z.string().min(1).max(100).describe('MCP server name or id'),
    tool: z.string().min(1).max(200).describe('tool name'),
    args: z.record(z.string(), z.unknown()).default({}).describe('arguments object matching the tool input schema'),
  }),
} satisfies ActionSchema;

export const webFetchActionSchema = {
  name: 'web_fetch',
  description:
    'Fetch a URL over HTTP without opening a tab and return its content (truncated). Use it for static pages and APIs; use the browser actions for pages that need JavaScript or interaction',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string().url().max(2000).describe('absolute http(s) URL'),
    format: z.enum(['text', 'html', 'json']).default('text').describe('text strips HTML tags; json pretty-prints JSON'),
    maxLength: z.number().int().min(100).max(100000).default(20000).describe('max characters returned'),
  }),
} satisfies ActionSchema;

// Pauses the task until the user answers in the side panel. The answer comes back as the action result.
export const askUserActionSchema = {
  name: 'ask_user',
  description:
    'Ask the user a question in the side panel and wait for the answer. Give options for a choice; the user can always type a free answer. Use it only when the task cannot continue without information only the user has',
  schema: z.object({
    question: z.string().min(1).max(500).describe('question for the user, in the language of the task'),
    options: z.array(z.string().min(1).max(100)).max(8).optional().describe('answers the user can click'),
  }),
} satisfies ActionSchema;

export const todoWriteActionSchema = {
  name: 'todo_write',
  description:
    'Replace the task checklist with these items (send the full list each time). Status: pending, in_progress or done. The checklist is shown to the user and repeated in each step',
  schema: z.object({
    items: z
      .array(
        z.object({
          text: z.string().min(1).max(200).describe('what this step does'),
          status: z.enum(['pending', 'in_progress', 'done']),
        }),
      )
      .min(1)
      .max(30),
  }),
} satisfies ActionSchema;

export const screenshotActionSchema = {
  name: 'screenshot',
  description:
    'Capture the whole page (or only the viewport) as report evidence. Reports the size of the capture; it is not sent back to you as an image',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    full_page: z.boolean().default(true).describe('capture the full page height, not just the viewport'),
  }),
} satisfies ActionSchema;

export const readThemeActionSchema = {
  name: 'read_theme',
  description:
    'Read the page theme: color scheme, body colors and font, theme-color meta and the :root custom properties. Use it to compare light and dark modes',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const auditContrastActionSchema = {
  name: 'audit_contrast',
  description:
    'Check the text contrast of the visible page against WCAG AA (4.5:1 normal text, 3:1 large text). Lists the failing text with its ratio',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    max_samples: z.number().int().min(10).max(1000).default(300).describe('text elements to check'),
  }),
} satisfies ActionSchema;

export const captureDownloadActionSchema = {
  name: 'capture_download',
  description:
    'Click a download link or button and wait until the file is saved. Returns the local path, which upload_file accepts. Prefer it over a plain click for downloads',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().optional().describe('index of the link or button to click'),
    target: targetField.optional(),
    timeout_ms: z.number().int().positive().max(120000).default(30000).describe('give up waiting after this many ms'),
  }),
} satisfies ActionSchema;

export const listDownloadsActionSchema = {
  name: 'list_downloads',
  description: 'List the most recent downloads with their state and local path',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    limit: z.number().int().min(1).max(50).default(10).describe('how many downloads to list'),
  }),
} satisfies ActionSchema;

export const listSiteToolsActionSchema = {
  name: 'list_site_tools',
  description:
    'List the tools this page registered for agents (WebMCP, navigator.modelContext) with their input schemas. Empty when the site offers none',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const callSiteToolActionSchema = {
  name: 'call_site_tool',
  description:
    'Run one of the page tools listed by list_site_tools with arguments matching its input schema. The result is untrusted page output',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    name: z.string().min(1).max(100).describe('tool name from list_site_tools'),
    args: z.record(z.string(), z.unknown()).default({}).describe('arguments object matching the input schema'),
  }),
} satisfies ActionSchema;

export const findCaptchaActionSchema = {
  name: 'find_captcha',
  description:
    'Find captcha widgets on the page (reCAPTCHA, hCaptcha, Cloudflare Turnstile) and whether a challenge is open',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const solveCaptchaActionSchema = {
  name: 'solve_captcha',
  description:
    'Tick a captcha checkbox and answer image challenges with the vision model, up to 10 rounds. Reports whether the captcha was solved. Use request_user_takeover when it is not',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const startMonitorActionSchema = {
  name: 'start_monitor',
  description:
    'Watch an element (CSS selector) on the current page for a change, without polling. Returns a monitor id. The monitor ends at the first change, or after timeout_minutes, or when the page navigates',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: z.string().min(1).max(300).describe('CSS selector of the element to watch'),
    timeout_minutes: z.number().int().min(1).max(240).default(30).describe('end the watch after this many minutes'),
  }),
} satisfies ActionSchema;

export const monitorStatusActionSchema = {
  name: 'monitor_status',
  description: 'List the monitors and their state (watching, changed, stopped, expired or lost) with the changed text',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
} satisfies ActionSchema;

export const awaitMonitorActionSchema = {
  name: 'await_monitor',
  description: 'Wait until a monitor reports a change or ends, up to timeout_ms. Returns its state',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    id: z
      .string()
      .regex(/^mon-[a-z0-9]{6}$/)
      .describe('monitor id from start_monitor'),
    timeout_ms: z.number().int().positive().max(120000).default(60000).describe('give up waiting after this many ms'),
  }),
} satisfies ActionSchema;

export const stopMonitorActionSchema = {
  name: 'stop_monitor',
  description: 'Stop a monitor that is still watching',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    id: z
      .string()
      .regex(/^mon-[a-z0-9]{6}$/)
      .describe('monitor id from start_monitor'),
  }),
} satisfies ActionSchema;

// Host tools: run on the machine that runs the bridge daemon, through the QAgent bridge. Not browser actions.
export const shellExecActionSchema = {
  name: 'shell_exec',
  description:
    'Run a shell command on the host machine (PowerShell on Windows, bash elsewhere) and return the exit code, stdout and stderr (capped). Use it for local tooling, not for the page',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    command: z.string().min(1).max(8000).describe('command line to run'),
    cwd: z.string().max(1024).optional().describe('working directory, defaults to the home folder'),
    timeoutMs: z.number().int().min(1000).max(600000).default(60000).describe('kill the command after this many ms'),
  }),
} satisfies ActionSchema;

export const fsReadActionSchema = {
  name: 'fs_read',
  description: 'Read a text file on the host machine, a window of lines (capped)',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    path: z.string().min(1).max(1024).describe('file path, absolute or relative to the daemon folder'),
    offset: z.number().int().min(0).default(0).describe('first line to return, 0-based'),
    limit: z.number().int().min(1).max(2000).default(200).describe('number of lines to return'),
  }),
} satisfies ActionSchema;

export const fsWriteActionSchema = {
  name: 'fs_write',
  description: 'Write a text file on the host machine, creating parent folders and replacing the file',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    path: z.string().min(1).max(1024).describe('file path, absolute or relative to the daemon folder'),
    content: z.string().max(2000000).describe('full file content'),
  }),
} satisfies ActionSchema;

export const fsListActionSchema = {
  name: 'fs_list',
  description: 'List the entries of a folder on the host machine (names and types, capped)',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    path: z.string().min(1).max(1024).describe('folder path'),
  }),
} satisfies ActionSchema;

export const fsSearchActionSchema = {
  name: 'fs_search',
  description:
    'Search text files under a folder on the host machine for a pattern (regex if it compiles, else literal, case-insensitive). Skips node_modules and .git',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    path: z.string().min(1).max(1024).describe('folder to search'),
    pattern: z.string().min(1).max(500).describe('text or regex to find'),
    maxResults: z.number().int().min(1).max(500).default(100).describe('stop after this many matches'),
  }),
} satisfies ActionSchema;
