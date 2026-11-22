import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OptionsPage } from './OptionsPage';
import './options.css';
import './options-v2.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Options page root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <OptionsPage />
  </StrictMode>,
);
