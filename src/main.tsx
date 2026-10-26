import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './style.css';
import './diagram/diagram.css';
import './editor/editor.css';
import './reference.css';
import './app/app.css';
const container = document.getElementById('app');
if (!container) throw new Error('Patchbay application host is missing.');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
