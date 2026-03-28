import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router-dom";
import { TrackerProvider } from './context/TrackerContext'
import './index.css'
import './tailwind.css'
import App from './App.tsx'

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TrackerProvider>
        <App />
      </TrackerProvider>
    </BrowserRouter>
  </StrictMode>
);
