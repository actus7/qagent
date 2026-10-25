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

export const clickActionSchema = {
  name: 'click',
  description: 'Click element by selector',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField,
  }),
} satisfies ActionSchema;

export const fillActionSchema = {
  name: 'fill',
  description: 'Clear and fill text in an input element',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField,
    text: z.string().describe('text to fill'),
  }),
} satisfies ActionSchema;

export const typeActionSchema = {
  name: 'type',
  description: 'Type text in an element without clearing existing content first',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField,
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
  description: 'Get element text by selector',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    selector: selectorField,
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
    'Attach a file to a file input (<input type=file>) by index. Either provide the file name and its full text content, or set "attachment" to the exact name of a file the user attached to this task (use this for binary files such as PDFs or images); use it for forms that require an upload',
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
