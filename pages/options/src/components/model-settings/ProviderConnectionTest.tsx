import { useState } from 'react';
import { t } from '@extension/i18n';
import { Button } from '@extension/ui';

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'ok' } | { status: 'failed'; error: string };

interface ProviderTestResponse {
  ok?: boolean;
  error?: string;
}

/** Runs one minimal request through the saved provider config in the background. The key never leaves storage. */
export function ProviderConnectionTest({ providerId, disabled }: { providerId: string; disabled: boolean }) {
  const [state, setState] = useState<TestState>({ status: 'idle' });

  const handleTest = async () => {
    setState({ status: 'testing' });
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'qagent:test-provider',
        providerId,
      })) as ProviderTestResponse | undefined;
      setState(response?.ok ? { status: 'ok' } : { status: 'failed', error: response?.error ?? t('options_test_failed') });
    } catch {
      setState({ status: 'failed', error: t('options_test_failed') });
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <Button
        variant="secondary"
        disabled={disabled || state.status === 'testing'}
        title={disabled ? t('options_test_saveFirst') : undefined}
        onClick={() => void handleTest()}>
        {state.status === 'testing' ? t('options_test_testing') : t('options_test_btn')}
      </Button>
      <p role="status" className="text-sm">
        {state.status === 'ok' && <span className="text-primary">{t('options_test_success')}</span>}
        {state.status === 'failed' && <span className="text-destructive">{state.error}</span>}
      </p>
    </div>
  );
}
