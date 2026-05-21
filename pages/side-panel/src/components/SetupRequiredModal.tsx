import React from 'react';
import { FiX } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { Button } from '@src/components/ui/button';
import { Card } from '@src/components/ui/card';

interface SetupRequiredModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

const SetupRequiredModal: React.FC<SetupRequiredModalProps> = ({ onClose, onOpenSettings }) => {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-[90%] max-w-sm overflow-hidden border-border bg-background p-4 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{t('setup_modal_title')}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-8"
            aria-label={t('setup_modal_close_a11y')}>
            <FiX className="size-5" />
          </Button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">{t('setup_modal_description')}</p>

        <Button onClick={onOpenSettings} className="w-full">
          {t('welcome_openSettings')}
        </Button>
      </Card>
    </div>
  );
};

export default SetupRequiredModal;
