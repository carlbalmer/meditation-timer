const base = import.meta.env.BASE_URL;
export const sounds = [
  { name: 'Himalayan Bowl', note: 'A warm, rounded tone · B2', file: '138666__cpt_asteroid__sound-bowl-foot-left-b2.wav', source: '138666' },
  { name: 'Resonant Bowl', note: 'A gentle, spacious tone · A2', file: '138667__cpt_asteroid__sound-bowl-belly-a2.wav', source: '138667' },
  { name: 'Bright Bowl', note: 'A clear, light tone · A3', file: '138670__cpt_asteroid__sound-bowl-head-top-a3.wav', source: '138670' },
  { name: 'Deep Bowl', note: 'A low, grounding tone · C♯2', file: '138675__cpt_asteroid__sound-bowl-heart-c2.wav', source: '138675' },
  { name: 'Tingsha Chime', note: 'A bright, lingering chime · D♯5', file: '138676__cpt_asteroid__zimbel-d5.wav', source: '138676' },
];
let context: AudioContext | undefined;
let playing: AudioBufferSourceNode | undefined;
const buffers = new Map<number, AudioBuffer>();
export async function prepare(index: number) {
  context ??= new AudioContext();
  await context.resume();
  if (context.state !== 'running') throw new Error('Audio is unavailable. Tap Start again to enable sound.');
  if (!buffers.has(index)) {
    const response = await fetch(`${base}sounds/${sounds[index].file}`);
    if (!response.ok) throw new Error('The sound could not load. Check your connection and try again.');
    buffers.set(index, await context.decodeAudioData(await response.arrayBuffer()));
  }
}
export function stop() { playing?.stop(); playing = undefined; }
export function play(index: number, preview = false) {
  if (!context || context.state !== 'running' || !buffers.has(index)) throw new Error('Audio was interrupted. Keep the app open and start again.');
  stop();
  const source = context.createBufferSource();
  source.buffer = buffers.get(index)!;
  const gain = context.createGain();
  source.connect(gain); gain.connect(context.destination);
  if (preview) { gain.gain.setValueAtTime(1, context.currentTime); gain.gain.setValueAtTime(1, context.currentTime + 3); gain.gain.linearRampToValueAtTime(0, context.currentTime + 5); }
  source.start();
  if (preview) source.stop(context.currentTime + 5);
  playing = source;
  source.onended = () => { if (playing === source) playing = undefined; };
}


