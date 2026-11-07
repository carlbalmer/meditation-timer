// The swappable keep-alive piece. Chromium freezes a page whose audio output
// stays below about −72 dBFS for a minute, which stops the audio clock and the
// gongs with the screen off. This signal sits at about −60 dBFS RMS and below
// 60 Hz, where phone speakers are nearly silent (experiments/keepalive/RESULTS.md).

const LEVEL_DBFS = -60;
const CUTOFF_HZ = 50;
const SECONDS = 4;

export function keepAliveSignal(ctx: BaseAudioContext): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * SECONDS, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const k = 1 - Math.exp((-2 * Math.PI * CUTOFF_HZ) / ctx.sampleRate);
  let low = 0;
  let lower = 0;
  for (let i = 0; i < data.length; i++) {
    low += k * (Math.random() * 2 - 1 - low);
    lower += k * (low - lower);
    data[i] = lower;
  }
  const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
  const gain = 10 ** (LEVEL_DBFS / 20) / rms;
  for (let i = 0; i < data.length; i++) data[i] *= gain;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}
