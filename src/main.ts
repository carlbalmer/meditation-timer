import './style.css';
import { bowls, credits, offlineUrls, SCENES, water } from './assets.ts';
import { AudioEngine } from './audio.ts';
import { clearSession, showSession } from './media-session.ts';
import { loadPrefs, savePrefs, type Prefs } from './prefs.ts';
import { Scene } from './scene/scene.ts';
import { cancel, clampMinutes, cues, end, nextWarmup, phaseAt, skip, span, start, type Phase, type Session } from './session.ts';
import { createUi } from './ui.ts';

const BED_TAIL_MS = 4000;
const TYPE_CREDITS = `## Type
| title | author | licence | source |
| --- | --- | --- | --- |
| Cormorant Garamond | Christian Thalmann | SIL Open Font License 1.1 | https://github.com/CatharsisFonts/Cormorant |`;
const REST_AFTER_MS = 20_000;
const LOAD_TIMEOUT_MS = 4000;

const within = <T>(promise: Promise<T | null>, ms: number) =>
  Promise.race([promise, new Promise<null>(resolve => setTimeout(resolve, ms, null))]);
const active = () => shown === 'warmup' || shown === 'meditation';
// Busy from Start until the closing gong has rung out.
const busy = () => starting || active() || !audio.idle;

const prefs = loadPrefs();
if (!SCENES.includes(prefs.scene)) prefs.scene = SCENES[0];
let bowlIndex = Math.max(0, bowls.findIndex(bowl => bowl.id === prefs.bowl));

const audio = new AudioEngine();
const scene = new Scene(document.querySelector('.scene')!);
let session: Session | null = null;
let sessionCount = 0;
let shown: Phase = 'idle';
let starting = false;
let repaint = 0;
let restTimer = 0;
let reloadPending = false;

const ui = createUi({
  minutes: value => change({ minutes: clampMinutes(value) }),
  warmup: () => change({ warmup: nextWarmup(prefs.warmup) }),
  water: () => {
    change({ water: !prefs.water });
    if (prefs.water) void audio.previewWater(water(prefs.scene));
    else audio.stopPreview();
    restSoon();
  },
  bowl: () => {
    if (bowls.length) bowlIndex = (bowlIndex + 1) % bowls.length;
    change({ bowl: bowls[bowlIndex]?.id ?? '' });
    ui.chime();
    void audio.previewBowl(bowls[bowlIndex]?.url ?? null);
    restSoon();
  },
  scene: target => {
    if (active()) return;
    const index = SCENES.indexOf(prefs.scene);
    const id = typeof target === 'string' ? target : SCENES[(index + target + SCENES.length) % SCENES.length];
    if (id === prefs.scene) return;
    change({ scene: id });
    scene.turn(id);
  },
  start: beginSession,
  skip: () => act(skip),
  cancel: () => act(cancel),
  end: () => act(end),
  credits: async () => {
    const url = credits();
    const sounds = url ? await fetch(url).then(r => (r.ok ? r.text() : ''), () => '') : '';
    return `${sounds}\n\n${TYPE_CREDITS}`;
  },
});

function change(patch: Partial<Prefs>) {
  Object.assign(prefs, patch);
  savePrefs(prefs);
  ui.renderSetup(prefs, bowlIndex, bowls.length);
}

async function beginSession() {
  if (starting || active()) return;
  starting = true;
  clearTimeout(restTimer);
  audio.stopPreview();
  const committed = (await audio.unlock()) && (await prepareSession());
  starting = false;
  if (!committed) {
    audio.sync([], null);
    ui.refuse();
  }
  update();
}

// The keep-alive bed runs from the moment audio is unlocked, so the context
// cannot idle while sounds decode; slow loads fall back to a stand-in bowl and
// no water. The session only starts once the context is confirmed running.
async function prepareSession() {
  audio.startBed();
  const [gong, bed] = await Promise.all([
    within(audio.load(bowls[bowlIndex]?.url ?? null), LOAD_TIMEOUT_MS),
    prefs.water ? within(audio.load(water(prefs.scene)), LOAD_TIMEOUT_MS) : null,
  ]);
  audio.setGong(gong);
  audio.setWater(bed);
  if (!(await audio.unlock())) return false;
  session = start(++sessionCount, prefs, Date.now());
  return true;
}

function act(action: (s: Session | null, now: number) => Session | null) {
  session = action(session, Date.now());
  update();
}

// Reconciles audio with the session and repaints. Safe to call at any time,
// any number of times: page timers only ever trigger this.
function update() {
  const now = Date.now();
  const phase = phaseAt(session, now);
  const current = span(session, now);
  if (!starting) audio.sync(cues(session), session ? session.closeAt + BED_TAIL_MS : null);
  if (phase !== shown) transition(shown, phase, current);
  shown = phase;
  clearTimeout(repaint);
  if (!current) return;
  const [from, to] = current;
  ui.renderClock(phase, to - now, (to - now) / (to - from));
  repaint = window.setTimeout(update, ((to - now) % 1000) + 20);
}

function transition(from: Phase, to: Phase, current: [number, number] | null) {
  ui.setPhase(to);
  scene.setDensity(current ? 'session' : 'setup');
  if (current) showSession('Meditation', scene.poster, current[0], current[1], () => act(end));
  else if (from === 'warmup' || from === 'meditation') {
    clearSession();
    restSoon();
  }
}

function restSoon() {
  clearTimeout(restTimer);
  restTimer = window.setTimeout(() => {
    if (busy()) restSoon();
    else if (reloadPending) location.reload();
    else audio.rest();
  }, REST_AFTER_MS);
}

audio.onStateChange = update;

// If the context could not resume during a session (say, after an audio
// interruption), every visit and touch retries; stale gongs are dropped.
document.addEventListener('visibilitychange', () => {
  const visible = document.visibilityState === 'visible';
  scene.setVisible(visible);
  if (visible && active()) void audio.unlock();
  update();
});

// Any touch unlocks audio; on the setup screen it also decodes what Start needs.
addEventListener('pointerdown', async () => {
  if (!(await audio.unlock()) || active() || starting) return;
  void audio.load(bowls[bowlIndex]?.url ?? null);
  if (prefs.water) void audio.load(water(prefs.scene));
  restSoon();
}, { capture: true });

ui.renderSetup(prefs, bowlIndex, bowls.length);
ui.setPhase('idle');
void scene.show(prefs.scene);

// Updates never interrupt a session: the waiting worker asks every window
// whether it is busy before taking over, and a page that is busy anyway when
// the new worker arrives reloads only once it is idle again.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const sw = navigator.serviceWorker;
  sw.addEventListener('message', event => {
    if (event.data?.query === 'busy') event.ports[0]?.postMessage({ busy: busy() });
  });
  sw.startMessages();
  addEventListener('load', async () => {
    const hadController = !!sw.controller;
    const registration = await sw.register(`${import.meta.env.BASE_URL}sw.js`);
    sw.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (busy()) reloadPending = true;
      else location.reload();
    });
    const applyUpdate = () => registration.waiting?.postMessage({ activate: true });
    const applyUpdateWhenHidden = () => {
      if (document.visibilityState !== 'hidden' || busy()) return;
      if (reloadPending) location.reload();
      else applyUpdate();
    };
    applyUpdate();
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', applyUpdateWhenHidden));
    document.addEventListener('visibilitychange', applyUpdateWhenHidden);
    await sw.ready;
    requestIdleCallback(() => registration.active?.postMessage({ cache: offlineUrls() }), { timeout: 10_000 });
  });
}
