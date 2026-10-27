// Without chrome.debugger there is no Page.javascriptDialogOpening event, so a blocking alert/confirm/prompt
// would freeze the page and every later executeScript. These functions run in the page's MAIN world (serialized
// by chrome.scripting, so each is self-contained) and replace the dialogs with recorded, non-blocking ones.

interface RecordedDialog {
  type: 'alert' | 'confirm' | 'prompt';
  message: string;
  accepted: boolean;
}

interface DialogWindow {
  __qagentDialogs?: RecordedDialog[];
  __qagentNextDialog?: { accept: boolean; promptText?: string } | null;
}

/** Installs the replacements once per document. confirm/prompt are dismissed unless an answer was chosen. */
export function installDialogGuard(): true {
  const w = window as unknown as DialogWindow;
  if (w.__qagentDialogs) return true;
  w.__qagentDialogs = [];
  w.__qagentNextDialog = null;
  const record = (type: RecordedDialog['type'], message: unknown, accepted: boolean) =>
    w.__qagentDialogs?.push({ type, message: String(message ?? '').slice(0, 500), accepted });
  const takeAnswer = () => {
    const answer = w.__qagentNextDialog ?? null;
    w.__qagentNextDialog = null;
    return answer;
  };
  window.alert = (message?: unknown) => {
    record('alert', message, true);
  };
  window.confirm = (message?: string) => {
    const accepted = takeAnswer()?.accept ?? false;
    record('confirm', message, accepted);
    return accepted;
  };
  window.prompt = (message?: string, defaultValue?: string) => {
    const answer = takeAnswer();
    const accepted = answer?.accept ?? false;
    record('prompt', message, accepted);
    return accepted ? (answer?.promptText ?? defaultValue ?? '') : null;
  };
  return true;
}

/** Returns and clears the dialogs recorded since the last call. */
export function takeRecordedDialogs(): RecordedDialog[] {
  const w = window as unknown as DialogWindow;
  return w.__qagentDialogs ? w.__qagentDialogs.splice(0) : [];
}

export function setNextDialogAnswer(accept: boolean, promptText: string | null): true {
  (window as unknown as DialogWindow).__qagentNextDialog = { accept, promptText: promptText ?? undefined };
  return true;
}
