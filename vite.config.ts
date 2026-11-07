import { defineConfig, type Plugin } from 'vite';
import { mediaVersions, MEDIA_DIRS } from './scripts/media.mjs';

const ID = 'virtual:media';

function media(): Plugin {
  let base = '/';
  return {
    name: 'media-manifest',
    configResolved: config => void (base = config.base),
    transformIndexHtml: async () => {
      const poster = 'scenes/waterfall/poster.webp';
      const version = (await mediaVersions('public'))[poster];
      return version ? [{ tag: 'link', attrs: { rel: 'preload', as: 'image', href: `${base}${poster}?v=${version}` }, injectTo: 'head' }] : [];
    },
    resolveId: id => (id === ID ? '\0' + ID : undefined),
    load: async id => (id === '\0' + ID ? `export default ${JSON.stringify(await mediaVersions('public'))};` : undefined),
    configureServer(server) {
      const changed = (file: string) => {
        if (!MEDIA_DIRS.some(dir => file.includes(`/public/${dir}/`))) return;
        const module = server.moduleGraph.getModuleById('\0' + ID);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', changed).on('change', changed).on('unlink', changed);
    },
  };
}

// Preview is reached through `tailscale serve` on the tailnet (bound to 127.0.0.1 only).
export default defineConfig({ base: '/meditation-timer/', plugins: [media()], preview: { allowedHosts: ['.ts.net'] } });
