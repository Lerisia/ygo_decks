import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router-dom";
import { TrackerProvider } from './context/TrackerContext'
import './index.css'
import './tailwind.css'
import App from './App.tsx'

// The service worker no longer keeps its own copy of /media pictures; free the old copy on phones.
if ("caches" in window) caches.delete("media-cache").catch(() => {});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TrackerProvider>
        <App />
      </TrackerProvider>
    </BrowserRouter>
  </StrictMode>
);
