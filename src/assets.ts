import versions from 'virtual:media';

export type SceneMeta = { loopSeconds: number; focusX: number; focusY: number; light: [number, number, number] };
export type SceneAssets = {
  id: string;
  poster: string | null;
  loop: string | null;
  depth: string | null;
  meta: SceneMeta;
};

export const SCENES = ['waterfall', 'bridge'];
const DEFAULT_META: SceneMeta = { loopSeconds: 8, focusX: 0.5, focusY: 0.45, light: [255, 236, 205] };

export function url(path: string) {
  const version = versions[path];
  return version ? `${import.meta.env.BASE_URL}${path}?v=${version}` : null;
}

const probe = document.createElement('video');
const av1 = probe.canPlayType('video/webm; codecs="av01.0.05M.08"') === 'probably';
const opus = new Audio().canPlayType('audio/webm; codecs="opus"') !== '';

const video = (stem: string) => (av1 && url(`${stem}.webm`)) || url(`${stem}.mp4`);
const sound = (stem: string) => (opus && url(`${stem}.webm`)) || url(`${stem}.m4a`);

export async function scene(id: string): Promise<SceneAssets> {
  const base = `scenes/${id}`;
  const metaUrl = url(`${base}/meta.json`);
  const meta = metaUrl ? await fetch(metaUrl).then(r => r.json()).catch(() => ({})) : {};
  return {
    id,
    poster: url(`${base}/poster.webp`),
    loop: video(`${base}/loop`),
    depth: url(`${base}/depth.webp`),
    meta: { ...DEFAULT_META, ...meta },
  };
}

export const turnClip = (from: string, to: string) => video(`scenes/turn/${from}-to-${to}`);
export const water = (sceneId: string) => sound(`audio/water/${sceneId}`);
export const credits = () => url('audio/CREDITS.md');

export const bowls = [...new Set(Object.keys(versions)
  .map(path => /^audio\/bowls\/([^/]+)\.(webm|m4a)$/.exec(path)?.[1])
  .filter((id): id is string => !!id))]
  .sort()
  .map(id => ({ id, url: sound(`audio/bowls/${id}`)! }))
  .filter(bowl => bowl.url);

export const offlineUrls = () => [
  ...SCENES.flatMap(id => [`scenes/${id}/poster.webp`, `scenes/${id}/depth.webp`, `scenes/${id}/meta.json`].map(url)),
  ...SCENES.flatMap(id => [video(`scenes/${id}/loop`), water(id)]),
  ...SCENES.flatMap(from => SCENES.filter(to => to !== from).map(to => turnClip(from, to))),
  ...bowls.map(bowl => bowl.url),
  credits(),
].filter((u): u is string => !!u);
