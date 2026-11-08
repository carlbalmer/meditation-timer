import { defineConfig } from 'vite';

// Preview is reached through `tailscale serve` on the tailnet (bound to 127.0.0.1 only).
export default defineConfig({ base: '/meditation-timer/', preview: { allowedHosts: ['.ts.net'] } });
