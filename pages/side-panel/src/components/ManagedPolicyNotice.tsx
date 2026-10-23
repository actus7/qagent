import { t } from '@extension/i18n';
import { useManagedPolicy } from '../hooks/useManagedPolicy';

/** Small notice shown above the composer while enterprise restrictions are active. */
export default function ManagedPolicyNotice() {
  const { restricted } = useManagedPolicy();
  if (!restricted) return null;
  return (
    <p className="assistant-composer-caption" role="note">
      {t('chat_managed_notice')}
    </p>
  );
}
