import theme from '../../../Expo-Crossy-Road-master/assets/audio/conep-theme.wav?url';

let context;
let output;
let musicOutput;
let musicVolume = .28;
let backgroundPlayer;
let volume = .6;
let paused = false;
let revision = 0;
let samplePlayer;
const buffers = new Map();
const players = new Set();

function getContext() {
  if (!context || context.state === 'closed') {
    context = new AudioContext();
    output = context.createGain();
    output.gain.value = volume;
    output.connect(context.destination);
    musicOutput = context.createGain();
    musicOutput.gain.value = musicVolume;
    musicOutput.connect(context.destination);
    buffers.clear();
  }
  return context;
}

export function unlockAudio() {
  const audio = getContext();
  if (audio.state === 'suspended') void audio.resume().then(syncMusic).catch(() => {});
  else syncMusic();
}

export function setGameVolume(value) {
  volume = Math.max(0, Math.min(1, value));
  revision++;
  if (output) output.gain.value = volume;
  if (!volume) players.forEach(player => { if (!player.isMusic) player.pause(); });
  syncMusic();
}

export function setMusicVolume(value) {
  musicVolume = Math.max(0, Math.min(1, value));
  if (musicOutput) musicOutput.gain.value = musicVolume;
  if (!musicVolume) backgroundPlayer?.pause();
  else syncMusic();
}

function syncMusic() {
  if (!musicVolume || paused || context?.state !== 'running') return;
  backgroundPlayer ??= createAudioPlayer(theme, { music: true, loop: true });
  if (!backgroundPlayer.playing) void backgroundPlayer.play();
}

export function pauseGameAudio(value) {
  paused = value;
  revision++;
  if (value) players.forEach(player => player.pause());
  else syncMusic();
}

export function createAudioPlayer(resource, options = {}) {
  const url = typeof resource === 'string' ? resource : resource.uri;
  let source;
  let gain;
  let playerVolume = 1;
  let request = 0;
  const player = {
    isMusic: !!options.music,
    get playing() { return !!source; },
    get volume() { return playerVolume; },
    set volume(value) { playerVolume = value; if (gain) gain.gain.value = value; },
    async play(preview = false) {
      if (!(options.music ? musicVolume : volume) || (paused && !preview)) return;
      const audio = getContext();
      if (audio.state !== 'running') return;
      const currentRequest = ++request;
      const currentRevision = revision;
      try {
        if (!buffers.has(url)) {
          const pending = fetch(url).then(response => {
            if (!response.ok) throw new Error(`Não foi possível carregar o som (${response.status}).`);
            return response.arrayBuffer();
          }).then(data => audio.decodeAudioData(data));
          buffers.set(url, pending);
          pending.catch(() => { if (buffers.get(url) === pending) buffers.delete(url); });
        }
        const buffer = await buffers.get(url);
        if (request !== currentRequest || revision !== currentRevision || !(options.music ? musicVolume : volume) || (paused && !preview) || audio.state !== 'running') return;
        player.pause();
        source = audio.createBufferSource();
        source.buffer = buffer;
        source.loop = !!options.loop;
        gain = audio.createGain();
        gain.gain.value = playerVolume;
        source.connect(gain); gain.connect(options.music ? musicOutput : output);
        const activeSource = source;
        const activeGain = gain;
        source.onended = () => {
          activeSource.disconnect(); activeGain.disconnect();
          if (source === activeSource) { source = undefined; gain = undefined; }
        };
        source.start();
      } catch (error) { console.warn('Não foi possível reproduzir o som.', error); }
    },
    pause() {
      request++;
      if (source) { source.stop(); source.disconnect(); source = undefined; }
      if (gain) { gain.disconnect(); gain = undefined; }
    },
    seekTo() { player.pause(); },
    remove() { player.pause(); players.delete(player); },
  };
  players.add(player);
  return player;
}

export async function playAudioSample(resource) {
  unlockAudio();
  if (context.state === 'suspended') await context.resume().catch(() => {});
  samplePlayer?.remove();
  samplePlayer = createAudioPlayer(resource);
  await samplePlayer.play(true);
}

export async function playMusicSample() {
  unlockAudio();
  if (context.state === 'suspended') await context.resume().catch(() => {});
  backgroundPlayer ??= createAudioPlayer(theme, { music: true, loop: true });
  if (!backgroundPlayer.playing) await backgroundPlayer.play(true);
}

export function disposeAudio() {
  revision++;
  players.forEach(player => player.remove());
  if (context) void context.close().catch(() => {});
  context = undefined; output = undefined; musicOutput = undefined; buffers.clear(); paused = false;
  backgroundPlayer = undefined;
  samplePlayer = undefined;
}
