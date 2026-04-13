import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './lib/i18n';
import { initSettings } from './lib/settingsApi';
import 'katex/dist/katex.min.css';
import './styles.css';

// Load server-persisted settings into localStorage before React renders
// so every component reads the values that belong to *this* installation.
initSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
});
