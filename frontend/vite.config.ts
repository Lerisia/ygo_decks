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
      includeAssets: ["logo.png"],
      manifest: {
        name: "YGO Decks",
        short_name: "YGO Decks",
        description: "유희왕 마스터 듀얼 덱 추천 및 관리",
        theme_color: "#1e3a5f",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/logo.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Precache hashed assets only. The HTML shell is excluded so the
        // browser always fetches the latest index (which references the new
        // hashed bundles) on every navigation — game pages get the latest
        // build without users needing to manually refresh.
        globPatterns: ["**/*.{js,css,svg,woff2}"],
        // Take over open tabs immediately when a new SW is installed and
        // drop stale caches. Critical for fast iteration: a deploy reaches
        // every connected client within seconds.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/admin/, /^\/api/, /^\/ws/],
        // Always go to the network for API + WebSocket — never cache
        // gameplay-critical responses.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/media/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "media-cache",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
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
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react")) return "react";
            if (id.includes("lodash")) return "lodash";
            if (id.includes("tailwindcss")) return "tailwind";
          }
        },
      },
    },
  },
});
