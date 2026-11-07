// Cheap live atmosphere over the rendered loop: drifting mist, breathing light
// shafts and the odd glowing mote, all on random timing so nothing repeats.

type Rgb = [number, number, number];
type Mist = { x: number; y: number; w: number; h: number; vx: number; peak: number; age: number; life: number };
type Shaft = { x: number; width: number; level: number; target: number; next: number };
type Mote = { x: number; y: number; vx: number; vy: number; size: number; peak: number; age: number; life: number; sway: number };

export type Density = 'setup' | 'session';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const envelope = (age: number, life: number, edge: number) => Math.max(0, Math.min(1, age / edge, (life - age) / edge));

export class Effects {
  private ctx: CanvasRenderingContext2D;
  private sprites: { mist: HTMLCanvasElement; mote: HTMLCanvasElement; shaft: HTMLCanvasElement } | null = null;
  private mists: Mist[] = [];
  private shafts: Shaft[] = [];
  private motes: Mote[] = [];
  private light: Rgb = [255, 236, 205];
  private focus = { x: 0.5, y: 0.45 };
  private density: Density = 'setup';
  private width = 0;
  private height = 0;
  private scale = 1;
  private calm: boolean;

  constructor(private canvas: HTMLCanvasElement, reducedMotion: boolean) {
    this.ctx = canvas.getContext('2d')!;
    this.calm = reducedMotion;
  }

  setScene(light: Rgb, focusX: number, focusY: number) {
    this.light = light;
    this.focus = { x: focusX, y: focusY };
    this.sprites = null;
    this.shafts = Array.from({ length: 3 }, (_, i) => ({
      x: focusX + (i - 1) * rand(0.15, 0.3),
      width: rand(0.12, 0.3),
      level: 0,
      target: rand(0.3, 1),
      next: 0,
    }));
  }

  setDensity(density: Density) {
    this.density = density;
  }

  resize(width: number, height: number) {
    this.scale = Math.min(devicePixelRatio, 1.5);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.scale);
    this.canvas.height = Math.round(height * this.scale);
  }

  draw(time: number, dt: number) {
    const { ctx, width: w, height: h } = this;
    if (!w) return;
    this.sprites ??= sprites(this.light);
    const sparse = this.density === 'session';
    const speed = this.calm ? 0.3 : 1;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    for (const shaft of this.shafts) {
      if (time > shaft.next) {
        shaft.target = rand(0.15, 1);
        shaft.next = time + rand(4, 11) / speed;
      }
      shaft.level += (shaft.target - shaft.level) * Math.min(1, dt * 0.25 * speed);
      ctx.save();
      ctx.globalAlpha = shaft.level * (sparse ? 0.11 : 0.16);
      ctx.translate(shaft.x * w, -h * 0.05);
      ctx.rotate(0.22);
      ctx.drawImage(this.sprites.shaft, -shaft.width * w * 0.5, 0, shaft.width * w, h * 0.95);
      ctx.restore();
    }

    if (this.mists.length < (sparse ? 3 : 5) && Math.random() < dt * 0.4) this.mists.push(this.spawnMist());
    this.mists = this.mists.filter(m => (m.age += dt) < m.life);
    for (const m of this.mists) {
      m.x += m.vx * dt * speed;
      ctx.globalAlpha = m.peak * envelope(m.age, m.life, 9);
      ctx.drawImage(this.sprites.mist, m.x - m.w / 2, m.y - m.h / 2 + Math.sin(m.age * 0.21) * 6, m.w, m.h);
    }

    if (!this.calm && Math.random() < dt * (sparse ? 0.08 : 0.45)) this.motes.push(this.spawnMote());
    this.motes = this.motes.filter(m => (m.age += dt) < m.life);
    for (const m of this.motes) {
      m.x += (m.vx + Math.sin(m.age * m.sway) * 4) * dt;
      m.y += m.vy * dt;
      ctx.globalAlpha = m.peak * envelope(m.age, m.life, 2.5);
      ctx.drawImage(this.sprites.mote, m.x - m.size, m.y - m.size, m.size * 2, m.size * 2);
    }
  }

  private spawnMist(): Mist {
    const { width: w, height: h } = this;
    const fromLeft = Math.random() < 0.5;
    const width = rand(0.7, 1.4) * w;
    return {
      x: fromLeft ? rand(-0.3, 0.4) * w : rand(0.6, 1.3) * w,
      y: (Math.random() < 0.5 ? this.focus.y + rand(0, 0.25) : rand(0.55, 0.95)) * h,
      w: width,
      h: width * rand(0.25, 0.45),
      vx: (fromLeft ? 1 : -1) * rand(2, 7),
      peak: rand(0.05, 0.13),
      age: 0,
      life: rand(28, 60),
    };
  }

  private spawnMote(): Mote {
    const { width: w, height: h } = this;
    return {
      x: rand(0.05, 0.95) * w,
      y: rand(0.15, 0.75) * h,
      vx: rand(-3, 3),
      vy: rand(-5, 2),
      size: rand(1.2, 3.2),
      peak: rand(0.25, 0.7),
      age: 0,
      life: rand(5, 12),
      sway: rand(0.3, 0.9),
    };
  }
}

function sprites([r, g, b]: Rgb) {
  const make = (w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    paint(canvas.getContext('2d')!);
    return canvas;
  };
  const glow = (c: CanvasRenderingContext2D, size: number, core: number) => {
    const gradient = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gradient.addColorStop(core, `rgba(${r},${g},${b},0.35)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = gradient;
    c.fillRect(0, 0, size, size);
  };
  return {
    mist: make(128, 128, c => {
      const gradient = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(225,232,236,1)');
      gradient.addColorStop(0.5, 'rgba(225,232,236,0.45)');
      gradient.addColorStop(1, 'rgba(225,232,236,0)');
      c.fillStyle = gradient;
      c.fillRect(0, 0, 128, 128);
    }),
    mote: make(16, 16, c => glow(c, 16, 0.3)),
    shaft: make(64, 256, c => {
      const across = c.createLinearGradient(0, 0, 64, 0);
      for (const [stop, alpha] of [[0, 0], [0.5, 1], [1, 0]]) across.addColorStop(stop, `rgba(${r},${g},${b},${alpha})`);
      c.fillStyle = across;
      c.fillRect(0, 0, 64, 256);
      c.globalCompositeOperation = 'destination-in';
      const along = c.createLinearGradient(0, 0, 0, 256);
      for (const [stop, alpha] of [[0, 0.9], [0.55, 0.35], [1, 0]]) along.addColorStop(stop, `rgba(0,0,0,${alpha})`);
      c.fillStyle = along;
      c.fillRect(0, 0, 64, 256);
    }),
  };
}
