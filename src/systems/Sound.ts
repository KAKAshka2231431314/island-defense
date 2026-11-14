// Звуки синтезируются кодом (WebAudio): в паках Tiny Swords аудио нет.
import { settings } from '../data/settings';

export type SfxName = 'hit' | 'swing' | 'arrow' | 'splash' | 'explosion' | 'horn' | 'fire' | 'click' | 'block' | 'death' | 'coin' | 'ready';

/** Не чаще одного звука одного типа за столько секунд (иначе в бою каша). */
const MIN_GAP: Record<SfxName, number> = {
  hit: 0.06, swing: 0.08, arrow: 0.07, splash: 0.15, explosion: 0.12, horn: 1, fire: 0.5, click: 0.03, block: 0.1, death: 0.12, coin: 0.05, ready: 0.2,
};

/** Общая громкость при settings.volume = 1. */
const MASTER_GAIN = 0.35;
/** Приглушение (замедление времени, поражение): частота среза фильтра без приглушения и при полном, Гц; доля громкости. */
const MUFFLE = { openHz: 18000, closedHz: 700, gain: 0.55, smoothSec: 0.08 };

export type AmbienceMood = 'calm' | 'tense';

/** В меню — море; в бою — тихая мелодия на обычных островах, гул и барабаны на сложных. */
const AMBIENT = {
  gain: 0.42,
  fadeInSec: 2.5,
  fadeOutSec: 0.6,
  noiseSec: 4,
  waveCutoff: 480,
  /** два медленных LFO разной частоты — накаты волн не повторяются ровно */
  waveLfoHz: [0.071, 0.113],
  waveDepth: 0.4,
  battleWaveGain: 0.22,
  windFreq: 850,
  windQ: 0.8,
  windGain: 0.1,
  windLfoHz: 0.045,
  windSweep: 380,
  gullEverySec: [7, 16] as [number, number],
  gullGain: 0.045,
  droneFreq: [55, 82.41],
  droneGain: 0.025,
  calmDroneFreq: [146.83, 220],
  calmDroneGain: 0.012,
  melodyEverySec: [3.8, 6.5] as [number, number],
  melodyNotes: [293.66, 349.23, 392, 440, 523.25],
  melodyGain: 0.055,
  pulseEverySec: [1.8, 2.8] as [number, number],
  pulseGain: 0.12,
};

interface Ambience {
  mood: AmbienceMood;
  battle: boolean;
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  gullTimer: number;
  pulseTimer: number;
  melodyTimer: number;
}

