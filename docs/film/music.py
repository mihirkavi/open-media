"""Original soundtrack for the Open Media film: 120 BPM, 64 s, synthesised with numpy."""
import numpy as np, wave, sys
SR = 48000; DUR = 64.0; N = int(SR * DUR)
dry = np.zeros((N, 2)); wet = np.zeros((N, 2))  # wet goes through reverb
rng = np.random.default_rng(3)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
BEAT = 0.5

def add(bus, sig, t0, pan=0.0, gain=1.0):
    i = int(t0 * SR); sig = sig[: max(0, N - i)]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    bus[i:i + len(sig), 0] += sig * l * gain * 1.414
    bus[i:i + len(sig), 1] += sig * r * gain * 1.414

def env(n, a, r, total):
    t = np.arange(n) / SR
    e = np.minimum(1, t / a) if a > 0 else np.ones(n)
    return e * np.clip((total - t) / r, 0, 1)

def pad(midis, t0, dur, gain=.05, bright=6):
    n = int((dur + 1.2) * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for m in midis:
        for det in (-0.07, 0, 0.06):
            f = hz(m + det)
            for h in range(1, bright + 1):
                if f * h > 9000: break
                out += np.sin(2 * np.pi * f * h * t + rng.random() * 6.28) / h ** 1.6
    return out * env(n, 0.7, 1.2, dur + 1.2) * gain / len(midis)

def pluck(m, dur=0.9, gain=.12):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) + .35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 9) + .12 * np.sin(6 * np.pi * f * t) * np.exp(-t * 14)
    return s * np.exp(-t * 4.5) * np.minimum(1, t / .004) * gain

def bell(m, gain=.08, dur=3.0):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) + .4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 3) + .2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 6)
    return s * np.exp(-t * 1.6) * np.minimum(1, t / .003) * gain

def kick(gain=.55):
    n = int(.45 * SR); t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t * 32); ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t * 7.5) + .3 * rng.standard_normal(n) * np.exp(-t * 300)) * gain

def hat(gain=.05, decay=45):
    n = int(.12 * SR); t = np.arange(n) / SR
    w = np.diff(rng.standard_normal(n + 1)); return w * np.exp(-t * decay) * gain

def clap(gain=.12):
    n = int(.3 * SR); t = np.arange(n) / SR; w = rng.standard_normal(n)
    w = w - np.convolve(w, np.ones(12) / 12, 'same')
    e = np.exp(-t * 22) * (1 + .6 * (np.sin(2 * np.pi * 90 * t) > 0) * (t < .03))
    return w * e * gain

