import { useEffect, useRef, useState } from 'react';
import type { Teste } from '../lib/database';
import { getPhase } from '../components/RaceStage';

type Sound = 'step1' | 'step2' | 'tick' | 'go' | 'win';
export function useRaceAudio(teste: Teste | null, now: number) {
  const [volume, setVolume] = useState(() => {
    try { const saved = localStorage.getItem('voltage-audio-v1'); return saved === null ? 0.35 : Math.max(0, Math.min(1, Number(saved) || 0)); }
    catch { return 0.35; }
  });
  const context = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const previous = useRef<{ round: number; phase: string; seconds: number; p1: number; p2: number } | null>(null);
  useEffect(() => {
    const unlock = () => {
      if (!context.current) {
        try {
          context.current = new AudioContext();
          gain.current = context.current.createGain();
          gain.current.gain.value = 0;
          gain.current.connect(context.current.destination);
        } catch { return; }
      }
      if (context.current.state === 'suspended') void context.current.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
      if (context.current) void context.current.close().catch(() => {});
      context.current = null; gain.current = null;
    };
  }, []);
  useEffect(() => { try { localStorage.setItem('voltage-audio-v1', String(volume)); } catch { /* preferência opcional */ } }, [volume]);
  const phase = teste ? getPhase(teste, now) : 'ready';
  const seconds = teste ? Math.ceil(((phase === 'countdown' ? Date.parse(teste.corrida_inicio!) : Date.parse(teste.corrida_fim!)) - now) / 1000) : 0;
  const p1 = teste?.infos_player_1.pisadas ?? 0;
  const p2 = teste?.infos_player_2.pisadas ?? 0;
  const round = teste?.rodada_atual ?? 0;
  useEffect(() => {
    const audio = context.current;
    const output = gain.current;
    if (audio && output) output.gain.setTargetAtTime(volume * 0.16, audio.currentTime, .025);
    function play(sound: Sound) {
      if (!audio || !output || audio.state !== 'running' || volume === 0 || document.hidden) return;
      const notes = sound === 'win' ? [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]
        : sound === 'go' ? [392, 523.25, 783.99] : [sound === 'step1' ? 220 : sound === 'step2' ? 330 : 660];
      notes.forEach((frequency, index) => {
        const start = audio.currentTime + index * .13;
        const length = sound === 'win' ? .32 : sound === 'go' ? .18 : .09;
        const oscillator = audio.createOscillator(); const envelope = audio.createGain();
        oscillator.type = sound.startsWith('step') ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start);
        if (sound.startsWith('step')) oscillator.frequency.exponentialRampToValueAtTime(frequency * .45, start + length);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(1, start + .008);
        envelope.gain.exponentialRampToValueAtTime(.001, start + length);
        oscillator.connect(envelope); envelope.connect(output);
        oscillator.start(start); oscillator.stop(start + length + .02);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      });
    }
    const old = previous.current;
    if (old) {
      if (phase === 'countdown' && (old.phase !== phase || old.seconds !== seconds)) play('tick');
      if (phase === 'running' && old.phase === 'countdown') play('go');
      if (phase === 'running' && seconds <= 10 && seconds > 0 && old.seconds !== seconds) play('tick');
      if (phase === 'running' && old.round === round) {
        if (p1 > old.p1) play('step1');
        if (p2 > old.p2) play('step2');
      }
      if (phase === 'finished' && old.phase !== 'finished' && teste &&
        now >= Date.parse(teste.corrida_fim ?? '') &&
        (teste.infos_player_1.distancia ?? 0) !== (teste.infos_player_2.distancia ?? 0)) play('win');
    }
    previous.current = { round, phase, seconds, p1, p2 };
  }, [phase, seconds, round, p1, p2, volume, teste, now]);
  return { volume, setVolume };
}
