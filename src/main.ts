import './style.css';
import sounds from './sounds.json';
import { buildTrack, planTrack, type Plan } from './track.ts';
import { clock, status } from './session.ts';
import { loadPrefs, MAX_MINUTES, MIN_MINUTES, savePrefs, WARMUPS } from './prefs.ts';

const NAMES: Record<string, string> = {
  himalayan: 'Himalayan',
  resonant: 'Resonant',
  bright: 'Bright',
  deep: 'Deep',
  tingsha: 'Tingsha',
  warm: 'Warm',
  soft: 'Soft',
};
const gongs: Record<string, { frames: number; onset: number }> = sounds.gongs;
// Fingerprinted URLs: a page only ever loads the audio files that match its own sounds.json.
const URLS = Object.fromEntries(
  Object.entries(import.meta.glob<string>('./audio/*.mp3', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [
    path.slice('./audio/'.length, -'.mp3'.length),
    url,
  ]),
);
const BOWLS = Object.keys(NAMES).filter(id => id in gongs && id in URLS);
const BASE = import.meta.env.BASE_URL;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const minutesOut = el<HTMLOutputElement>('minutes');
const startButton = el<HTMLButtonElement>('start');
const message = el('message');
const phaseLabel = el('phase');
const countdown = el('countdown');

const prefs = loadPrefs(BOWLS);

// ---- sound files ---------------------------------------------------------------------------

const files = new Map<string, Promise<Uint8Array>>();
function load(name: string): Promise<Uint8Array> {
  let file = files.get(name);
  if (!file) {
    file = fetch(URLS[name])
      .then(response => {
        if (!response.ok) throw new Error(`${name}.mp3: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(buffer => new Uint8Array(buffer));
    file.catch(() => files.delete(name));
    files.set(name, file);
  }
  return file;
}

/** One gong on its own: the preview when picking a bowl, and the gong after Cancel. */
let single: { audio: HTMLAudioElement; url: string } | null = null;
let singleToken = 0;
function stopSingle(): void {
  singleToken++; // a gong still loading must not start after this
  if (!single) return;
  single.audio.pause();
  URL.revokeObjectURL(single.url);
  single = null;
}
async function ringOnce(bowl: string): Promise<void> {
  stopSingle();
  const token = singleToken;
  const bytes = await load(bowl).catch(() => null);
  if (!bytes || token !== singleToken) return;
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  const mine = (single = { audio, url });
  audio.addEventListener('ended', () => {
    if (single !== mine) return;
    stopSingle();
    reloadIfUpdated();
  });
  await audio.play().catch(() => {});
}

// ---- session -------------------------------------------------------------------------------

interface Session {
  audio: HTMLAudioElement;
  url: string;
  plan: Plan;
  bowl: string;
  /** the closing gong has sounded; the track is only ringing out */
  finished: boolean;
}
let session: Session | null = null;

let starting = false;
async function start(): Promise<void> {
  if (starting || (session && !session.finished)) return;
  if (session) dispose(session);
  stopSingle();
  const settings = { ...prefs }; // the controls stay live while the files load
  starting = true;
  startButton.disabled = true;
  message.textContent = '';
  let started: Session | null = null;
  try {
    const [bed, gong] = await Promise.all([load('bed'), load(settings.bowl)]);
    const plan = planTrack(settings.warmup, settings.minutes * 60, gongs[settings.bowl]);
    const url = URL.createObjectURL(buildTrack(plan, bed, gong));
    const audio = new Audio(url);
    started = session = { audio, url, plan, bowl: settings.bowl, finished: false };
    const mine = started;
    for (const event of ['play', 'pause', 'timeupdate']) audio.addEventListener(event, () => session === mine && render());
    audio.addEventListener('ended', () => session === mine && end(mine));
    audio.addEventListener('error', () => {
      if (session !== mine) return;
      end(mine);
      message.textContent = 'The session audio failed to play.';
    });
    await audio.play();
    showInMediaSession(plan, settings);
    void keepAwake(true);
  } catch (error) {
    if (started && session === started) dispose(started);
    message.textContent = `Couldn't start: ${error instanceof Error ? error.message : error}`;
  } finally {
    starting = false;
    startButton.disabled = false;
    render();
  }
}

/** Cancel during a session ends it with one gong; after the closing gong it just silences the ring-out. */
function cancel(): void {
  const s = session;
  if (!s) return;
  end(s);
  if (!s.finished) void ringOnce(s.bowl);
}

function end(s: Session): void {
  dispose(s);
  render();
  reloadIfUpdated();
}

function dispose(s: Session): void {
  s.audio.pause();
  s.audio.removeAttribute('src');
  s.audio.load();
  URL.revokeObjectURL(s.url);
  if (session !== s) return;
  session = null;
  void keepAwake(false);
  showInMediaSession(null);
}

/** Everything on screen comes from the track position, so it is right the moment the screen comes back on. */
function render(): void {
  const s = session;
  if (!s || s.finished) {
    document.body.dataset.ui = 'setup';
    return;
  }
  const { phase, remaining } = status(s.audio.currentTime, s.plan);
  if (phase === 'done') {
    s.finished = true; // the closing gong rings out; the setup comes back meanwhile
    void keepAwake(false);
    document.body.dataset.ui = 'setup';
    return;
  }
  document.body.dataset.ui = s.audio.paused ? 'paused' : 'running';
  phaseLabel.textContent = s.audio.paused ? 'paused' : phase === 'warmup' ? 'warm-up' : '';
  countdown.textContent = clock(remaining);
  updatePosition(s);
}

setInterval(() => session && render(), 250);
document.addEventListener('visibilitychange', () => {
  render();
  if (session && !session.finished) void keepAwake(true); // the browser drops the wake lock when the page is hidden
});

// ---- screen wake lock ----------------------------------------------------------------------

let lock: WakeLockSentinel | null = null;
let wantLock = false;
let requesting = false;
async function keepAwake(on: boolean): Promise<void> {
  wantLock = on;
  if (!on) {
    const held = lock;
    lock = null;
    await held?.release().catch(() => {});
    return;
  }
  if (lock || requesting || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  requesting = true;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (!wantLock) {
      await sentinel.release();
      return;
    }
    lock = sentinel;
    sentinel.addEventListener('release', () => lock === sentinel && (lock = null));
  } catch {
    // denied (battery saver, unsupported): the audio track keeps the time anyway
  } finally {
    requesting = false;
  }
}

// ---- media session (lock screen / notification) --------------------------------------------

let lastPosition = { paused: true, at: -1 };
function showInMediaSession(plan: Plan | null, settings?: typeof prefs): void {
  if (!('mediaSession' in navigator)) return;
  const media = navigator.mediaSession;
  if (!plan) {
    media.metadata = null;
    media.playbackState = 'none';
    return;
  }
  lastPosition = { paused: true, at: -1 };
  media.metadata = new MediaMetadata({
    title: 'Meditation',
    artist: `${settings!.minutes} min${settings!.warmup ? ` · warm-up ${settings!.warmup} s` : ''}`,
    artwork: [{ src: `${BASE}icon-512.png`, sizes: '512x512', type: 'image/png' }],
  });
}

function updatePosition(s: Session): void {
  if (!('mediaSession' in navigator)) return;
  const paused = s.audio.paused;
  const position = Math.min(s.audio.currentTime, s.plan.duration);
  if (paused === lastPosition.paused && Math.abs(position - lastPosition.at) < 5) return;
  lastPosition = { paused, at: position };
  navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
  try {
    navigator.mediaSession.setPositionState({ duration: s.plan.duration, position, playbackRate: 1 });
  } catch {}
}

if ('mediaSession' in navigator) {
  const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
    ['play', () => void session?.audio.play().catch(() => {})],
    ['pause', () => session?.audio.pause()],
    ['stop', cancel],
    ['seekto', null],
    ['seekbackward', null],
    ['seekforward', null],
    ['previoustrack', null],
    ['nexttrack', null],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {}
  }
}

// ---- setup controls ------------------------------------------------------------------------

function chip(label: string, data: Record<string, string>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  Object.assign(button.dataset, data);
  return button;
}
el('warmups').append(...WARMUPS.map(s => chip(s ? `${s} s` : 'off', { warmup: String(s) })));
el('bowls').append(...BOWLS.map(id => chip(NAMES[id], { bowl: id })));

function showPrefs(): void {
  minutesOut.value = String(prefs.minutes);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-minutes]')) b.ariaPressed = String(Number(b.dataset.minutes) === prefs.minutes);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-warmup]')) b.ariaPressed = String(Number(b.dataset.warmup) === prefs.warmup);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-bowl]')) b.ariaPressed = String(b.dataset.bowl === prefs.bowl);
}
function change(update: Partial<typeof prefs>): void {
  Object.assign(prefs, update);
  prefs.minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, prefs.minutes));
  savePrefs(prefs);
  showPrefs();
}

