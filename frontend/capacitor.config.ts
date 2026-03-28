import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elyss.ygodecks',
  appName: 'YGODecks',
  webDir: 'dist',
  server: {
    url: 'https://ygodecks.com',
    cleartext: false,
  },
};

export default config;
