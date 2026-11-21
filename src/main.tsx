import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { startPwa } from './app/pwa';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

startPwa();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
