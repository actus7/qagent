import { createRoot } from 'react-dom/client';
import '@src/index.css';
import SidePanel from '@src/SidePanel';

import { LanguageProvider } from './context/LanguageContext';

function init() {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  root.render(
    <LanguageProvider>
      <SidePanel />
    </LanguageProvider>
  );
}

init();
