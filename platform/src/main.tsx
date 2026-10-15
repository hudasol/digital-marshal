import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './styles/app.css';
import { App } from './app/App';
import { hasWebGL2 } from './render/quality';
import { useStore } from './app/store';
import { controller } from './app/controller';
import { tour } from './app/tour';

if (!hasWebGL2()) useStore.getState().setWebgl(false);

// Read-only engineering hook for automated browser checks and the engineering inspector.
(window as unknown as { digitalMarshal: typeof controller }).digitalMarshal = controller;
(window as unknown as { digitalMarshalTour: typeof tour }).digitalMarshalTour = tour;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
