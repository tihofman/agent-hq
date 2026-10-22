/**
 * Chiptune Audio Synthesizer (Agent-HQ)
 *
 * NOTE ON AUDIO ASSET LICENSING:
 * All sound effects in this module are generated dynamically in real time
 * via the standard Web Audio API (OscillatorNode with square, triangle, or
 * sawtooth waveforms and GainNode volume envelopes).
 * No external audio files, samples, or third-party copyrighted sound assets
 * are used or bundled.
 */

export type SoundType = 'levelUp' | 'doorbell' | 'buzzer';

const AUDIO_STORAGE_KEY = 'agent-hq:audio';

let audioCtx: AudioContext | null = null;
let audioEnabledMemory: boolean | null = null;

export function getAudioContext(): AudioContext | null {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }
  const AudioCtx =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : typeof window !== 'undefined'
        ? (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
  if (!AudioCtx) return null;
  audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function setAudioContextForTesting(mock: AudioContext | null): void {
  audioCtx = mock;
}

export function isAudioEnabled(): boolean {
  if (audioEnabledMemory !== null) return audioEnabledMemory;
  if (typeof localStorage === 'undefined') return false;
  try {
    const val = localStorage.getItem(AUDIO_STORAGE_KEY);
    // Default is muted (false)
    audioEnabledMemory = val === 'true';
    return audioEnabledMemory;
  } catch {
    return false;
  }
}

export function setAudioEnabled(enabled: boolean): void {
  audioEnabledMemory = enabled;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage write errors (e.g. private browsing mode)
  }
}

export function resetAudioStateForTesting(): void {
  audioEnabledMemory = null;
  audioCtx = null;
}

export function soundFor(event: unknown): SoundType | null {
  if (!event || typeof event !== 'object') return null;
  if (!('event' in event)) return null;

  const ev = (event as { event: unknown }).event;
  if (ev === 'PR_READY' || ev === 'MERGED') {
    return 'levelUp';
  }
  if (ev === 'TASK_HANDOVER') {
    return 'doorbell';
  }
  if (ev === 'TASK_FAILED' || ev === 'CI_CHECK_FAIL') {
    return 'buzzer';
  }
  return null;
}

export interface NoteDef {
  freq: number;
  start: number;
  dur: number;
}

/**
 * Shared helper for WebAudio oscillator synthesis and envelope generation.
 * Disconnects audio nodes in onended to prevent memory leaks.
 */
export function playNotes(
  type: OscillatorType,
  notes: NoteDef[],
  peak = 0.12,
): void {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  for (const { freq, start, dur } of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + start);

    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.linearRampToValueAtTime(peak, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Safe disconnect
      }
    };

    osc.start(now + start);
    osc.stop(now + start + dur + 0.01);
  }
}

/**
 * Level-Up Fanfare (Ascending square-wave arpeggio: C5 -> E5 -> G5 -> C6)
 * Played on PR_READY or MERGED.
 */
export function playLevelUp(): void {
  playNotes(
    'square',
    [
      { freq: 523.25, start: 0.0, dur: 0.08 }, // C5
      { freq: 659.25, start: 0.08, dur: 0.08 }, // E5
      { freq: 783.99, start: 0.16, dur: 0.08 }, // G5
      { freq: 1046.5, start: 0.24, dur: 0.25 }, // C6
    ],
    0.12,
  );
}

/**
 * Doorbell / Chime (Warm two-tone triangle chime: E5 -> C5)
 * Played on TASK_HANDOVER.
 */
export function playDoorbell(): void {
  playNotes(
    'triangle',
    [
      { freq: 659.25, start: 0.0, dur: 0.15 }, // E5
      { freq: 523.25, start: 0.14, dur: 0.35 }, // C5
    ],
    0.15,
  );
}

/**
 * Buzzer / Glitch (Harsh low sawtooth double-pulse)
 * Played on TASK_FAILED or CI_CHECK_FAIL.
 */
export function playBuzzer(): void {
  playNotes(
    'sawtooth',
    [
      { freq: 150, start: 0.0, dur: 0.12 },
      { freq: 110, start: 0.14, dur: 0.22 },
    ],
    0.12,
  );
}
