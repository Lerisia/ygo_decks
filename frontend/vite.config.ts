import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.png", "pwa-192.png", "pwa-512.png", "pwa-maskable-192.png", "pwa-maskable-512.png"],
      manifest: {
        name: "YGO Decks",
        short_name: "YGO Decks",
        description: "유희왕 마스터 듀얼 덱 추천 및 관리",
        theme_color: "#1e3a5f",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        // Square icons; the maskable ones keep the logo inside the safe zone so Android's round/squircle mask
        // doesn't clip the triangle's corners (특이점 2026-10-02).
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache hashed assets only. The HTML shell is excluded so the
        // browser always fetches the latest index (which references the new
        // hashed bundles) on every navigation — game pages get the latest
        // build without users needing to manually refresh.
        // Only what the first screen needs: a page's own code arrives when it is first opened (2026-10-12), and
        // precaching every page would fetch the whole site in the background on a first visit.
        globPatterns: ["assets/index-*.{js,css}", "assets/react-*.js", "**/*.{svg,woff2}"],
        // Take over open tabs immediately when a new SW is installed and
        // drop stale caches. Critical for fast iteration: a deploy reaches
        // every connected client within seconds.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/admin/, /^\/api/, /^\/ws/],
        // Always go to the network for API + WebSocket — never cache
        // gameplay-critical responses. /media is left to the browser cache (nginx: expires max); the worker's own
        // copy re-fetched every picture in the background on each view (2026-10-06).
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      // Point at the live nginx so the dev frontend talks to the
      // production daphne. nginx 80→443 redirects, so we hit https
      // directly. `secure: false` skips cert validation (live cert is
      // for the real domain, not localhost). Revert to localhost:8000
      // if running a local backend.
      "/api": {
        target: "https://localhost",
        changeOrigin: true,
        secure: false,
      },
      "/media": {
        target: "https://localhost",
        changeOrigin: true,
        secure: false,
      },
      "/ws": {
        target: "wss://localhost",
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React itself in a chunk of its own, which changes far less often than the site. Only React: matching any
        // package with "react" in its path pulled the markdown editor, CodeMirror and the rest into it (2026-10-12).
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) return "react";
        },
        // a chunk from a package's index.js is not named index: index-* is the entry alone, which the worker precaches
        chunkFileNames: (chunk) => (chunk.name === "index" ? "assets/chunk-[hash].js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
