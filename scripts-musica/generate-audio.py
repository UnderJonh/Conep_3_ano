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


# Music helpers shared by the normal, near-record and victory progressions.
rng = random.Random(2026)


def create_music(bars=8, bpm=112):
    beat = 60 / bpm
    length = bars * 4 * beat
    return beat, [0.0] * round(length * RATE)


def add_note(buffer, midi, start, duration, level, kind='lead'):
    frequency = 440 * 2 ** ((midi - 69) / 12)
    for index in range(round(duration * RATE)):
        target = round(start * RATE) + index
        if target >= len(buffer):
            break
        t = index / RATE
        envelope = min(1, t / .006) * min(1, max(0, duration - t) / .025)
        phase = TAU * frequency * t
        if kind == 'bass':
            value = math.sin(phase) + .18 * math.sin(phase * 2)
        elif kind == 'fanfare':
            value = math.sin(phase) + .40 * math.sin(phase * 2) + .20 * math.sin(phase * 3)
        else:
            value = math.sin(phase) + .25 * math.sin(phase * 3)
        buffer[target] += value * envelope * level


def add_drum(buffer, time, kick_level=.09, hat_level=.018):
    for index in range(round(.10 * RATE)):
        target = round(time * RATE) + index
        if target >= len(buffer):
            break
        t = index / RATE
        kick = math.sin(TAU * (65 * t + 50 * .02 * (1 - math.exp(-t / .02)))) * math.exp(-t * 45)
        hat = rng.uniform(-1, 1) * math.exp(-t * 90)
        buffer[target] += kick * kick_level + hat * hat_level


# 1. Normal: C -> Am -> F -> G.
beat, music = create_music(8, 112)
chords = [(48, 52, 55), (45, 48, 52), (41, 45, 48), (43, 47, 50)] * 2
melody = [72, 76, 79, 76, 74, 72, 67, 71, 69, 72, 76, 72, 71, 69, 64, 67,
          65, 69, 72, 76, 74, 72, 69, 65, 67, 71, 74, 79, 77, 74, 71, 67] * 2
for bar, chord in enumerate(chords):
    for step in range(8):
        time = (bar * 4 + step / 2) * beat
        add_note(music, melody[bar * 8 + step], time, beat * .39, .09)
        add_note(music, chord[step % 3] + 12, time, beat * .30, .04)
    for pulse in range(4):
        time = (bar * 4 + pulse) * beat
        add_note(music, chord[0] - 12, time, beat * .70, .12, 'bass')
        add_drum(music, time)
write('conep-theme.wav', music)


# 2. Halfway to the record: Am -> F -> C -> G, faster and unresolved.
near_beat, near = create_music(8, 126)
near_chords = [
    (45, 48, 52), (41, 45, 48), (48, 52, 55), (43, 47, 50),
    (45, 48, 52), (41, 45, 48), (48, 52, 55), (43, 47, 50),
]
near_melody = [
    69, 72, 76, 72, 76, 79, 76, 72,
    69, 72, 77, 72, 74, 77, 81, 77,
    72, 76, 79, 76, 79, 84, 79, 76,
    71, 74, 79, 74, 79, 83, 81, 79,
    72, 76, 81, 76, 81, 84, 81, 76,
    77, 81, 84, 81, 84, 89, 84, 81,
    79, 84, 88, 84, 88, 91, 88, 84,
    79, 83, 86, 83, 86, 91, 89, 86,
]
for bar, chord in enumerate(near_chords):
    for step in range(8):
        time = (bar * 4 + step / 2) * near_beat
        add_note(near, near_melody[bar * 8 + step], time, near_beat * .32, .105)
        add_note(near, chord[step % 3] + 12, time, near_beat * .25, .045)
    for pulse in range(4):
        time = (bar * 4 + pulse) * near_beat
        add_note(near, chord[0] - 12, time, near_beat * .58, .13, 'bass')
        add_drum(near, time, kick_level=.11, hat_level=.025)
        add_drum(near, time + near_beat * .5, kick_level=0, hat_level=.020)
write('conep-near.wav', near)


# 3. Record beaten: C -> G -> Am -> F -> Dm -> G -> C -> C.
victory_beat, victory = create_music(8, 138)
victory_chords = [
    (48, 52, 55), (43, 47, 50), (45, 48, 52), (41, 45, 48),
    (50, 53, 57), (43, 47, 50), (48, 52, 55), (48, 52, 55),
]
victory_melody = [
    74, 79, 83, 86, 83, 86, 91, 86,
    76, 81, 84, 88, 84, 88, 93, 88,
    77, 81, 84, 89, 84, 89, 93, 89,
    74, 77, 81, 86, 81, 86, 89, 86,
    79, 83, 86, 91, 86, 91, 95, 91,
    84, 88, 91, 96, 91, 88, 91, 96,
    84, 88, 91, 96, 100, 96, 91, 96,
]
for bar, chord in enumerate(victory_chords):
    for step in range(8):
        time = (bar * 4 + step / 2) * victory_beat
        add_note(victory, victory_melody[bar * 8 + step], time, victory_beat * .34, .12, 'fanfare')
        add_note(victory, chord[step % 3] + 12, time, victory_beat * .27, .055)
    for pulse in range(4):
        time = (bar * 4 + pulse) * victory_beat
        add_note(victory, chord[0] - 12, time, victory_beat * .65, .15, 'bass')
        add_drum(victory, time, kick_level=.13, hat_level=.028)

# Three final C-major fanfare hits fit inside the last bar.
final_time = 28 * victory_beat
for midi in [72, 76, 79]:
    add_note(victory, midi, final_time, victory_beat * .8, .11, 'fanfare')
for midi in [76, 79, 84]:
    add_note(victory, midi, final_time + victory_beat, victory_beat * .8, .13, 'fanfare')
for midi in [60, 64, 67, 72, 76, 79, 84]:
    add_note(victory, midi, final_time + victory_beat * 2, victory_beat * 1.7, .09, 'fanfare')
write('conep-victory.wav', victory)

print('Generated character effects + conep-theme.wav + conep-near.wav + conep-victory.wav')
