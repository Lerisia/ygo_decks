// Local-only override: proxy /api to a Django dev server instead of the live nginx.
// usage: npx vite --config vite.local.config.ts --port 5199
import { mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(base, {
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8123", changeOrigin: true, secure: false },
      "/media": { target: "http://127.0.0.1:8123", changeOrigin: true, secure: false },
    },
  },
});
