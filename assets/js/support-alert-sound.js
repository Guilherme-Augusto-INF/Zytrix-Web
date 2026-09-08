export const SUPPORT_ALERT_SOUNDS = Object.freeze({
  coin: 'Moeda',
  bell: 'Sino',
  pop: 'Pop',
  soft: 'Suave',
  none: 'Sem som'
});

let audioContext = null;
let unlockInstalled = false;

export function normalizeSupportAlertSound(value = 'coin') {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUPPORT_ALERT_SOUNDS, key)
    ? key
    : 'coin';
}

function context() {
  if (audioContext) return audioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext = new AudioContextClass();
  return audioContext;
}

export async function unlockSupportAlertAudio() {
  const ctx = context();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

export function supportAlertAudioReady() {
  return Boolean(audioContext && audioContext.state === 'running');
}

function tone(ctx, start, frequency, duration, gain = 0.12, type = 'sine', endFrequency = frequency) {
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume);
  volume.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playSupportAlertSound(value = 'coin') {
  const sound = normalizeSupportAlertSound(value);
  if (sound === 'none') return true;
  const ctx = context();
  if (!ctx || ctx.state !== 'running') return false;
  const now = ctx.currentTime + 0.015;

  if (sound === 'bell') {
    tone(ctx, now, 880, 0.42, 0.10, 'sine', 660);
    tone(ctx, now + 0.03, 1320, 0.55, 0.055, 'sine', 990);
  } else if (sound === 'pop') {
    tone(ctx, now, 360, 0.12, 0.11, 'triangle', 720);
    tone(ctx, now + 0.11, 620, 0.13, 0.07, 'triangle', 920);
  } else if (sound === 'soft') {
    tone(ctx, now, 392, 0.32, 0.065, 'sine', 523.25);
    tone(ctx, now + 0.16, 523.25, 0.38, 0.055, 'sine', 659.25);
  } else {
    tone(ctx, now, 784, 0.12, 0.10, 'sine', 988);
    tone(ctx, now + 0.10, 988, 0.13, 0.09, 'sine', 1318);
    tone(ctx, now + 0.21, 1318, 0.20, 0.07, 'sine', 1568);
  }
  return true;
}

export function installSupportAlertAudioUnlock(onUnlocked) {
  if (unlockInstalled) return;
  unlockInstalled = true;
  const unlock = async () => {
    const ok = await unlockSupportAlertAudio();
    if (!ok) return;
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    onUnlocked?.();
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}
