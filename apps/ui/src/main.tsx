import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Every typeface is bundled: nothing is fetched from the internet.
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/outfit';
import '@fontsource-variable/nunito';
import '@fontsource-variable/orbitron';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/surfaces.css';
import './styles/controls.css';
import './styles/motion.css';
import './styles/shell.css';
import './styles/layers.css';
import './styles/fx.css';
import './styles/album.css';
import './styles/overlays.css';
import './styles/pages.css';
import './styles/widgets.css';
import './styles/media.css';
import './styles/settings.css';
import './styles/apps.css';
import { App } from './App';
import { CrashScreen, ErrorBoundary } from './components/ErrorBoundary';
import { DeviceFrame } from './shell/DeviceFrame';
import { installKioskDragScroll } from './lib/kioskInput';
import { useHeadUnit } from './store';

installKioskDragScroll();
// Development only: lets browser tests and screenshots drive the store directly.
if (import.meta.env.DEV) (window as unknown as { __hu: typeof useHeadUnit }).__hu = useHeadUnit;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={<CrashScreen />}>
      <DeviceFrame>
        <App />
      </DeviceFrame>
    </ErrorBoundary>
  </StrictMode>,
);
