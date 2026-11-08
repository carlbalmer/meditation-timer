import { defineConfig } from 'vite';

// Preview is reached through `tailscale serve` on the tailnet (bound to 127.0.0.1 only).
export default defineConfig({
  base: '/meditation-timer/',
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  preview: { allowedHosts: ['.ts.net'] },
});
