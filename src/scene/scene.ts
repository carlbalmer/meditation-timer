import { scene as sceneAssets, turnClip, type SceneAssets } from '../assets.ts';
import { Effects, type Density } from './effects.ts';
import { Parallax } from './parallax.ts';

type View = {
  assets: SceneAssets;
  el: HTMLDivElement;
  poster: HTMLImageElement;
  video: HTMLVideoElement | null;
  depth: Promise<HTMLImageElement | null>;
  live: Promise<void>;
};

// Measured on the Pixel 6a: each composited frame costs ~1.5% of a core, and
// the atmosphere moves a few px/s, so a low frame rate looks the same.
const FPS = { setup: 12, session: 8, moving: 24 };
const PARALLAX_DPR = 2;
const PARALLAX_FADE_MS = 700;
const CROSSFADE_MS = 1600;
const CLIP_READY_MS = 1500;
const CLIP_START_MS = 1000;
const CLIP_STALL_MS = 1500;
const LIVE_MS = 1200;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then(() => true), sleep(ms).then(() => false)]);
const firstFrame = (video: HTMLVideoElement) => new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
const once = (target: EventTarget, ...types: string[]) =>
  new Promise<void>(resolve => types.forEach(type => target.addEventListener(type, () => resolve(), { once: true })));

const decodable = (video: HTMLVideoElement, ms: number) =>
  video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? Promise.resolve(true) : within(once(video, 'loadeddata'), ms);

