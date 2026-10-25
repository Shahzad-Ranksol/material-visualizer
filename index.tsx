import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { LandingPage } from './components/LandingPage';
// Dev-only pages load lazily: in a production build `import.meta.env.DEV` is false, so they —
// and the analysis models they pull in — are left out of the bundle entirely
const ValidationApprovePage = import.meta.env.DEV ? lazy(() => import('./components/dev/ValidationApprovePage').then((m) => ({ default: m.ValidationApprovePage }))) : () => null;
const ValidationDashboardPage = import.meta.env.DEV ? lazy(() => import('./components/dev/ValidationDashboardPage').then((m) => ({ default: m.ValidationDashboardPage }))) : () => null;
const StyleLabPage = import.meta.env.DEV ? lazy(() => import('./components/dev/StyleLabPage').then((m) => ({ default: m.StyleLabPage }))) : () => null;
const SceneBakePage = import.meta.env.DEV ? lazy(() => import('./components/dev/SceneBakePage').then((m) => ({ default: m.SceneBakePage }))) : () => null;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/studio" element={<App />} />
        {/* Dev-server only: the validation set tools (validation/) */}
        {import.meta.env.DEV && <Route path="/dev/validation" element={<ValidationApprovePage />} />}
        {import.meta.env.DEV && <Route path="/dev/validation/results" element={<ValidationDashboardPage />} />}
        {/* Dev-server only: bakes the preset scenes' item masks (scenes/) */}
        {import.meta.env.DEV && <Route path="/dev/scenes" element={<SceneBakePage />} />}
        {/* Dev-server only: generates the AI design styles (scenes/styles.ts) */}
        {import.meta.env.DEV && <Route path="/dev/styles" element={<StyleLabPage />} />}
      </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
