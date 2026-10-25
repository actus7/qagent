interface SidebarActionApi {
  open(): Promise<void>;
}

/**
 * Opens the agent UI. Chromium uses its side panel for the window; Firefox uses the sidebar_action, which opens in
 * the current window. Both need a user gesture, so callers invoke this before any other await.
 */
export function openAgentPanel(windowId: number): Promise<void> {
  if (chrome.sidePanel) {
    return chrome.sidePanel.open({ windowId });
  }
  const sidebar = (chrome as unknown as { sidebarAction?: SidebarActionApi }).sidebarAction;
  if (!sidebar) return Promise.reject(new Error('This browser has no side panel or sidebar'));
  return sidebar.open();
}
