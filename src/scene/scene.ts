import { scene as sceneAssets, turnClip, type SceneAssets } from '../assets.ts';
import { Effects, type Density } from './effects.ts';
import { Parallax } from './parallax.ts';

type View = {
  assets: SceneAssets;
  el: HTMLDivElement;
  poster: HTMLImageElement;
  video: HTMLVideoElement | null;
  depth: Promise<HTMLImageElement | null>;
};

// Measured on the Pixel 6a: each composited frame costs ~1.5% of a core, and
// the atmosphere moves a few px/s, so a low frame rate looks the same.
const FPS = { setup: 12, session: 8, tilting: 24 };
const PARALLAX_DPR = 2;
const FADE_MS = 700;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const firstFrame = (video: HTMLVideoElement) => new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));

const decodable = (video: HTMLVideoElement, timeout: number) =>
  new Promise<boolean>(resolve => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve(true);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', ready);
      resolve(ok);
    };
    const ready = () => done(true);
    const timer = setTimeout(() => done(false), timeout);
    video.addEventListener('loadeddata', ready);
  });

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
  private turnVideo: HTMLVideoElement;
  private turnFor = '';
  private turning = false;
  private density: Density = 'setup';
  private visible = document.visibilityState === 'visible';
  private camera: HTMLElement;
  private effects: Effects;
  private parallax: Parallax | null;
  private parallaxCanvas: HTMLCanvasElement;
  private parallaxReady = false;
  private parallaxOffAt = 0;
  private tilt = { x: 0, y: 0, tx: 0, ty: 0, live: false };
  private baseline: { beta: number; gamma: number } | null = null;
  private scheduled = false;
  private last = 0;

  constructor(private root: HTMLElement) {
    this.camera = root.querySelector('.camera')!;
    this.turnVideo = root.querySelector('.turn')!;
    this.parallaxCanvas = root.querySelector('.parallax')!;
    this.parallax = Parallax.create(this.parallaxCanvas);
    this.effects = new Effects(root.querySelector('.effects')!, reducedMotion.matches);
    addEventListener('resize', () => this.resize());
    addEventListener('deviceorientation', event => this.orient(event));
    addEventListener('pointermove', event => event.pointerType === 'mouse' && this.point(event));
    this.resize();
  }

  get sceneId() {
    return this.current?.assets.id ?? '';
  }

  get poster() {
    return this.current?.assets.poster ?? null;
  }

  async show(id: string) {
    const view = await this.view(id);
    view.el.classList.add('active');
    void this.activate(view);
  }

  async turn(to: string) {
    const from = this.current;
    if (!from || this.turning || to === from.assets.id) return;
    this.turning = true;
    this.updateParallax();
    const next = await this.view(to);
    this.camera.insertBefore(next.el, this.turnVideo);
    const clip = this.turnVideo;
    const ready = this.turnFor === `${from.assets.id}>${to}` && !reducedMotion.matches && (await decodable(clip, 1500));
    if (ready) {
      clip.classList.add('on');
      await clip.play().catch(() => {});
      from.el.classList.remove('active');
      from.video?.pause();
      await new Promise(resolve => clip.addEventListener('ended', resolve, { once: true }));
      next.el.classList.add('active', 'instant');
      await this.startVideo(next);
      clip.classList.remove('on');
      next.el.classList.remove('instant');
    } else {
      next.el.classList.add('active');
      void this.startVideo(next);
      await new Promise(resolve => setTimeout(resolve, 1600));
      from.el.classList.remove('active');
      from.video?.pause();
    }
    this.turning = false;
    void this.activate(next);
  }

  setDensity(density: Density) {
    this.density = density;
    this.root.classList.toggle('session', density === 'session');
    this.effects.setDensity(density);
    this.updateParallax();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    const turnClip = this.turning ? this.turnVideo : null;
    if (!visible) {
      this.current?.video?.pause();
      turnClip?.pause();
      return;
    }
    void turnClip?.play().catch(() => {});
    if (this.current && !turnClip) void this.startVideo(this.current);
    this.loop();
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
        if (assets.loop) {
          video = document.createElement('video');
          Object.assign(video, { muted: true, loop: true, playsInline: true, preload: 'auto', src: assets.loop });
          video.setAttribute('aria-hidden', 'true');
          video.onerror = () => video?.remove();
          el.append(video);
        }
        this.camera.prepend(el);
        return { assets, el, poster, video, depth: loadImage(assets.depth) };
      });
      this.views.set(id, view);
    }
    return view;
  }

  private async startVideo(view: View) {
    const video = view.video;
    if (!video || !this.visible) return;
    const shown = firstFrame(video);
    if (await video.play().then(() => true, () => false)) {
      await Promise.race([shown, new Promise(resolve => setTimeout(resolve, 1200))]);
      view.el.classList.add('live');
    }
  }

  private async activate(view: View) {
    this.current = view;
    const { focusX, focusY, light } = view.assets.meta;
    this.camera.style.transformOrigin = `${focusX * 100}% ${focusY * 100}%`;
    this.effects.setScene(light, focusX, focusY);
    this.parallaxReady = false;
    this.loop();
    await this.startVideo(view);
    if (this.current !== view) return;
    this.prepareTurn(view.assets.id);
    const depth = await view.depth;
    if (this.parallax && depth && this.current === view) {
      this.parallax.setScene(view.el.classList.contains('live') && view.video ? view.video : view.poster, depth);
      this.parallaxReady = view.poster.complete || view.el.classList.contains('live');
      this.updateParallax();
    }
  }

  private prepareTurn(from: string) {
    const to = from === 'waterfall' ? 'bridge' : 'waterfall';
    const src = turnClip(from, to);
    void this.view(to);
    if (!src) return;
    this.turnFor = `${from}>${to}`;
    this.turnVideo.src = src;
    this.turnVideo.load();
  }

  private get parallaxWanted() {
    return this.parallaxReady && this.tilt.live && this.density === 'setup' && !this.turning && !reducedMotion.matches;
  }

  private updateParallax() {
    const on = this.parallaxWanted;
    if (!on && this.parallaxCanvas.classList.contains('on')) this.parallaxOffAt = performance.now() + FADE_MS;
    this.parallaxCanvas.classList.toggle('on', on);
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
  private loop() {
    if (this.scheduled || !this.visible) return;
    this.scheduled = true;
    const t = this.tilt;
    const tilting = this.parallaxCanvas.classList.contains('on') && Math.abs(t.tx - t.x) + Math.abs(t.ty - t.y) > 0.02;
    const wait = Math.max(0, this.last + 1000 / FPS[tilting ? 'tilting' : this.density] - performance.now());
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