class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  private ambience: Ambience | null = null;
  private ambienceWanted: AmbienceMood | null = null;
  private ambienceBattle = false;
  /** приглушение 0..1 (фильтр низких частот на общем выходе) */
  private muffleFilter: BiquadFilterNode | null = null;
  private muffleGain: GainNode | null = null;
  private muffle = 0;

  /** Создаёт контекст при первом действии пользователя (иначе браузер не даст играть звук). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      // общий выход: громкость → фильтр приглушения → его громкость → динамики
      this.muffleFilter = this.ctx.createBiquadFilter();
      this.muffleFilter.type = 'lowpass';
      this.muffleGain = this.ctx.createGain();
      this.master.connect(this.muffleFilter).connect(this.muffleGain).connect(this.ctx.destination);
      this.setMuffle(this.muffle);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolume();
      if (this.ambienceWanted) this.startAmbienceNow();
    } catch {
      this.ctx = null;
    }
  }

  /** Приглушить звук (0 — обычный, 1 — глухо и тише): замедление времени, поражение. */
  setMuffle(amount: number): void {
    this.muffle = Math.max(0, Math.min(1, amount));
    if (!this.ctx || !this.muffleFilter || !this.muffleGain) return;
    const t = this.ctx.currentTime;
    // частота — по экспоненте, чтобы приглушение нарастало равномерно на слух
    const hz = MUFFLE.openHz * Math.pow(MUFFLE.closedHz / MUFFLE.openHz, this.muffle);
    this.muffleFilter.frequency.setTargetAtTime(hz, t, MUFFLE.smoothSec);
    this.muffleGain.gain.setTargetAtTime(1 - (1 - MUFFLE.gain) * this.muffle, t, MUFFLE.smoothSec);
  }

  /** Применить settings.volume / settings.sound (вызывать после изменения настроек). */
  applyVolume(): void {
    if (!this.ctx || !this.master) return;
    const v = settings.sound ? MASTER_GAIN * settings.volume : 0;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Включить фон меню/карты или отдельный боевой (заиграет после первого действия пользователя). */
  startAmbience(mood: AmbienceMood = 'calm', battle = false): void {
    this.ambienceWanted = mood;
    this.ambienceBattle = battle;
    if (this.ambience?.mood === mood && this.ambience.battle === battle) return;
    this.fadeAmbience();
    if (this.ctx) this.startAmbienceNow();
  }

  stopAmbience(): void {
    this.ambienceWanted = null;
    this.fadeAmbience();
  }

  private fadeAmbience(): void {
    const a = this.ambience;
    if (!a || !this.ctx) return;
    this.ambience = null;
    clearTimeout(a.gullTimer);
    clearTimeout(a.pulseTimer);
    clearTimeout(a.melodyTimer);
    const t = this.ctx.currentTime;
    a.out.gain.cancelScheduledValues(t);
    a.out.gain.setValueAtTime(a.out.gain.value, t);
    a.out.gain.linearRampToValueAtTime(0, t + AMBIENT.fadeOutSec);
    for (const src of a.sources) src.stop(t + AMBIENT.fadeOutSec + 0.05);
    setTimeout(() => a.out.disconnect(), (AMBIENT.fadeOutSec + 0.2) * 1000);
  }

  private startAmbienceNow(): void {
    if (this.ambience || !this.ctx || !this.master) return;
    const mood = this.ambienceWanted ?? 'calm';
    const battle = this.ambienceBattle;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(AMBIENT.gain, t + AMBIENT.fadeInSec);
    out.connect(this.master);
    const len = Math.floor(ctx.sampleRate * AMBIENT.noiseSec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const sources: AudioScheduledSourceNode[] = [];

    // волны: низкочастотный шум, громкость «дышит» от двух LFO
    const waves = ctx.createBufferSource();
    waves.buffer = buf;
    waves.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = AMBIENT.waveCutoff;
    const swell = ctx.createGain();
    swell.gain.value = 1 - AMBIENT.waveDepth;
    for (const hz of AMBIENT.waveLfoHz) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = hz;
      const depth = ctx.createGain();
      depth.gain.value = AMBIENT.waveDepth / 2;
      lfo.connect(depth).connect(swell.gain);
      lfo.start(t);
      sources.push(lfo);
    }
    const waveOut = ctx.createGain();
    waveOut.gain.value = battle ? AMBIENT.battleWaveGain : 1;
    waves.connect(lp).connect(swell).connect(waveOut).connect(out);
    waves.start(t);
    sources.push(waves);

    // ветер: узкая полоса шума, частота медленно гуляет
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = AMBIENT.windFreq;
    bp.Q.value = AMBIENT.windQ;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = AMBIENT.windLfoHz;
    const sweep = ctx.createGain();
    sweep.gain.value = AMBIENT.windSweep;
    windLfo.connect(sweep).connect(bp.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = AMBIENT.windGain;
    wind.connect(bp).connect(windGain).connect(out);
    wind.start(t, AMBIENT.noiseSec / 2);
    windLfo.start(t);
    sources.push(wind, windLfo);

    if (battle) {
      const frequencies = mood === 'tense' ? AMBIENT.droneFreq : AMBIENT.calmDroneFreq;
      for (const frequency of frequencies) {
        const drone = ctx.createOscillator();
        drone.type = 'sine';
        drone.frequency.value = frequency;
        const gain = ctx.createGain();
        gain.gain.value = mood === 'tense' ? AMBIENT.droneGain : AMBIENT.calmDroneGain;
        drone.connect(gain).connect(out);
        drone.start(t);
        sources.push(drone);
      }
    }

    this.ambience = { mood, battle, out, sources, gullTimer: 0, pulseTimer: 0, melodyTimer: 0 };
    if (!battle) this.scheduleGull();
    else if (mood === 'tense') this.schedulePulse();
    else this.scheduleMelody();
  }

  /** Редкий крик чайки: два коротких нисходящих «кьяу». */
  private scheduleGull(): void {
    const a = this.ambience;
    if (!a) return;
    const [lo, hi] = AMBIENT.gullEverySec;
    a.gullTimer = window.setTimeout(() => {
      if (this.ambience !== a || !this.ctx) return;
      const now = this.ctx.currentTime;
      const g = AMBIENT.gullGain * (0.6 + Math.random() * 0.4);
      const f = 1350 + Math.random() * 300;
      this.tone(now, f, f * 0.68, 0.24, 'triangle', g, 0.03, a.out);
      this.tone(now + 0.3, f * 0.95, f * 0.64, 0.2, 'triangle', g * 0.8, 0.03, a.out);
      this.scheduleGull();
    }, (lo + Math.random() * (hi - lo)) * 1000);
  }

  /** Неспешные ноты на обычных островах: короткие фразы с паузами, без навязчивого повторения. */
  private scheduleMelody(): void {
    const a = this.ambience;
    if (!a) return;
    const [lo, hi] = AMBIENT.melodyEverySec;
    a.melodyTimer = window.setTimeout(() => {
      if (this.ambience !== a || !this.ctx) return;
      const now = this.ctx.currentTime;
      const note = AMBIENT.melodyNotes[Math.floor(Math.random() * AMBIENT.melodyNotes.length)];
      this.tone(now, note, note, 1.8, 'triangle', AMBIENT.melodyGain, 0.12, a.out);
      this.tone(now, note * 2, note * 2, 1.4, 'sine', AMBIENT.melodyGain * 0.22, 0.15, a.out);
      if (Math.random() < 0.45) {
        const next = AMBIENT.melodyNotes[Math.floor(Math.random() * AMBIENT.melodyNotes.length)];
        this.tone(now + 0.85, next, next, 1.5, 'triangle', AMBIENT.melodyGain * 0.75, 0.1, a.out);
      }
      this.scheduleMelody();
    }, (lo + Math.random() * (hi - lo)) * 1000);
  }

  /** Глухой удар на тревожных островах: редкий, с неровным интервалом и иногда со вторым эхом. */
  private schedulePulse(): void {
    const a = this.ambience;
    if (!a) return;
    const [lo, hi] = AMBIENT.pulseEverySec;
    a.pulseTimer = window.setTimeout(() => {
      if (this.ambience !== a || !this.ctx) return;
      const now = this.ctx.currentTime;
      this.tone(now, 95, 42, 0.38, 'sine', AMBIENT.pulseGain, 0.008, a.out);
      if (Math.random() < 0.35) this.tone(now + 0.42, 75, 40, 0.3, 'sine', AMBIENT.pulseGain * 0.55, 0.008, a.out);
      this.schedulePulse();
    }, (lo + Math.random() * (hi - lo)) * 1000);
  }

  play(name: SfxName, volume = 1): void {
    if (!settings.sound || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < MIN_GAP[name]) return;
    this.last.set(name, now);
    const v = volume;
    switch (name) {
      case 'hit': this.noiseBurst(now, 0.08, 900, 'lowpass', 0.5 * v); this.tone(now, 90, 50, 0.08, 'sine', 0.5 * v); break;
      case 'swing': this.noiseBurst(now, 0.12, 2500, 'bandpass', 0.18 * v, 600); break;
      case 'arrow': this.noiseBurst(now, 0.1, 4000, 'highpass', 0.12 * v); this.tone(now, 1400, 700, 0.08, 'triangle', 0.05 * v); break;
      case 'splash': this.noiseBurst(now, 0.35, 1200, 'lowpass', 0.4 * v, 300); break;
      case 'explosion': this.noiseBurst(now, 0.6, 700, 'lowpass', 0.8 * v, 120); this.tone(now, 70, 30, 0.5, 'sine', 0.7 * v); break;
      case 'horn':
        this.tone(now, 196, 196, 1.1, 'sawtooth', 0.12 * v, 0.15);
        this.tone(now, 294, 294, 1.1, 'sawtooth', 0.07 * v, 0.15);
        break;
      case 'fire': this.noiseBurst(now, 0.5, 1800, 'bandpass', 0.15 * v, 500); break;
      case 'click': this.tone(now, 660, 520, 0.05, 'square', 0.06 * v); break;
      case 'block': this.tone(now, 1800, 1500, 0.09, 'square', 0.08 * v); this.tone(now, 2600, 2300, 0.06, 'triangle', 0.05 * v); break;
      case 'death': this.tone(now, 300, 120, 0.25, 'triangle', 0.12 * v); break;
      // звон монеты: два коротких высоких тона
      case 'coin': this.tone(now, 1320, 1320, 0.09, 'square', 0.05 * v); this.tone(now + 0.07, 1760, 1760, 0.16, 'square', 0.05 * v); break;
      // способность готова: короткий восходящий звук
      case 'ready': this.tone(now, 520, 880, 0.14, 'triangle', 0.08 * v); break;
    }
  }

  private tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number, attack = 0.005, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(t: number, dur: number, freq: number, type: BiquadFilterType, vol: number, freqEnd?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
}

export const sfx = new SoundSystem();
