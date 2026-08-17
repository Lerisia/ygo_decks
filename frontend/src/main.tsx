import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router-dom";
import { TrackerProvider } from './context/TrackerContext'
import './index.css'
import './tailwind.css'
import App from './App.tsx'

// One-shot cache invalidation: unregister stale service workers and purge
// caches, then reload. Bump the flag string to trigger again in the future.
const BUST_FLAG = "cache-busted-2026-06-21-delete-button-fix";
if (typeof window !== "undefined" && !localStorage.getItem(BUST_FLAG)) {
  localStorage.setItem(BUST_FLAG, "1");
  (async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* ignore */
    } finally {
      window.location.reload();
    }
  })();
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <TrackerProvider>
          <App />
        </TrackerProvider>
      </BrowserRouter>
    </StrictMode>
  );
}
