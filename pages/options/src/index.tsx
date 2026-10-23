import { createRoot } from 'react-dom/client';
import '@extension/tailwindcss-config/tokens.css';
import '@src/index.css';
import Options from '@src/Options';
import { LanguageProvider } from '@extension/shared';

function init() {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  appContainer.className = 'min-w-[768px]';
  root.render(
    <LanguageProvider>
      <Options />
    </LanguageProvider>,
  );
}

init();
