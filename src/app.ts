import './style.css';
import { initialSession, remaining, transition, type Action, type Settings } from './session';
import { sounds, prepare, play, stop } from './audio';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = document.querySelector<HTMLElement>('.app')!;
const minutes = $<HTMLInputElement>('minutes');
const defaults: Settings = { minutes: 20, warmup: 45, sound: 0 };
const clamp = (value: number) => Math.max(1, Math.min(180, Math.round(value)));
let settings = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem('meditation-settings') || 'null');
  if (saved && Number.isFinite(saved.minutes) && [30, 45, 60].includes(saved.warmup) && Number.isInteger(saved.sound) && saved.sound >= 0 && saved.sound < sounds.length) settings = { minutes: clamp(saved.minutes), warmup: saved.warmup, sound: saved.sound };
} catch { /* Storage is optional, including private browsing. */ }
let state = initialSession(settings);
let busy = false;
let previewRequest = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let wakeLock: WakeLockSentinel | undefined;
let wakeRequest = false;
function status(message: string) { $('status').textContent = message; }
function save() { try { localStorage.setItem('meditation-settings', JSON.stringify(settings)); } catch { /* Continue without persistence. */ } }
function setMinutes(value: number) { if (state.phase !== 'setup' || busy) return; settings.minutes = clamp(Number.isFinite(value) ? value : settings.minutes); minutes.value = String(settings.minutes); save(); render(); }
function cancelPreview() { previewRequest++; clearTimeout(previewTimer); stop(); $('preview-label').textContent = 'Tap to listen'; }
async function preview() {
  if (busy || state.phase !== 'setup') return;
  cancelPreview();
  const request = previewRequest;
  const index = settings.sound;
  $('preview-label').textContent = 'Loading…';
  try {
    await prepare(index);
    if (request !== previewRequest || state.phase !== 'setup' || busy) return;
    play(index, true);
    $('preview-label').textContent = 'Listening…';
    previewTimer = setTimeout(() => { if (request === previewRequest) $('preview-label').textContent = 'Tap to listen'; }, 5000);
  } catch (error) { if (request === previewRequest) { status((error as Error).message); $('preview-label').textContent = 'Tap to retry'; } }
}
function selectSound(delta: number) { if (busy || state.phase !== 'setup') return; cancelPreview(); settings.sound = (settings.sound + delta + sounds.length) % sounds.length; save(); render(); void preview(); }
async function keepAwake() {
  if (state.phase === 'setup' || document.visibilityState !== 'visible' || wakeLock || wakeRequest) return;
  if (!('wakeLock' in navigator)) { $('wake-status').textContent = 'Keep your screen on and this page visible'; return; }
  wakeRequest = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if ((state.phase as string) === 'setup') { await lock.release(); return; }
    wakeLock = lock;
    $('wake-status').textContent = 'Screen stays awake · keep this page visible';
    lock.addEventListener('release', () => { if (wakeLock === lock) { wakeLock = undefined; $('wake-status').textContent = state.phase === 'setup' ? 'Keep this page open during your session' : 'Keep your screen on and this page visible'; } });
  } catch { $('wake-status').textContent = 'Keep your screen on and this page visible'; }
  finally { wakeRequest = false; }
}
function dispatch(action: Action) {
  const previous = state.phase;
  const result = transition(state, action, Date.now(), settings);
  state = result.state;
  let audioError = '';
  if (result.cue) {
    try { play(state.settings.sound); }
    catch (error) { state = initialSession(settings); audioError = (error as Error).message; }
  }
  if (audioError) status(audioError);
  else if (result.interrupted) status('Your session was interrupted while the app was away. Start again when you’re ready.');
  else if (previous === 'meditation' && state.phase === 'setup' && result.cue) status('Your session is complete. Take a moment.');
  else if (previous !== state.phase) status(state.phase === 'warmup' ? 'Settle in. The opening gong will begin your meditation.' : state.phase === 'meditation' ? 'Meditation has begun.' : '');
  if (state.phase === 'setup') { const oldLock = wakeLock; wakeLock = undefined; void oldLock?.release(); $("wake-status").textContent = 'Keep this page open during your session'; }
  else void keepAwake();
  render();
}
function render() {
  const setup = state.phase === 'setup';
  app.dataset.phase = state.phase;
  $('phase-title').textContent = setup ? 'A moment for yourself' : state.phase === 'warmup' ? 'Warm-up' : 'Meditation';
  minutes.hidden = !setup;
  minutes.disabled = busy;
  $<HTMLButtonElement>("preview").disabled = busy || !setup;
  if (document.activeElement !== minutes) minutes.value = String(settings.minutes);
  $('countdown').hidden = setup;
  const seconds = remaining(state, Date.now());
  $('countdown').textContent = state.phase === 'warmup' ? String(seconds) : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('unit').textContent = setup ? 'minutes' : state.phase === 'warmup' ? 'seconds to settle' : 'remaining';
  const progress = setup ? 0 : Math.max(0, Math.min(100, (Date.now() - state.started) / (state.deadline - state.started) * 100));
  $('progress').style.strokeDasharray = `${progress} 100`;
  const angle = setup ? (settings.minutes % 20) / 20 * Math.PI * 2 : 0;
  $('dial-knob').style.left = `calc(${50 + Math.sin(angle) * 42.8125}% - 14.5px)`;
  $('dial-knob').style.top = `calc(${50 - Math.cos(angle) * 42.8125}% - 14.5px)`;
  $('warmup-value').textContent = String(settings.warmup);
  $('warmup').setAttribute('aria-label', `Warm-up duration: ${settings.warmup} seconds. Activate to change.`);
  $('sound-name').textContent = sounds[settings.sound].name;
  $('sound-note').textContent = sounds[settings.sound].note;
  $('preview').setAttribute('aria-label', `Preview ${sounds[settings.sound].name}`);
  $('bowl').style.filter = settings.sound === 4 ? 'saturate(.65) brightness(1.2)' : `hue-rotate(${settings.sound * -4}deg)`;
  $('start').hidden = !setup; $('skip').hidden = state.phase !== 'warmup'; $('cancel').hidden = state.phase !== 'warmup'; $('end').hidden = state.phase !== 'meditation';
  for (const id of ['start', 'previous', 'next', 'warmup']) $<HTMLButtonElement>(id).disabled = busy;
  $('start').textContent = busy ? 'Preparing…' : 'Start';
}
$('start').addEventListener('click', async () => {
  if (busy || state.phase !== 'setup') return;
  setMinutes(Number(minutes.value)); busy = true; cancelPreview(); status(''); render();
  try { await prepare(settings.sound); dispatch('start'); }
  catch (error) { status((error as Error).message); }
  finally { busy = false; render(); }
});
$('skip').addEventListener('click', () => dispatch('skip'));
$('cancel').addEventListener('click', () => dispatch('cancel'));
$('end').addEventListener('click', () => dispatch('end'));
$('preview').addEventListener('click', preview);
$('previous').addEventListener('click', () => selectSound(-1));
$('next').addEventListener('click', () => selectSound(1));
document.querySelectorAll<HTMLButtonElement>('[data-warmup]').forEach(button => button.addEventListener('click', () => { settings.warmup = Number(button.dataset.warmup); save(); render(); $('warmup-options').hidePopover(); }));
minutes.addEventListener('change', () => setMinutes(Number(minutes.value)));
minutes.addEventListener('keydown', event => { if (event.key === 'Enter') { setMinutes(Number(minutes.value)); minutes.blur(); } });
document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach(button => button.addEventListener('click', () => setMinutes(Number(button.dataset.minutes))));
let drag: { pointer: number; kind: 'number' | 'ring'; y: number; value: number; angle: number; total: number } | undefined;
const angleAt = (event: PointerEvent) => { const rect = $('dial').getBoundingClientRect(); return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2); };
$('dial').addEventListener('pointerdown', event => {
  if (state.phase !== 'setup' || busy || (event.target as HTMLElement).closest('button')) return;
  const rect = $('dial').getBoundingClientRect();
  const distance = Math.hypot(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  const kind = event.target === minutes ? 'number' : 'ring';
  if (kind === 'ring' && distance < rect.width * .33) return;
  drag = { pointer: event.pointerId, kind, y: event.clientY, value: settings.minutes, angle: angleAt(event), total: 0 };
  if (kind === 'ring') { event.preventDefault(); $('dial').setPointerCapture(event.pointerId); }
});
$('dial').addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  if (drag.kind === 'number') { const movement = drag.y - event.clientY; if (Math.abs(movement) > 8) { event.preventDefault(); minutes.blur(); $('dial').setPointerCapture(event.pointerId); setMinutes(drag.value + Math.round(movement / 12)); } }
  else { const angle = angleAt(event); let delta = angle - drag.angle; if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2; drag.total += delta; drag.angle = angle; setMinutes(drag.value + Math.round(drag.total / (Math.PI * 2) * 20)); }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('dial').addEventListener(name, () => { drag = undefined; });
let swipeX = 0;
let swiped = false;
const instrumentRow = document.querySelector<HTMLElement>('.instrument-row')!;
instrumentRow.addEventListener('pointerdown', event => { swipeX = event.clientX; swiped = false; });
instrumentRow.addEventListener('pointerup', event => { const delta = event.clientX - swipeX; if (Math.abs(delta) > 45) { swiped = true; selectSound(delta < 0 ? 1 : -1); } });
instrumentRow.addEventListener('click', event => { if (swiped) { event.preventDefault(); event.stopPropagation(); swiped = false; } }, true);
$('about').addEventListener('click', () => $<HTMLDialogElement>('about-dialog').showModal());
$('close-about').addEventListener('click', () => $<HTMLDialogElement>('about-dialog').close());
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | undefined;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event as InstallEvent; $('install').hidden = false; });
$('install').addEventListener('click', async () => { await installEvent?.prompt(); await installEvent?.userChoice; $('install').hidden = true; installEvent = undefined; });
window.addEventListener('appinstalled', () => { $('install').hidden = true; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { dispatch('tick'); void keepAwake(); } });
setInterval(() => { if (state.phase !== 'setup') dispatch('tick'); }, 200);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(async registration => {
    const worker = registration.active || registration.installing || registration.waiting;
    const check = () => { if (registration.active) $('offline-status').textContent = 'Ready for offline use. Your timer and all sounds are saved on this device.'; };
    check(); worker?.addEventListener('statechange', check);
  }).catch(() => { $('offline-status').textContent = 'Offline preparation failed. Reconnect and reload to try again.'; }); });
}
render();




