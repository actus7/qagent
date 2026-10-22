import { isVerboseLoggingEnabled, subscribeLogEntries } from '../log';
import { agentBrowserCompanionClient } from '../state/browserSession';
import { postToPanel } from './panelPort';

// Forwards companion status/frames and verbose debug logs to the connected side panel.
export function registerPanelForwarders(): void {
  agentBrowserCompanionClient.onStatus(status => {
    postToPanel({ type: 'browser_status', status });
  });

  agentBrowserCompanionClient.onFrame(frame => {
    postToPanel({ type: 'browser_frame', frame });
  });

  subscribeLogEntries(entry => {
    if (!isVerboseLoggingEnabled()) {
      return;
    }
    postToPanel({ type: 'debug_log', entry });
  });
}
