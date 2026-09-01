/* SPDX-License-Identifier: GPL-3.0-or-later */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import './styles/base.css';

/*
 * Inside Tauri the window itself is an NSVisualEffectView, so the app must be
 * TRANSPARENT and let the real material show through. In a plain browser there
 * is no such layer, so the CSS material stands in. One attribute switches
 * between them; nothing else in the stylesheet needs to know.
 */
if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
  document.documentElement.dataset.shell = 'tauri';
}

/*
 * The OS matters separately from the shell: only the mac window has vibrancy
 * behind the page and overlays its controls on it. Read synchronously from the
 * user agent — the Tauri platform APIs are async, and this attribute has to
 * exist before the first paint or the window flashes the wrong material.
 */
document.documentElement.dataset.platform = navigator.userAgent.includes('Mac')
  ? 'mac'
  : navigator.userAgent.includes('Windows')
    ? 'windows'
    : 'linux';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A crash above the per-pane boundaries replaces the whole window with
      * the fallback — which still beats the alternative, a silent white
      * screen with the error only in a devtools console nobody has open. */}
    <ErrorBoundary label="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
