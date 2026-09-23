import '@maxhub/max-ui/dist/styles.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ensureWebApp } from './bridge';

const root = createRoot(document.getElementById('root') as HTMLElement);

try {
  ensureWebApp();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (e) {
  root.render(
    <div className="center">
      <div className="h2">Откройте приложение из чата с ботом в MAX</div>
      <div className="muted">{(e as Error).message}</div>
    </div>,
  );
}