def boom(gain=.9, dur=3.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 36 + 60 * np.exp(-t * 10); ph = 2 * np.pi * np.cumsum(f) / SR
    noise = rng.standard_normal(n); noise = np.convolve(noise, np.ones(40) / 40, 'same')
    return (np.sin(ph) * np.exp(-t * 1.6) + 2.5 * noise * np.exp(-t * 6)) * gain

def riser(dur, gain=.18):
    n = int(dur * SR); t = np.arange(n) / SR; k = t / dur
    noise = rng.standard_normal(n); hp = noise - np.convolve(noise, np.ones(30) / 30, 'same')
    f = 180 + 1400 * k ** 2; ph = 2 * np.pi * np.cumsum(f) / SR
    return (hp * .6 + np.sin(ph) * .25) * k ** 2.2 * gain

# Chords: A, F#m, D, E (one bar = 2 s)
PROG = [[57, 61, 64, 69], [54, 57, 61, 66], [50, 54, 57, 62], [52, 56, 59, 64]]
BASS = [45, 42, 38, 40]
ARP = [[69, 73, 76, 81], [66, 69, 73, 78], [62, 66, 69, 74], [64, 68, 71, 76]]

# A. Cold open 0–12.9: dark drone, bells on the words, ticking from 6 s, riser into the logo
add(wet, pad([33, 40, 45], 0, 12.6, gain=.10, bright=4), 0)
add(wet, pad([57, 64], 6, 6.6, gain=.035, bright=3), 6)
for tt, m in [(0.5, 81), (1.3, 76), (2.5, 69)]: add(wet, bell(m, .05), tt, pan=-.2 + .2 * (m % 3))
for b in range(12, 26):
    tt = b * BEAT; add(dry, hat(.025 + .002 * (b - 12), 70), tt, pan=.3)
add(wet, riser(2.3), 10.6, gain=1.0)

# B. Logo impact at 12.9
add(dry, boom(), 12.9); add(wet, boom(.35), 12.9)
add(wet, bell(81, .07, 4), 12.9); add(wet, bell(88, .04, 4), 12.95, pan=.4)

# C. Main body 13–49: progression, bass, plucks, drums building
for bar in range(int(13 // 2), 49 // 2 + 1):
    t0 = bar * 2.0
    if t0 + 2 <= 13 or t0 >= 49: continue
    c = (bar - 6) % 4
    start = max(t0, 13.0)
    add(wet, pad(PROG[c], start, t0 + 2 - start + .1, gain=.07), start)
    if t0 >= 16:
        n = int(2 * SR); tt = np.arange(n) / SR
        bass = np.sin(2 * np.pi * hz(BASS[c] - 12) * tt) * env(n, .02, .2, 2.0) * .16
        add(dry, bass, t0)
    for s in range(8):
        t = t0 + s * BEAT / 2
        if t < 16 or t >= 49: continue
        m = ARP[c][[0, 1, 2, 3, 2, 1, 2, 3][s]] + (12 if t >= 34 and s in (3, 7) else 0)
        add(wet, pluck(m, gain=.075), t, pan=-.35 if s % 2 else .35)
    for b in range(4):
        t = t0 + b * BEAT
        if 20 <= t < 49: add(dry, kick(.42 if t < 34 else .5), t)
        if 27 <= t < 49: add(dry, hat(.045), t + BEAT / 2, pan=.25)
        if 34 <= t < 49 and b in (1, 3): add(wet, clap(.09), t, pan=-.1)
add(wet, riser(1.6, .12), 47.4)

# D. Montage 49–53: one hit per word
for i in range(8):
    t = 49 + i * BEAT
    add(dry, kick(.62), t); add(wet, clap(.11), t)
    add(wet, pluck([81, 76, 78, 73, 81, 76, 80, 85][i], 1.2, .12), t, pan=.3 if i % 2 else -.3)
    add(dry, hat(.05), t + BEAT / 2)
add(wet, pad(PROG[0], 49, 4, gain=.06), 49)

# E. Mission 53–58.6: space, soft piano-like notes
add(wet, pad([45, 52, 57, 61, 64], 53, 5.8, gain=.075, bright=5), 53)
for tt, m in [(53.7, 76), (55.0, 73), (56.4, 69), (57.4, 71)]: add(wet, bell(m, .05, 3.5), tt)

# F. End card 58.6–64
add(dry, boom(.8, 4), 58.6); add(wet, boom(.3, 4), 58.6)
add(wet, pad([45, 57, 61, 64, 69, 73], 58.6, 4.6, gain=.09, bright=6), 58.6)
for tt, m in [(59.3, 81), (59.9, 85), (60.6, 88)]: add(wet, bell(m, .045, 3.5), tt, pan=.2)

# Reverb on the wet bus
ir_n = int(3.2 * SR); ti = np.arange(ir_n) / SR
for ch in range(2):
    ir = rng.standard_normal(ir_n) * np.exp(-ti / .75); ir[0] = 0
    ir = np.convolve(ir, np.ones(6) / 6, 'same')  # soften the tail
    L = 1 << int(np.ceil(np.log2(N + ir_n)))
    rev = np.fft.irfft(np.fft.rfft(wet[:, ch], L) * np.fft.rfft(ir, L), L)[:N]
    wet[:, ch] = wet[:, ch] * .55 + rev / np.max(np.abs(rev) + 1e-9) * np.max(np.abs(wet[:, ch])) * .9

mix = dry + wet
# fades
t = np.arange(N) / SR
mix *= np.clip(t / .05, 0, 1)[:, None] * np.clip((DUR - t) / 2.2, 0, 1)[:, None]
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
mix *= .9 / np.max(np.abs(mix))
out = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('wrote', len(out) / SR, 's')
