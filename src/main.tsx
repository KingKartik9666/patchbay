import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startLaunch } from './launch/launch';
import { App } from './app/App';
import './style.css';
import './diagram/diagram.css';
import './editor/editor.css';
import './reference.css';
import './motion/springs.css';
import './app/app.css';
// The stage is already playing (index.html); attach before React mounts so the
// hand-off and the clean-up never depend on the first render.
startLaunch();
const container = document.getElementById('app');
if (!container) throw new Error('Patchbay application host is missing.');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
