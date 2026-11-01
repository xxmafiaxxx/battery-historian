/**
 * Tiny synthesized UI sound kit (Web Audio API, no audio assets).
 *
 * All sounds are short synthesized blips so the app stays dependency-free and
 * works offline. Muted state persists in localStorage; browsers require a
 * user gesture before audio may start, which every caller satisfies (sounds
 * fire from click/submit handlers).
 */

const MUTE_KEY = 'bh-muted';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (isMuted()) {
    return null;
  }
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        return null;
      }
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // Private mode etc. — sounds just won't persist their mute state.
  }
}

interface ToneOpts {
  freq: number;
  endFreq?: number;
  durMs: number;
  type?: OscillatorType;
  gain?: number;
  delayMs?: number;
}

function tone({ freq, endFreq, durMs, type = 'sine', gain = 0.12, delayMs = 0 }: ToneOpts): void {
  const ac = audio();
  if (!ac) {
    return;
  }
  const t0 = ac.currentTime + delayMs / 1000;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + durMs / 1000);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

/** Soft UI click for buttons. */
export function click(): void {
  tone({ freq: 880, endFreq: 620, durMs: 55, type: 'sine', gain: 0.06 });
}

/** Success chime when an analysis finishes. */
export function success(): void {
  tone({ freq: 659.25, durMs: 130, type: 'triangle', gain: 0.1 }); // E5
  tone({ freq: 880, durMs: 170, type: 'triangle', gain: 0.1, delayMs: 110 }); // A5
}

/** Low buzz for failures. */
export function errorBuzz(): void {
  tone({ freq: 190, endFreq: 120, durMs: 260, type: 'sawtooth', gain: 0.08 });
}

/** Rising three-note arpeggio for a finished device pull. */
export function pullComplete(): void {
  tone({ freq: 523.25, durMs: 110, type: 'triangle', gain: 0.09 }); // C5
  tone({ freq: 659.25, durMs: 110, type: 'triangle', gain: 0.09, delayMs: 100 }); // E5
  tone({ freq: 783.99, durMs: 200, type: 'triangle', gain: 0.1, delayMs: 200 }); // G5
}

/** Tiny tick used as progress feedback while adb works. */
export function tick(): void {
  tone({ freq: 1250, durMs: 22, type: 'square', gain: 0.03 });
}
