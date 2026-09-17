"""Original arcade effects and a seamless CONEP chiptune (no external samples)."""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[1] / 'Expo-Crossy-Road-master/assets/audio'
TAU = math.tau


def write(name, samples):
    peak = max(1.0, max(abs(value) for value in samples))
    with wave.open(str(OUT / name), 'wb') as audio:
        audio.setparams((1, 2, RATE, len(samples), 'NONE', 'not compressed'))
        audio.writeframes(b''.join(struct.pack('<h', round(value / peak * 30000)) for value in samples))


def effect(character, frequency, duration, timbre, death=False):
    samples = []
    phase = 0.0
    for index in range(round(RATE * duration)):
        t = index / RATE
        progress = t / duration
        pitch = frequency * (1 - .65 * progress if death else 1 + .22 * math.sin(TAU * 8 * t))
        phase += TAU * pitch / RATE
        if timbre == 'grunt':
            value = math.sin(phase) + .5 * math.sin(phase * 2) + .25 * math.sin(phase * 3)
            value *= .65 + .35 * math.sin(TAU * 24 * t)
        elif timbre == 'pluck':
            value = math.sin(phase) + .3 * math.sin(phase * 3)
        elif timbre == 'square':
            value = math.tanh(3 * math.sin(phase)) * .65
        elif timbre == 'bell':
            value = math.sin(phase) + .35 * math.sin(phase * 2.76)
        elif timbre == 'whistle':
            value = math.sin(phase) * (.7 + .3 * math.sin(TAU * 11 * t))
        else:
            value = math.sin(phase) + .4 * math.sin(phase * 1.5)
        envelope = min(1, t / .012) * (1 - progress) ** (1.4 if death else 2.4)
        samples.append(value * envelope * .32)
    write(f'{character}-{"death" if death else "step"}.wav', samples)


for character, frequency, duration, timbre in [
    ('bacon', 110, .24, 'grunt'), ('avocoder', 740, .17, 'pluck'),
    ('brent', 240, .14, 'square'), ('wheeler', 520, .19, 'bell'),
    ('palmer', 980, .16, 'whistle'), ('juwan', 330, .21, 'warm'),
]:
    effect(character, frequency, duration, timbre)
    effect(character, frequency * .8, duration * 2, timbre, death=True)


# Eight bars in C / Am / F / G. Every voice ends before the buffer wraps.
beat = 60 / 112
length = 32 * beat
music = [0.0] * round(length * RATE)
rng = random.Random(2026)


def note(midi, start, duration, level, kind='lead'):
    frequency = 440 * 2 ** ((midi - 69) / 12)
    for index in range(round(duration * RATE)):
        target = round(start * RATE) + index
        if target >= len(music):
            break
        t = index / RATE
        envelope = min(1, t / .006) * min(1, (duration - t) / .025)
        phase = TAU * frequency * t
        value = math.sin(phase) if kind == 'bass' else (math.sin(phase) + .25 * math.sin(phase * 3))
        music[target] += value * envelope * level


chords = [(48, 52, 55), (45, 48, 52), (41, 45, 48), (43, 47, 50)] * 2
melody = [72, 76, 79, 76, 74, 72, 67, 71, 69, 72, 76, 72, 71, 69, 64, 67,
          65, 69, 72, 76, 74, 72, 69, 65, 67, 71, 74, 79, 77, 74, 71, 67] * 2
for bar, chord in enumerate(chords):
    for step in range(8):
        time = (bar * 4 + step / 2) * beat
        note(melody[bar * 8 + step], time, beat * .39, .09)
        note(chord[step % 3] + 12, time, beat * .30, .04)
    for pulse in range(4):
        time = (bar * 4 + pulse) * beat
        note(chord[0] - 12, time, beat * .70, .12, 'bass')
        for index in range(round(.10 * RATE)):
            target = round(time * RATE) + index
            t = index / RATE
            kick = math.sin(TAU * (65 * t + 50 * .02 * (1 - math.exp(-t / .02)))) * math.exp(-t * 45)
            hat = rng.uniform(-1, 1) * math.exp(-t * 90)
            music[target] += kick * .09 + hat * .018
write('conep-theme.wav', music)
print('Generated 12 character effects and conep-theme.wav')