document.querySelector('.setup')!.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button');
  if (!button) return;
  const { step, minutes, warmup, bowl } = button.dataset;
  if (step) change({ minutes: prefs.minutes + Number(step) });
  if (minutes) change({ minutes: Number(minutes) });
  if (warmup) change({ warmup: Number(warmup) });
  if (bowl) {
    change({ bowl });
    if (!starting) void ringOnce(bowl);
  }
});
startButton.addEventListener('click', () => void start());
el('cancel').addEventListener('click', cancel);
el('resume').addEventListener('click', () => void session?.audio.play().catch(() => {}));

el('build').textContent = `Build ${__BUILD__} UTC`;
showPrefs();
render();
void load('bed');
void load(prefs.bowl);

// ---- updates -------------------------------------------------------------------------------
// A new service worker takes over at once (src/sw.ts). This page keeps running its own version
// (its audio URLs are fingerprinted, so nothing mixes); it reloads into the new one once no
// session audio is left, so a session, closing gong included, is never interrupted.

let updated = false;
function reloadIfUpdated(): void {
  if (updated && !starting && !session && !single) location.reload();
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install: this page is already the current version
    updated = true;
    reloadIfUpdated();
  });
  const registration = navigator.serviceWorker.register(`${BASE}sw.js`);
  registration.catch(() => {});
  // an installed app may stay open for days: look for a new version whenever it comes back while idle
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !session) void registration.then(r => r.update()).catch(() => {});
  });
}