const loadImage = (src: string | null) =>
  new Promise<HTMLImageElement | null>(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

export class Scene {
  private views = new Map<string, Promise<View>>();
  private current: View | null = null;
  private target = '';
  private turning = false;
  // Videos that should be playing whenever the page is visible.
  private wanted = new Set<HTMLVideoElement>();
  private turnVideo: HTMLVideoElement;
  private turnFor = '';
  private density: Density = 'setup';
  private visible = document.visibilityState === 'visible';
  private camera: HTMLElement;
  private effects: Effects;
  private parallax: Parallax | null;
  private parallaxCanvas: HTMLCanvasElement;
  private parallaxOffAt = 0;
  private tilt = { x: 0, y: 0, tx: 0, ty: 0, live: false };
  private baseline: { beta: number; gamma: number } | null = null;
  private scheduled = false;
  private last = 0;

  constructor(private root: HTMLElement) {
    this.camera = root.querySelector('.camera')!;
    this.turnVideo = root.querySelector('.turn')!;
    this.parallaxCanvas = root.querySelector('.parallax')!;
    this.parallax = Parallax.create(this.parallaxCanvas, () => this.updateParallax());
    this.effects = new Effects(root.querySelector('.effects')!);
    this.effects.setCalm(reducedMotion.matches);
    reducedMotion.addEventListener('change', () => {
      this.effects.setCalm(reducedMotion.matches);
      this.updateParallax();
    });
    addEventListener('resize', () => this.resize());
    addEventListener('deviceorientation', event => this.orient(event));
    addEventListener('pointermove', event => event.pointerType === 'mouse' && this.point(event));
    this.resize();
  }

  get poster() {
    return this.current?.assets.poster ?? null;
  }

  async show(id: string) {
    this.target = id;
    const view = await this.view(id);
    if (!this.current) this.activate(view);
    void this.runTurns();
  }

  // Turns toward the latest requested scene; requests during a turn are queued.
  turn(to: string) {
    this.target = to;
    void this.runTurns();
  }

  setDensity(density: Density) {
    this.density = density;
    this.root.classList.toggle('session', density === 'session');
    this.effects.setDensity(density);
    this.updateParallax();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    for (const video of this.camera.querySelectorAll('video')) {
      if (visible && this.wanted.has(video)) void video.play().catch(() => {});
      else video.pause();
    }
    this.loop();
  }

  private async runTurns() {
    if (this.turning) return;
    this.turning = true;
    this.updateParallax();
    try {
      while (this.current && this.target !== this.current.assets.id) {
        const from = this.current;
        await this.switchTo(from, await this.view(this.target));
      }
    } finally {
      this.turning = false;
      this.updateParallax();
    }
  }

  private async switchTo(from: View, next: View) {
    this.camera.insertBefore(next.el, this.turnVideo);
    const clip = this.turnFor === `${from.assets.id}>${next.assets.id}` && !reducedMotion.matches && (await decodable(this.turnVideo, CLIP_READY_MS));
    try {
      if (!(clip && (await this.playClip(from, next)))) await this.crossfade(from, next);
    } finally {
      this.stop(this.turnVideo);
      this.turnVideo.classList.remove('on');
      next.el.classList.remove('instant');
    }
    this.activate(next);
  }

  // The clip covers the outgoing scene only once it is presenting frames;
  // a clip that errors or stalls later cuts to the next scene instead.
  private async playClip(from: View, next: View) {
    const clip = this.turnVideo;
    clip.currentTime = 0;
    clip.classList.add('on');
    const presenting = within(firstFrame(clip), CLIP_START_MS);
    this.play(clip);
    if (!(await presenting)) {
      clip.classList.remove('on');
      this.stop(clip);
      return false;
    }
    from.el.classList.remove('active');
    this.stop(from.video);
    await within(once(clip, 'ended', 'error'), (clip.duration || 0) * 1000 + CLIP_STALL_MS);
    next.el.classList.add('active', 'instant');
    this.play(next.video);
    await within(next.live, LIVE_MS);
    return true;
  }

  private async crossfade(from: View, next: View) {
    next.el.classList.add('active');
    this.play(next.video);
    await sleep(CROSSFADE_MS);
    from.el.classList.remove('active');
    this.stop(from.video);
  }

  private play(video: HTMLVideoElement | null) {
    if (!video) return;
    this.wanted.add(video);
    if (this.visible) void video.play().catch(() => {});
  }

  private stop(video: HTMLVideoElement | null) {
    if (!video) return;
    this.wanted.delete(video);
    video.pause();
  }

  private view(id: string) {
    let view = this.views.get(id);
    if (!view) {
      view = sceneAssets(id).then(assets => {
        const el = document.createElement('div');
        el.className = 'view';
        el.dataset.scene = id;
        const poster = document.createElement('img');
        poster.alt = '';
        poster.decoding = 'async';
        if (assets.poster) {
          poster.src = assets.poster;
          poster.onload = () => el.classList.add('posted');
        }
        el.append(poster);
        let video: HTMLVideoElement | null = null;
        let live = Promise.resolve();
        if (assets.loop) {
          const v = (video = document.createElement('video'));
          Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto', src: assets.loop });
          v.setAttribute('aria-hidden', 'true');
          v.onerror = () => {
            this.stop(v);
            v.remove();
          };
          live = new Promise(resolve =>
            v.addEventListener('playing', () => void within(firstFrame(v), LIVE_MS).then(() => {
              el.classList.add('live');
              resolve();
            }), { once: true }),
          );
          el.append(v);
        }
        this.camera.prepend(el);
        const result: View = { assets, el, poster, video, depth: loadImage(assets.depth), live };
        const refresh = () => void (this.current === result && this.setupParallax(result));
        void live.then(refresh);
        poster.addEventListener('load', refresh);
        return result;
      });
      this.views.set(id, view);
    }
    return view;
  }

  private activate(view: View) {
    this.current = view;
    view.el.classList.add('active');
    const { focusX, focusY, light } = view.assets.meta;
    this.camera.style.transformOrigin = `${focusX * 100}% ${focusY * 100}%`;
    this.effects.setScene(light, focusX, focusY);
    this.play(view.video);
    this.prepareTurn(view.assets.id);
    this.parallax?.clear();
    this.updateParallax();
    void this.setupParallax(view);
    this.loop();
  }

  // Parallax draws the playing loop once it shows, else the decoded poster;
  // with neither (say, a missing poster) it stays off.
  private async setupParallax(view: View) {
    const depth = await view.depth;
    if (!this.parallax || !depth || this.current !== view) return;
    const live = view.video && view.el.classList.contains('live');
    this.parallax.setScene(live ? view.video! : view.poster, depth);
    this.updateParallax();
  }

  private prepareTurn(from: string) {
    const to = from === 'waterfall' ? 'bridge' : 'waterfall';
    const src = turnClip(from, to);
    void this.view(to);
    this.turnFor = src ? `${from}>${to}` : '';
    if (!src) return;
    this.turnVideo.src = src;
    this.turnVideo.load();
  }

  private get parallaxWanted() {
    return !!this.parallax?.ready && this.tilt.live && this.density === 'setup' && !this.turning && !reducedMotion.matches;
  }

  private updateParallax() {
    const on = this.parallaxWanted;
    const canvas = this.parallaxCanvas;
    canvas.classList.toggle('lost', !!this.parallax?.lost);
    if (!on && canvas.classList.contains('on')) this.parallaxOffAt = performance.now() + PARALLAX_FADE_MS;
    canvas.classList.toggle('on', on);
    this.loop();
  }

  private orient({ beta, gamma }: DeviceOrientationEvent) {
    if (beta === null || gamma === null) return;
    this.baseline ??= { beta, gamma };
    this.baseline.beta += (beta - this.baseline.beta) * 0.004;
    this.baseline.gamma += (gamma - this.baseline.gamma) * 0.004;
    this.setTilt((gamma - this.baseline.gamma) / 12, (beta - this.baseline.beta) / 12);
  }

  private point(event: PointerEvent) {
    this.setTilt((event.clientX / innerWidth) * 2 - 1, (event.clientY / innerHeight) * 2 - 1);
  }

  private setTilt(x: number, y: number) {
    this.tilt.tx = Math.max(-1, Math.min(1, x));
    this.tilt.ty = Math.max(-1, Math.min(1, y));
    if (!this.tilt.live) {
      this.tilt.live = true;
      this.updateParallax();
    }
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.root;
    this.effects.resize(w, h);
    const dpr = Math.min(devicePixelRatio, PARALLAX_DPR);
    this.parallaxCanvas.width = Math.round(w * dpr);
    this.parallaxCanvas.height = Math.round(h * dpr);
  }

  // Paced by a timer rather than a per-vsync rAF loop: every rAF tick costs a
  // full composite, which on the phone was most of the screen's CPU budget.
  // The parallax canvas runs faster while tilting or showing the moving loop.
  private loop() {
    if (this.scheduled || !this.visible) return;
    this.scheduled = true;
    const t = this.tilt;
    const moving = this.parallaxCanvas.classList.contains('on') && (this.parallax!.animated || Math.abs(t.tx - t.x) + Math.abs(t.ty - t.y) > 0.02);
    const wait = Math.max(0, this.last + 1000 / FPS[moving ? 'moving' : this.density] - performance.now());
    setTimeout(() => requestAnimationFrame(this.frame), wait);
  }

  private frame = (now: number) => {
    this.scheduled = false;
    if (!this.visible) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.loop();
    this.effects.draw(now / 1000, dt);
    const on = this.parallaxCanvas.classList.contains('on');
    if (this.parallax && (on || now < this.parallaxOffAt)) {
      const t = this.tilt;
      const ease = Math.min(1, dt * 4);
      const [x, y] = [t.x, t.y];
      t.x += ((on ? t.tx : 0) - t.x) * ease;
      t.y += ((on ? t.ty : 0) - t.y) * ease;
      this.parallax.draw(t.x, t.y, Math.abs(t.x - x) + Math.abs(t.y - y) > 0.002);
    }
  };
}
