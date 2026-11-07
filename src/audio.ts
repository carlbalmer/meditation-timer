import { reconcile, TOLERANCE, type Scheduled } from './schedule.ts';
import type { Cue } from './session.ts';
import { keepAliveSignal } from './output.ts';

type Voice = { source: AudioBufferSourceNode; gain: GainNode };
type Gong = Scheduled & { source: AudioBufferSourceNode };
type Bed = { keepAlive: AudioScheduledSourceNode; water: AudioScheduledSourceNode | null; fade: GainNode; fadeAt: number; ringOut: number };

const WATER_LEVEL = 0.6;
const BOWL_LEVEL = 10 ** (-12 / 20);
const BED_FADE = 8;
const CANCEL_FADE = 2;
const RESUME_TIMEOUT_MS = 1500;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private bus!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private pending: Gong[] = [];
  private consumed = new Set<string>();
  private ringEnd = 0;
  private gongBuffer: AudioBuffer | null = null;
  private cues: Cue[] = [];
  // Wall ms at which the bed fades: Infinity while open-ended, null to stop it now.
  private bedUntil: number | null = null;
  private bed: Bed | null = null;
  private previewing: Voice | null = null;
  private previewRequest = 0;
  private previewLoading = false;
  onStateChange = () => {};

  get running() {
    return this.ctx?.state === 'running';
  }

  // Must be called from a user gesture the first time. Pending gongs are
  // invalidated before resuming, so a stale one can never render on wake.
  async unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.bus = this.ctx.createGain();
      this.bus.connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', () => {
        this.reconcile();
        this.onStateChange();
      });
    }
    if (!this.running) {
      this.reconcile();
      await Promise.race([this.ctx.resume().catch(() => {}), new Promise(resolve => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
    }
    return this.running;
  }

  load(url: string | null): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!url || !ctx) return Promise.resolve(null);
    let buffer = this.buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then(response => (response.ok ? response.arrayBuffer() : Promise.reject(response.status)))
        .then(data => ctx.decodeAudioData(data))
        .catch(() => {
          this.buffers.delete(url);
          return null;
        });
      this.buffers.set(url, buffer);
    }
    return buffer;
  }

  setGong(buffer: AudioBuffer | null) {
    this.gongBuffer = buffer ?? standInBowl(this.ctx!);
  }

  // Brings the audio clock in line with the session: one gong per cue, and the
  // bed fading out at `bedUntil` (wall ms), or now when null.
  sync(cues: Cue[], bedUntil: number | null) {
    this.cues = cues;
    this.bedUntil = bedUntil;
    this.reconcile();
  }

  // The keep-alive signal starts at once and runs until the session's gongs have rung out.
  startBed() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (this.bed) fadeBed(this.bed, now, 0.5);
    const keepAlive = keepAliveSignal(ctx);
    keepAlive.connect(this.bus);
    keepAlive.start(now);
    const fade = ctx.createGain();
    fade.connect(this.bus);
    const bed: Bed = { keepAlive, water: null, fade, fadeAt: Infinity, ringOut: Infinity };
    keepAlive.onended = () => this.bed === bed && (this.bed = null);
    this.bed = bed;
    this.bedUntil = Infinity;
  }

  setWater(water: AudioBuffer | null) {
    const ctx = this.ctx!;
    const bed = this.bed;
    if (!bed || !water || bed.water) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = water;
    source.loop = true;
    const fadeIn = ctx.createGain();
    fadeIn.gain.setValueAtTime(0, now);
    fadeIn.gain.linearRampToValueAtTime(WATER_LEVEL, now + 5);
    source.connect(fadeIn).connect(bed.fade);
    source.start(now, Math.random() * water.duration);
    bed.water = source;
  }

  // Suspends the idle audio device to save battery; unlock() wakes it.
  rest() {
    const ctx = this.ctx;
    if (!ctx || !this.running || this.bed || this.previewing || this.previewLoading || this.pending.length) return;
    if (this.ringEnd > ctx.currentTime) return;
    void ctx.suspend();
  }

  previewBowl(url: string | null) {
    return this.preview(url, 6, BOWL_LEVEL, 0);
  }

  previewWater(url: string | null) {
    return this.preview(url, 4, WATER_LEVEL, 1);
  }

  stopPreview() {
    this.previewRequest++;
    this.previewLoading = false;
    if (this.previewing) fadeOut(this.previewing, 0, 0.3);
    this.previewing = null;
  }

  private async preview(url: string | null, seconds: number, level: number, fadeIn: number) {
    this.stopPreview();
    const request = this.previewRequest;
    this.previewLoading = true;
    const buffer = (await this.unlock()) ? await this.load(url) : null;
    if (request !== this.previewRequest) return;
    this.previewLoading = false;
    if (!buffer || !this.running) return;
    const voice = this.voice(buffer, this.ctx!.currentTime, level, fadeIn);
    fadeOut(voice, seconds - 1.5, 1.5);
    voice.source.onended = () => this.previewing === voice && (this.previewing = null);
    this.previewing = voice;
  }

  private reconcile() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const running = this.running;
    const plan = reconcile(this.pending, this.consumed, this.cues, now, Date.now(), running);
    for (const gong of plan.stop) gong.source.stop();
    for (const gong of plan.started) this.ringEnd = Math.max(this.ringEnd, gong.when + gong.source.buffer!.duration);
    this.consumed = plan.consumed;
    this.pending = [
      ...plan.keep,
      ...plan.start.map(cue => ({ ...cue, source: this.voice(this.gongBuffer!, cue.when, BOWL_LEVEL).source })),
    ];
    this.reconcileBed(now, running);
  }

  private reconcileBed(now: number, running: boolean) {
    const bed = this.bed;
    if (!bed) return;
    if (this.bedUntil === null) {
      fadeBed(bed, now, running ? CANCEL_FADE : 0);
      this.bed = null;
      return;
    }
    if (!running || this.bedUntil === Infinity) return;
    const fadeAt = now + Math.max(0, (this.bedUntil - Date.now()) / 1000);
    if (bed.fadeAt > now && Math.abs(fadeAt - bed.fadeAt) > TOLERANCE) {
      bed.fadeAt = fadeAt;
      const gain = bed.fade.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.setValueAtTime(gain.value, fadeAt);
      gain.linearRampToValueAtTime(0, fadeAt + BED_FADE);
      bed.water?.stop(fadeAt + BED_FADE + 0.05);
    }
    // The keep-alive outlasts every gong, so the clock never stalls before a gong has rung out.
    const ringOut = Math.max(bed.fadeAt + BED_FADE, this.ringEnd, ...this.pending.map(gong => gong.when + gong.source.buffer!.duration));
    if (bed.ringOut > now && Math.abs(ringOut - bed.ringOut) > TOLERANCE) {
      bed.ringOut = ringOut;
      bed.keepAlive.stop(ringOut);
    }
  }

  private voice(buffer: AudioBuffer, when: number, level: number, fadeIn = 0): Voice {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(fadeIn ? 0 : level, when);
    if (fadeIn) gain.gain.linearRampToValueAtTime(level, when + fadeIn);
    source.connect(gain).connect(this.bus);
    source.start(when);
    return { source, gain };
  }
}

function fadeBed(bed: Bed, now: number, seconds: number) {
  const gain = bed.fade.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(0, now + seconds);
  bed.water?.stop(now + seconds);
  bed.keepAlive.stop(now + seconds);
}

function fadeOut({ source, gain }: Voice, delay: number, seconds: number) {
  const param = gain.gain;
  const now = gain.context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now + Math.max(0, delay));
  param.linearRampToValueAtTime(0, now + Math.max(0, delay) + seconds);
  source.stop(now + Math.max(0, delay) + seconds + 0.05);
}

// A synthesized bowl, used when a recording cannot be loaded in time.
function standInBowl(ctx: BaseAudioContext) {
  const seconds = 9;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const partials = [[196, 1, 0.45], [530, 0.45, 0.9], [1003, 0.22, 1.6], [1611, 0.1, 2.4]];
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    let sample = 0;
    for (const [freq, amp, decay] of partials) sample += amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * freq * t + Math.sin(2 * Math.PI * 1.3 * t) * 0.4);
    data[i] = 0.35 * sample * Math.min(1, t / 0.004);
  }
  return buffer;
}
