import React, { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';

// ============================================================================
// 1. STRICT TYPESCRIPT INTERFACES & STUDIO CONFIGURATION
// ============================================================================

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type SlingshotPhase = 'IDLE' | 'AIMING' | 'FIRED';

interface DistractionConfig {
  readonly id: string;
  readonly text: string;
  readonly code: string;
  readonly width: number;
  readonly height: number;
  readonly speed: number;
  readonly rangeRatio: number;
  readonly phaseOffset: number;
}

interface DistractionEntity extends DistractionConfig {
  body: Matter.Body;
  baseY: number;
  hitFlash: number;
  shudderX: number;
  shudderY: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
  isStar: boolean;
  rotation: number;
  vRot: number;
}

interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
  lineWidth: number;
  speed: number;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  subtext?: string;
  alpha: number;
  scale: number;
  color: string;
}

interface TrailPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  radius: number;
}

interface StarNode {
  xRatio: number;
  yRatio: number;
  size: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
}

interface TelemetryState {
  isOn: boolean;
  shots: number;
  hits: number;
  consecutiveHits: number;
  bestStreak: number;
  consecutiveMisses: number;
  score: number;
  highScore: number;
  isNewHighScore: boolean;
  soundOn: boolean;
  rebooting: boolean;
  cinemaMode: boolean;
  aimAssist: boolean;
  canQuickReload: boolean;
}

const HS_KEY = 'heroScene_highScore';

const DISTRACTION_CONFIGS: readonly DistractionConfig[] = [
  { id: 'procrastination', text: 'PROCRASTINATION', code: 'ERR_01', width: 178, height: 30, speed: 0.0014, rangeRatio: 0.24, phaseOffset: 0 },
  { id: 'fear', text: 'FEAR', code: 'ERR_02', width: 106, height: 30, speed: 0.0026, rangeRatio: 0.19, phaseOffset: Math.PI * 0.5 },
  { id: 'self-doubt', text: 'SELF-DOUBT', code: 'ERR_03', width: 142, height: 30, speed: 0.0019, rangeRatio: 0.22, phaseOffset: Math.PI },
  { id: 'anxiety', text: 'ANXIETY', code: 'ERR_04', width: 122, height: 30, speed: 0.0031, rangeRatio: 0.17, phaseOffset: Math.PI * 1.5 },
  { id: 'overthinking', text: 'OVERTHINKING', code: 'ERR_05', width: 162, height: 30, speed: 0.0017, rangeRatio: 0.21, phaseOffset: Math.PI * 0.25 },
];

const PENTATONIC_SCALE: readonly number[] = [523.25, 659.25, 783.99, 987.77, 1174.66, 1318.51, 1567.98];

// Deterministic Physics Calibration Constants
const FIXED_TIMESTEP_MS = 1000 / 60;
const FIXED_TIMESTEP_SEC = 1 / 60;
const MAX_PULL_DISTANCE = 175;
const LAUNCH_VELOCITY_SCALE = 0.24;
const PROJECTILE_AIR_FRICTION = 0.004;
const MATTER_GRAVITY_SCALE = 0.001;

// ============================================================================
// 2. PROCEDURAL WEB AUDIO SYNTHESIZER ENGINE (LEAK-FREE STUDIO DSP)
// ============================================================================

class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private pullOsc1: OscillatorNode | null = null;
  private pullOsc2: OscillatorNode | null = null;
  private pullGain: GainNode | null = null;
  private pullFilter: BiquadFilterNode | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public startPullTension(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopPullTension();

    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(90, now);
      osc2.frequency.setValueAtTime(180, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(240, now);
      filter.Q.setValueAtTime(4.0, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.07);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);

      this.pullOsc1 = osc1;
      this.pullOsc2 = osc2;
      this.pullFilter = filter;
      this.pullGain = gain;
    } catch {}
  }

  public updatePullTension(normalizedTension: number, enabled: boolean): void {
    if (!enabled || !this.ctx || !this.pullOsc1 || !this.pullOsc2 || !this.pullFilter || !this.pullGain) return;
    try {
      const now = this.ctx.currentTime;
      const clamped = Math.max(0, Math.min(1, normalizedTension));
      const baseFreq = 90 + clamped * 260;
      this.pullOsc1.frequency.setTargetAtTime(baseFreq, now, 0.025);
      this.pullOsc2.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.025);
      this.pullFilter.frequency.setTargetAtTime(240 + clamped * 1250, now, 0.025);
      this.pullGain.gain.setTargetAtTime(0.02 + clamped * 0.075, now, 0.025);
    } catch {}
  }

  public stopPullTension(): void {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const g = this.pullGain;
      const f = this.pullFilter;
      const o1 = this.pullOsc1;
      const o2 = this.pullOsc2;

      if (g) {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0.0001, now, 0.02);
      }
      setTimeout(() => {
        try {
          o1?.stop();
          o2?.stop();
          o1?.disconnect();
          o2?.disconnect();
          f?.disconnect();
          g?.disconnect();
        } catch {}
      }, 65);
    } catch {}
    this.pullOsc1 = null;
    this.pullOsc2 = null;
    this.pullFilter = null;
    this.pullGain = null;
  }

  public playLockTick(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1240, now);
      osc.frequency.exponentialRampToValueAtTime(1860, now + 0.045);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.055);
      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      }, 80);
    } catch {}
  }

  public playReleaseSnap(tension: number, enabled: boolean): void {
    this.stopPullTension();
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      sub.type = 'sine';
      const startF = 250 + tension * 240;
      osc.frequency.setValueAtTime(startF, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.19);

      sub.frequency.setValueAtTime(startF * 0.5, now);
      sub.frequency.exponentialRampToValueAtTime(32, now + 0.19);

      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(gain);
      sub.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      sub.start(now);
      osc.stop(now + 0.2);
      sub.stop(now + 0.2);

      setTimeout(() => {
        try {
          osc.disconnect();
          sub.disconnect();
          gain.disconnect();
        } catch {}
      }, 260);
    } catch {}
  }

  public playDreamHitChime(streak: number, enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const baseIdx = Math.min(streak, PENTATONIC_SCALE.length - 3);
      const chord = [
        PENTATONIC_SCALE[baseIdx],
        PENTATONIC_SCALE[baseIdx + 1],
        PENTATONIC_SCALE[baseIdx + 2],
      ];

      const delay = ctx.createDelay();
      const feedback = ctx.createGain();
      const delayFilter = ctx.createBiquadFilter();
      const masterWet = ctx.createGain();

      delay.delayTime.setValueAtTime(0.15, now);
      feedback.gain.setValueAtTime(0.35, now);
      delayFilter.type = 'lowpass';
      delayFilter.frequency.setValueAtTime(2400, now);
      masterWet.gain.setValueAtTime(0.65, now);
      masterWet.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

      delay.connect(delayFilter);
      delayFilter.connect(feedback);
      feedback.connect(delay);
      delay.connect(masterWet);
      masterWet.connect(ctx.destination);

      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noteStart = now + idx * 0.042;

        osc.type = idx === 2 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.004, noteStart + 1.15);

        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.linearRampToValueAtTime(0.2 / (idx + 1), noteStart + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0006, noteStart + 1.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.connect(delay);

        osc.start(noteStart);
        osc.stop(noteStart + 1.35);

        setTimeout(() => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
        }, 1600);
      });

      setTimeout(() => {
        try {
          delay.disconnect();
          delayFilter.disconnect();
          feedback.disconnect();
          masterWet.disconnect();
        } catch {}
      }, 2550);
    } catch {}
  }

  public playZenAscensionPad(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const freqs = [261.63, 329.63, 392.0, 493.88, 587.33, 783.99];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = i % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(f * 0.5, now);
        osc.frequency.exponentialRampToValueAtTime(f, now + 0.42);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, now);
        filter.frequency.exponentialRampToValueAtTime(2800, now + 0.95);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.055, now + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0005, now + 2.5);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 2.55);

        setTimeout(() => {
          try {
            osc.disconnect();
            filter.disconnect();
            gain.disconnect();
          } catch {}
        }, 2700);
      });
    } catch {}
  }

  public playDistractionHit(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(155, now);
      osc.frequency.exponentialRampToValueAtTime(36, now + 0.18);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(440, now);
      filter.Q.setValueAtTime(2.8, now);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.2);

      setTimeout(() => {
        try {
          osc.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {}
      }, 260);
    } catch {}
  }

  public playWallBounce(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(165, now);
      osc.frequency.exponentialRampToValueAtTime(62, now + 0.08);

      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);

      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      }, 130);
    } catch {}
  }

  public playBurnoutPowerDown(enabled: boolean): void {
    this.stopPullTension();
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      sub.type = 'sine';
      osc.frequency.setValueAtTime(195, now);
      osc.frequency.exponentialRampToValueAtTime(26, now + 0.95);
      sub.frequency.setValueAtTime(98, now);
      sub.frequency.exponentialRampToValueAtTime(18, now + 0.95);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(75, now + 0.95);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.98);

      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      sub.start(now);
      osc.stop(now + 1.0);
      sub.stop(now + 1.0);

      setTimeout(() => {
        try {
          osc.disconnect();
          sub.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {}
      }, 1150);
    } catch {}
  }

  public playSwitchToggle(turningOn: boolean, enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      if (turningOn) {
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      } else {
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(130, now + 0.14);
      }

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);

      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      }, 260);
    } catch {}
  }

  public dispose(): void {
    this.stopPullTension();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

// ============================================================================
// 3. MAIN STUDIO COMPONENT (DETERMINISTIC SLINGSHOT + AAA CANVAS RENDERER)
// ============================================================================

export default function App(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<ProceduralAudioEngine | null>(null);
  const [showControlsHint, setShowControlsHint] = useState<boolean>(true);

  const [telemetry, setTelemetry] = useState<TelemetryState>({
    isOn: true,
    shots: 0,
    hits: 0,
    consecutiveHits: 0,
    bestStreak: 0,
    consecutiveMisses: 0,
    score: 0,
    highScore: (() => { try { return parseInt(localStorage.getItem(HS_KEY) ?? '0', 10) || 0; } catch { return 0; } })(),
    isNewHighScore: false,
    soundOn: true,
    rebooting: false,
    cinemaMode: false,
    aimAssist: true,
    canQuickReload: false,
  });

  // High-frequency mutable simulation state decoupled from React renders
  const simRef = useRef<{
    isOn: boolean;
    soundOn: boolean;
    cinemaMode: boolean;
    aimAssist: boolean;
    canQuickReload: boolean;
    shots: number;
    hits: number;
    consecutiveHits: number;
    bestStreak: number;
    consecutiveMisses: number;
    score: number;
    highScore: number;
    isNewHighScore: boolean;
    rebootProgress: number;
    timeScale: number;
    hitStopTimer: number;
    shakeTrauma: number;
    shakeMaxOffset: number;
    shakeX: number;
    shakeY: number;
    shakeAngle: number;
    glitchAmount: number;
    bandSnapPhase: number;
    bandSnapAmp: number;
    cordPulseProgress: number;
    resetTrigger: (() => void) | null;
    quickReloadTrigger: (() => void) | null;
    togglePowerTrigger: ((nextOn: boolean) => void) | null;
  }>({
    isOn: true,
    soundOn: true,
    cinemaMode: false,
    aimAssist: true,
    canQuickReload: false,
    shots: 0,
    hits: 0,
    consecutiveHits: 0,
    bestStreak: 0,
    consecutiveMisses: 0,
    score: 0,
    highScore: (() => { try { return parseInt(localStorage.getItem(HS_KEY) ?? '0', 10) || 0; } catch { return 0; } })(),
    isNewHighScore: false,
    rebootProgress: 1,
    timeScale: 1,
    hitStopTimer: 0,
    shakeTrauma: 0,
    shakeMaxOffset: 16,
    shakeX: 0,
    shakeY: 0,
    shakeAngle: 0,
    glitchAmount: 0,
    bandSnapPhase: 0,
    bandSnapAmp: 0,
    cordPulseProgress: 0,
    resetTrigger: null,
    quickReloadTrigger: null,
    togglePowerTrigger: null,
  });

  const syncReactTelemetry = useCallback(() => {
    const s = simRef.current;
    // Check and persist new high score
    if (s.score > s.highScore) {
      s.highScore = s.score;
      s.isNewHighScore = true;
      try { localStorage.setItem(HS_KEY, String(s.highScore)); } catch {}
    }
    setTelemetry({
      isOn: s.isOn,
      shots: s.shots,
      hits: s.hits,
      consecutiveHits: s.consecutiveHits,
      bestStreak: s.bestStreak,
      consecutiveMisses: s.consecutiveMisses,
      score: s.score,
      highScore: s.highScore,
      isNewHighScore: s.isNewHighScore,
      soundOn: s.soundOn,
      rebooting: s.rebootProgress < 1 && s.isOn,
      cinemaMode: s.cinemaMode,
      aimAssist: s.aimAssist,
      canQuickReload: s.canQuickReload,
    });
  }, []);

  const handleToggleSwitch = useCallback(() => {
    const s = simRef.current;
    const nextIsOn = !s.isOn;
    s.isOn = nextIsOn;
    if (nextIsOn) {
      s.consecutiveMisses = 0;
      s.rebootProgress = 0.02;
    } else {
      s.rebootProgress = 0;
    }
    audioRef.current?.playSwitchToggle(nextIsOn, s.soundOn);
    s.togglePowerTrigger?.(nextIsOn);
    syncReactTelemetry();
  }, [syncReactTelemetry]);

  const handleToggleSound = useCallback(() => {
    const s = simRef.current;
    s.soundOn = !s.soundOn;
    if (!s.soundOn) {
      audioRef.current?.stopPullTension();
    } else {
      audioRef.current?.playSwitchToggle(true, true);
    }
    syncReactTelemetry();
  }, [syncReactTelemetry]);

  const handleToggleCinema = useCallback(() => {
    const s = simRef.current;
    s.cinemaMode = !s.cinemaMode;
    audioRef.current?.playLockTick(s.soundOn);
    syncReactTelemetry();
  }, [syncReactTelemetry]);

  const handleToggleAimAssist = useCallback(() => {
    const s = simRef.current;
    s.aimAssist = !s.aimAssist;
    audioRef.current?.playLockTick(s.soundOn);
    syncReactTelemetry();
  }, [syncReactTelemetry]);

  const handleQuickReload = useCallback(() => {
    simRef.current.quickReloadTrigger?.();
  }, []);

  const handleResetJourney = useCallback(() => {
    const s = simRef.current;
    s.isOn = true;
    s.shots = 0;
    s.hits = 0;
    s.consecutiveHits = 0;
    s.consecutiveMisses = 0;
    s.score = 0;
    s.isNewHighScore = false; // clear new-high badge on reset
    s.rebootProgress = 1;
    s.canQuickReload = false;
    audioRef.current?.playSwitchToggle(true, s.soundOn);
    s.resetTrigger?.();
    syncReactTelemetry();
  }, [syncReactTelemetry]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const audio = new ProceduralAudioEngine();
    audioRef.current = audio;

    const { Engine, World, Bodies, Constraint, Events, Vector, Body } = Matter;

    const engine = Engine.create({
      positionIterations: 10,
      velocityIterations: 8,
    });
    const world = engine.world;

    let width = container.clientWidth || window.innerWidth;
    let height = container.clientHeight || window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resizeCanvas = (w: number, h: number) => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas(width, height);

    // Responsive coordinate anchors
    const getLampAnchor = (w: number) => ({ x: w * 0.5, y: -45 });
    const getLampStart = (w: number, h: number) => ({
      x: w * 0.5,
      y: Math.max(170, Math.min(240, h * 0.26)),
    });
    const getSlingAnchor = (w: number, h: number) => ({
      x: Math.max(145, Math.min(250, w * 0.16)),
      y: h - Math.max(140, Math.min(195, h * 0.22)),
    });

    const lampRadius = 42;
    const projRadius = 15;
    let lampAnchor = getLampAnchor(width);
    let lampStart = getLampStart(width, height);
    let slingAnchor = getSlingAnchor(width, height);

    // 1. Swinging Pendulum Target ("THE DREAM")
    const lampBody = Bodies.circle(lampStart.x, lampStart.y, lampRadius, {
      restitution: 0.88,
      frictionAir: 0.007,
      density: 0.045,
      label: 'lamp',
    });

    const lampConstraint = Constraint.create({
      pointA: lampAnchor,
      bodyB: lampBody,
      stiffness: 0.98,
      length: lampStart.y - lampAnchor.y,
    });

    // 2. Dynamic Slingshot Projectile
    // CRITICAL: Keep isStatic = false ALWAYS so Matter.js never zeroes inverseMass or blocks velocity!
    const projectile = Bodies.circle(slingAnchor.x, slingAnchor.y, projRadius, {
      isStatic: false,
      restitution: 0.72,
      friction: 0.005,
      frictionAir: PROJECTILE_AIR_FRICTION,
      density: 0.055,
      label: 'projectile',
    });

    // 3. Dynamic Mental Friction Obstacles
    const buildDistractionY = (idx: number, total: number, h: number) => {
      const topY = Math.max(255, h * 0.36);
      const botY = h - Math.max(195, h * 0.27);
      const span = Math.max(140, botY - topY);
      return topY + (span / Math.max(1, total - 1)) * idx;
    };

    const distractions: DistractionEntity[] = DISTRACTION_CONFIGS.map((cfg, i) => {
      const y = buildDistractionY(i, DISTRACTION_CONFIGS.length, height);
      const body = Bodies.rectangle(width * 0.5, y, cfg.width, cfg.height, {
        isStatic: true,
        restitution: 0.92,
        label: 'distraction',
        chamfer: { radius: 15 },
      });
      return {
        ...cfg,
        body,
        baseY: y,
        hitFlash: 0,
        shudderX: 0,
        shudderY: 0,
      };
    });

    // 4. World Boundary Walls
    const wallThickness = 80;
    const ground = Bodies.rectangle(width / 2, height + wallThickness / 2, width * 3, wallThickness, {
      isStatic: true,
      restitution: 0.62,
      label: 'wall',
    });
    const ceiling = Bodies.rectangle(width / 2, -wallThickness * 2.5, width * 3, wallThickness, {
      isStatic: true,
      restitution: 0.62,
      label: 'wall',
    });
    const wallLeft = Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height * 3, {
      isStatic: true,
      restitution: 0.62,
      label: 'wall',
    });
    const wallRight = Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height * 3, {
      isStatic: true,
      restitution: 0.62,
      label: 'wall',
    });

    World.add(world, [
      lampBody,
      lampConstraint,
      projectile,
      ground,
      ceiling,
      wallLeft,
      wallRight,
      ...distractions.map((d) => d.body),
    ]);

    // Deep Parallax Starfield
    const stars: StarNode[] = Array.from({ length: 85 }, () => ({
      xRatio: Math.random(),
      yRatio: Math.random(),
      size: 0.6 + Math.random() * 1.9,
      baseAlpha: 0.14 + Math.random() * 0.58,
      twinkleSpeed: 0.7 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
    }));

    const particles: Particle[] = [];
    const shockwaves: ShockwaveRing[] = [];
    const floatingTexts: FloatingText[] = [];
    const trailPoints: TrailPoint[] = [];

    // Explicit Slingshot State Machine ('IDLE' | 'AIMING' | 'FIRED')
    let slingPhase: SlingshotPhase = 'IDLE';
    let aimPos = { x: slingAnchor.x, y: slingAnchor.y };
    let hitThisShot = false;
    let wasLockedOnDream = false;
    let activePointerId: number | null = null;
    let respawnTimeout: ReturnType<typeof setTimeout> | null = null;

    // Visual FX Spawners
    const spawnParticles = (
      x: number,
      y: number,
      count: number,
      colors: readonly string[],
      speedRange: number,
      starProbability = 0.45
    ) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (0.2 + Math.random() * 0.85) * speedRange;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.25,
          size: 2 + Math.random() * 4.6,
          alpha: 1,
          decay: 0.011 + Math.random() * 0.018,
          color: colors[i % colors.length],
          isStar: Math.random() < starProbability,
          rotation: Math.random() * Math.PI,
          vRot: (Math.random() - 0.5) * 0.2,
        });
      }
    };

    const spawnShockwave = (
      x: number,
      y: number,
      maxRadius: number,
      color: string,
      lineWidth = 4,
      speed = 9
    ) => {
      shockwaves.push({
        x,
        y,
        radius: 12,
        maxRadius,
        alpha: 1,
        color,
        lineWidth,
        speed,
      });
    };

    const triggerHitImpact = (trauma: number, maxOffset: number) => {
      const s = simRef.current;
      s.shakeTrauma = Math.min(1.0, Math.max(s.shakeTrauma, trauma));
      s.shakeMaxOffset = Math.max(s.shakeMaxOffset, maxOffset);
    };

    const spawnFloatingText = (x: number, y: number, text: string, color: string, subtext?: string) => {
      floatingTexts.push({
        x,
        y,
        vy: -1.75,
        text,
        subtext,
        alpha: 1,
        scale: 0.6,
        color,
      });
    };

    // Reset Projectile to Slingshot Pouch cleanly
    const resolveAndRespawn = (countMissIfUnhit: boolean) => {
      if (respawnTimeout) {
        clearTimeout(respawnTimeout);
        respawnTimeout = null;
      }
      const s = simRef.current;

      if (countMissIfUnhit && slingPhase === 'FIRED' && !hitThisShot) {
        s.consecutiveHits = 0;
        s.consecutiveMisses += 1;
        if (s.consecutiveMisses >= 3 && s.isOn) {
          s.isOn = false;
          s.rebootProgress = 0;
          s.glitchAmount = 1.0;
          triggerHitImpact(0.9, 24);
          spawnShockwave(lampBody.position.x, lampBody.position.y, 280, '#ff3366', 5, 11);
          audio.playBurnoutPowerDown(s.soundOn);
        }
      }

      slingPhase = 'IDLE';
      aimPos = { x: slingAnchor.x, y: slingAnchor.y };
      Body.setPosition(projectile, slingAnchor);
      Body.setVelocity(projectile, { x: 0, y: 0 });
      Body.setAngularVelocity(projectile, 0);

      hitThisShot = false;
      wasLockedOnDream = false;
      s.canQuickReload = false;
      trailPoints.length = 0;
      syncReactTelemetry();
    };

    // External Triggers
    simRef.current.togglePowerTrigger = (nextOn: boolean) => {
      if (nextOn) {
        triggerHitImpact(0.45, 12);
        spawnShockwave(lampBody.position.x, lampBody.position.y, 320, '#00ff87', 4, 10);
        spawnFloatingText(
          lampBody.position.x,
          lampBody.position.y + 58,
          'FOCUS REIGNITED',
          '#00ff87',
          'Gravity Restored to 1.0G'
        );
      } else {
        if (slingPhase === 'AIMING') {
          slingPhase = 'IDLE';
          aimPos = { x: slingAnchor.x, y: slingAnchor.y };
          audio.stopPullTension();
          Body.setPosition(projectile, slingAnchor);
          Body.setVelocity(projectile, { x: 0, y: 0 });
        }
      }
    };

    simRef.current.quickReloadTrigger = () => {
      if (slingPhase === 'FIRED' && simRef.current.isOn) {
        audio.playLockTick(simRef.current.soundOn);
        spawnParticles(projectile.position.x, projectile.position.y, 12, ['#00ff87', '#38bdf8'], 5, 0.3);
        resolveAndRespawn(true);
      }
    };

    simRef.current.resetTrigger = () => {
      resolveAndRespawn(false);
      Body.setPosition(lampBody, { x: lampStart.x, y: lampStart.y });
      Body.setVelocity(lampBody, { x: 0, y: 0 });
      spawnShockwave(lampStart.x, lampStart.y, 240, '#00ff87', 3, 9);
      triggerHitImpact(0.3, 8);
    };

    // ========================================================================
    // DETERMINISTIC POINTER SLINGSHOT CONTROLLER (100% RELIABLE BALL MOVEMENT)
    // ========================================================================
    const getCanvasCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const updateAimPosition = (ptX: number, ptY: number) => {
      const pullVec = Vector.sub({ x: ptX, y: ptY }, slingAnchor);
      const pullDist = Vector.magnitude(pullVec);
      const clampedDist = Math.min(MAX_PULL_DISTANCE, pullDist);
      const dir = pullDist > 0.001 ? Vector.mult(pullVec, 1 / pullDist) : { x: 0, y: 0 };
      let newPos = Vector.add(slingAnchor, Vector.mult(dir, clampedDist));

      // Subtle magnetic trajectory assist when Aim Assist is toggled on
      if (simRef.current.aimAssist && clampedDist > 45) {
        const rawLaunchVel = Vector.mult(Vector.sub(slingAnchor, newPos), LAUNCH_VELOCITY_SCALE);
        const toLamp = Vector.sub(lampBody.position, slingAnchor);
        const angleLaunch = Math.atan2(rawLaunchVel.y, rawLaunchVel.x);
        const angleLamp = Math.atan2(toLamp.y - 35, toLamp.x);
        const diff = angleLaunch - angleLamp;
        if (Math.abs(diff) < 0.09) {
          const nudgedAngle = angleLaunch - diff * 0.28;
          const speed = Vector.magnitude(rawLaunchVel);
          const assistedPull = {
            x: -Math.cos(nudgedAngle) * (speed / LAUNCH_VELOCITY_SCALE),
            y: -Math.sin(nudgedAngle) * (speed / LAUNCH_VELOCITY_SCALE),
          };
          newPos = Vector.add(slingAnchor, assistedPull);
        }
      }

      aimPos = newPos;
      Body.setPosition(projectile, aimPos);
      Body.setVelocity(projectile, { x: 0, y: 0 });
      audio.updatePullTension(clampedDist / MAX_PULL_DISTANCE, simRef.current.soundOn);
    };

    const handlePointerDown = (e: PointerEvent) => {
      const s = simRef.current;
      const pt = getCanvasCoords(e.clientX, e.clientY);

      // If projectile is already in flight, clicking near the slingshot or ball immediately reloads & grabs!
      if (slingPhase === 'FIRED') {
        const distToSling = Vector.magnitude(Vector.sub(pt, slingAnchor));
        const distToBall = Vector.magnitude(Vector.sub(pt, projectile.position));
        if ((distToSling < 110 || distToBall < 75) && s.isOn) {
          resolveAndRespawn(true);
          // Immediately transition into aiming so the player can rapid-fire smoothly
          slingPhase = 'AIMING';
          activePointerId = e.pointerId;
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {}
          audio.startPullTension(s.soundOn);
          updateAimPosition(pt.x, pt.y);
        }
        return;
      }

      if (!s.isOn) return;

      const distToBall = Vector.magnitude(Vector.sub(pt, projectile.position));
      const distToAnchor = Vector.magnitude(Vector.sub(pt, slingAnchor));
      const inBottomLeftLaunchZone = pt.x < width * 0.42 && pt.y > height * 0.55;

      // Generous grab radius so aiming never feels finicky on mouse or touch
      if (distToBall <= 105 || distToAnchor <= 105 || inBottomLeftLaunchZone) {
        slingPhase = 'AIMING';
        activePointerId = e.pointerId;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {}
        audio.startPullTension(s.soundOn);
        updateAimPosition(pt.x, pt.y);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (slingPhase !== 'AIMING') return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;

      if (!simRef.current.isOn) {
        slingPhase = 'IDLE';
        aimPos = { x: slingAnchor.x, y: slingAnchor.y };
        audio.stopPullTension();
        Body.setPosition(projectile, slingAnchor);
        Body.setVelocity(projectile, { x: 0, y: 0 });
        return;
      }
      const pt = getCanvasCoords(e.clientX, e.clientY);
      updateAimPosition(pt.x, pt.y);
    };

    const handlePointerUpOrCancel = (e: PointerEvent) => {
      if (slingPhase !== 'AIMING') return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;

      activePointerId = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}

      const s = simRef.current;
      if (!s.isOn) {
        slingPhase = 'IDLE';
        aimPos = { x: slingAnchor.x, y: slingAnchor.y };
        audio.stopPullTension();
        Body.setPosition(projectile, slingAnchor);
        Body.setVelocity(projectile, { x: 0, y: 0 });
        return;
      }

      const pullVec = Vector.sub(slingAnchor, aimPos);
      const pullDist = Vector.magnitude(pullVec);

      if (pullDist > 18) {
        slingPhase = 'FIRED';
        hitThisShot = false;
        s.shots += 1;
        s.canQuickReload = true;

        const normTension = Math.min(1, pullDist / MAX_PULL_DISTANCE);
        s.bandSnapAmp = Math.min(30, pullDist * 0.24);
        s.bandSnapPhase = 0;

        // Deterministic launch from slingAnchor with exact Verlet velocity
        const launchVel = Vector.mult(pullVec, LAUNCH_VELOCITY_SCALE);
        Body.setPosition(projectile, { x: slingAnchor.x, y: slingAnchor.y });
        Body.setVelocity(projectile, launchVel);
        Body.setAngularVelocity(projectile, 0);

        triggerHitImpact(0.24, 6);
        spawnShockwave(
          slingAnchor.x,
          slingAnchor.y,
          65 + normTension * 45,
          s.consecutiveHits >= 3 ? '#ffd700' : '#00ff87',
          2.5,
          8
        );
        audio.playReleaseSnap(normTension, s.soundOn);
        syncReactTelemetry();

        respawnTimeout = setTimeout(() => {
          resolveAndRespawn(true);
        }, 2800);
      } else {
        // Snap gently back into pouch if pulled too little
        slingPhase = 'IDLE';
        aimPos = { x: slingAnchor.x, y: slingAnchor.y };
        Body.setPosition(projectile, slingAnchor);
        Body.setVelocity(projectile, { x: 0, y: 0 });
        audio.stopPullTension();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'r' || e.key === 'R') {
        if (slingPhase === 'FIRED' && simRef.current.isOn) {
          e.preventDefault();
          simRef.current.quickReloadTrigger?.();
        }
      } else if (e.key === 'h' || e.key === 'H') {
        handleToggleCinema();
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUpOrCancel);
    window.addEventListener('pointercancel', handlePointerUpOrCancel);
    window.addEventListener('keydown', handleKeyDown);

    // ========================================================================
    // MATTER.JS COLLISION HANDLER
    // ========================================================================
    const handleCollisionStart = (event: Matter.IEventCollision<Matter.Engine>) => {
      if (slingPhase !== 'FIRED') return;
      const s = simRef.current;

      for (let i = 0; i < event.pairs.length; i++) {
        const { bodyA, bodyB } = event.pairs[i];
        const labels = [bodyA.label, bodyB.label];

        // 1. Target Hit ("THE DREAM")
        if (labels.includes('lamp') && labels.includes('projectile')) {
          if (!hitThisShot && s.isOn) {
            hitThisShot = true;
            s.hits += 1;
            const nextStreak = s.consecutiveHits + 1;
            s.consecutiveHits = nextStreak;
            s.bestStreak = Math.max(s.bestStreak, nextStreak);
            s.consecutiveMisses = 0;
            const pointsEarned = 100 * nextStreak;
            s.score += pointsEarned;
            s.cordPulseProgress = 1.0;

            // Hit-Stop Time Dilation
            s.timeScale = 0.1;
            s.hitStopTimer = 0.15;

            const lx = lampBody.position.x;
            const ly = lampBody.position.y;
            const enteringZen = nextStreak >= 3;

            triggerHitImpact(enteringZen ? 1.0 : 0.85, enteringZen ? 28 : 20);

            spawnShockwave(
              lx,
              ly,
              enteringZen ? 420 : 260,
              enteringZen ? '#ffd700' : '#00ff87',
              enteringZen ? 6 : 4,
              enteringZen ? 12 : 9
            );
            if (enteringZen) {
              spawnShockwave(lx, ly, 620, '#ffffff', 3, 16);
            }

            spawnParticles(
              lx,
              ly,
              enteringZen ? 68 : 44,
              enteringZen ? ['#ffd700', '#fef08a', '#ffffff', '#00ff87'] : ['#00ff87', '#38bdf8', '#ffffff'],
              enteringZen ? 15.5 : 11.5,
              0.58
            );

            if (nextStreak === 3) {
              audio.playZenAscensionPad(s.soundOn);
              spawnFloatingText(lx, ly - 52, 'FLOW STATE ACHIEVED!', '#ffd700', `+${pointsEarned} • DISTRACTIONS DISSOLVED`);
            } else if (nextStreak > 3) {
              audio.playDreamHitChime(nextStreak, s.soundOn);
              spawnFloatingText(lx, ly - 48, `TRANSCENDENCE x${nextStreak}`, '#ffd700', `+${pointsEarned} FLOW`);
            } else {
              audio.playDreamHitChime(nextStreak, s.soundOn);
              spawnFloatingText(
                lx,
                ly - 44,
                nextStreak === 2 ? `HYPERFOCUS x2` : `+${pointsEarned} CLARITY`,
                '#00ff87',
                `${3 - nextStreak} more for Flow State`
              );
            }

            if (respawnTimeout) clearTimeout(respawnTimeout);
            respawnTimeout = setTimeout(() => {
              resolveAndRespawn(false);
            }, 1350);

            syncReactTelemetry();
          }
        }
        // 2. Distraction Barrier Hit ("PROCRASTINATION", "FEAR", etc.)
        else if (labels.includes('distraction') && labels.includes('projectile')) {
          const distBody = bodyA.label === 'distraction' ? bodyA : bodyB;
          const distEntity = distractions.find((d) => d.body === distBody);
          if (distEntity && !distBody.isSensor) {
            distEntity.hitFlash = 1.0;
            distEntity.shudderX = (Math.random() - 0.5) * 18;
            distEntity.shudderY = (Math.random() - 0.5) * 14;

            triggerHitImpact(0.68, 15);

            const cx = projectile.position.x;
            const cy = projectile.position.y;
            spawnShockwave(cx, cy, 135, '#ff3366', 3.5, 8);
            spawnParticles(cx, cy, 24, ['#ff3366', '#fb7185', '#fda4af'], 8.5, 0.25);
            spawnFloatingText(cx, cy - 24, `${distEntity.text} BLOCKED`, '#ff3366', distEntity.code);
            audio.playDistractionHit(s.soundOn);
          }
        }
        // 3. Boundary Wall Bounce
        else if (labels.includes('wall') && labels.includes('projectile')) {
          audio.playWallBounce(s.soundOn);
        }
      }
    };

    Events.on(engine, 'collisionStart', handleCollisionStart);

    // Handle Viewport Resize
    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth || window.innerWidth;
      height = container.clientHeight || window.innerHeight;
      resizeCanvas(width, height);

      lampAnchor = getLampAnchor(width);
      lampStart = getLampStart(width, height);
      slingAnchor = getSlingAnchor(width, height);

      lampConstraint.pointA = lampAnchor;
      lampConstraint.length = lampStart.y - lampAnchor.y;
      if (Math.abs(lampBody.velocity.x) < 0.1 && Math.abs(lampBody.velocity.y) < 0.1) {
        Body.setPosition(lampBody, { x: lampStart.x, y: lampStart.y });
      }

      if (slingPhase === 'IDLE') {
        aimPos = { x: slingAnchor.x, y: slingAnchor.y };
        Body.setPosition(projectile, slingAnchor);
        Body.setVelocity(projectile, { x: 0, y: 0 });
      }

      distractions.forEach((d, idx) => {
        d.baseY = buildDistractionY(idx, distractions.length, height);
      });

      Body.setPosition(ground, { x: width / 2, y: height + wallThickness / 2 });
      Body.setPosition(ceiling, { x: width / 2, y: -wallThickness * 2.5 });
      Body.setPosition(wallLeft, { x: -wallThickness / 2, y: height / 2 });
      Body.setPosition(wallRight, { x: width + wallThickness / 2, y: height / 2 });
    };

    window.addEventListener('resize', handleResize);

    // Canvas Drawing Helpers
    const drawRoundedRect = (x: number, y: number, w: number, h: number, r: number) => {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    };

    const drawFourPointStar = (cx: number, cy: number, size: number, rot: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2;
        ctx.lineTo(Math.cos(ang) * size, Math.sin(ang) * size);
        const midAng = ang + Math.PI / 4;
        ctx.lineTo(Math.cos(midAng) * (size * 0.32), Math.sin(midAng) * (size * 0.32));
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    // ========================================================================
    // FRAMERATE-INDEPENDENT FIXED-TIMESTEP PHYSICS & AAA RENDER LOOP
    // ========================================================================
    let animFrameId = 0;
    let lastTime = performance.now();
    let physicsAccumulator = 0;
    let simClockMs = 0;

    const renderLoop = (now: number) => {
      const rawDt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const s = simRef.current;

      // 1. Update Hit-Stop Time Dilation & Reboot Sequence
      if (s.hitStopTimer > 0) {
        s.hitStopTimer -= rawDt;
        if (s.hitStopTimer <= 0) {
          s.timeScale = 1.0;
        }
      } else {
        s.timeScale += (1.0 - s.timeScale) * 0.25;
      }

      if (s.isOn && s.rebootProgress < 1) {
        s.rebootProgress = Math.min(1, s.rebootProgress + rawDt * 1.45);
        if (s.rebootProgress >= 1) {
          syncReactTelemetry();
        }
      }

      // 2. Dynamic Gravity & Fixed-Timestep Physics Sub-Stepping
      const misses = Math.max(0, s.shots - s.hits);
      const currentGravity = s.isOn ? 1 + Math.min(misses * 0.3, 2.5) : 2.8;
      engine.world.gravity.y = currentGravity;

      const isZen = s.consecutiveHits >= 3 && s.isOn;

      physicsAccumulator += rawDt * s.timeScale;
      const maxSubSteps = 5;
      let steps = 0;

      while (physicsAccumulator >= FIXED_TIMESTEP_SEC && steps < maxSubSteps) {
        simClockMs += FIXED_TIMESTEP_MS;

        // Disable collisions on projectile while seated/aiming so it never fights obstacles
        projectile.isSensor = slingPhase !== 'FIRED';

        distractions.forEach((d, idx) => {
          d.body.isSensor = isZen || !s.isOn;
          if (!isZen && s.isOn) {
            const swingX = width * 0.5 + Math.sin(simClockMs * d.speed + d.phaseOffset) * (width * d.rangeRatio);
            const bobY = d.baseY + Math.cos(simClockMs * 0.0022 + idx * 1.3) * 6;
            Body.setPosition(d.body, { x: swingX, y: bobY });
          }
        });

        // Pin projectile to pouch or aimPos before stepping if not fired
        if (slingPhase === 'IDLE') {
          Body.setPosition(projectile, slingAnchor);
          Body.setVelocity(projectile, { x: 0, y: 0 });
        } else if (slingPhase === 'AIMING') {
          Body.setPosition(projectile, aimPos);
          Body.setVelocity(projectile, { x: 0, y: 0 });
        }

        Engine.update(engine, FIXED_TIMESTEP_MS);

        // Re-assert pin after step so gravity never causes downward drift during aiming
        if (slingPhase === 'IDLE') {
          Body.setPosition(projectile, slingAnchor);
          Body.setVelocity(projectile, { x: 0, y: 0 });
        } else if (slingPhase === 'AIMING') {
          Body.setPosition(projectile, aimPos);
          Body.setVelocity(projectile, { x: 0, y: 0 });
        }

        physicsAccumulator -= FIXED_TIMESTEP_SEC;
        steps++;
      }

      // Fast-settle detection: if projectile slows to a crawl on the floor or leaves bounds, auto-recover
      if (slingPhase === 'FIRED') {
        const speed = Vector.magnitude(projectile.velocity);
        const py = projectile.position.y;
        const px = projectile.position.x;
        if (py > height - 35 && speed < 1.15) {
          resolveAndRespawn(true);
        } else if (px < -60 || px > width + 60 || py > height + 60) {
          resolveAndRespawn(true);
        }
      }

      // Visual Shudder & Cord Pulse Decay
      distractions.forEach((d) => {
        if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - rawDt * 3.2);
        d.shudderX *= Math.pow(0.82, rawDt * 60);
        d.shudderY *= Math.pow(0.82, rawDt * 60);
      });

      if (s.cordPulseProgress > 0) {
        s.cordPulseProgress = Math.max(0, s.cordPulseProgress - rawDt * 2.2);
      }

      // Record Comet Trail Points
      if (slingPhase === 'FIRED' || slingPhase === 'AIMING') {
        trailPoints.unshift({
          x: projectile.position.x,
          y: projectile.position.y,
          vx: projectile.velocity.x,
          vy: projectile.velocity.y,
          alpha: 0.92,
          radius: projRadius * 0.92,
        });
        if (trailPoints.length > 24) trailPoints.pop();
      }
      for (let i = trailPoints.length - 1; i >= 0; i--) {
        trailPoints[i].alpha -= rawDt * 2.6;
        trailPoints[i].radius *= Math.pow(0.96, rawDt * 60);
        if (trailPoints[i].alpha <= 0.02) trailPoints.splice(i, 1);
      }

      // Decay Trauma-based Micro-Shake, Glitch, and Slingshot Band Snap-Back
      if (s.shakeTrauma > 0.001) {
        const shakePower = s.shakeTrauma * s.shakeTrauma;
        const freq = now * 0.052;
        s.shakeX = (Math.sin(freq * 1.7) * 0.75 + (Math.random() - 0.5) * 0.5) * s.shakeMaxOffset * shakePower;
        s.shakeY = (Math.cos(freq * 2.1) * 0.75 + (Math.random() - 0.5) * 0.5) * s.shakeMaxOffset * shakePower;
        s.shakeAngle = (Math.sin(freq * 0.95) * 0.7 + (Math.random() - 0.5) * 0.3) * 0.024 * shakePower;
        s.shakeTrauma = Math.max(0, s.shakeTrauma - rawDt * 2.6);
      } else {
        s.shakeTrauma = 0;
        s.shakeX = 0;
        s.shakeY = 0;
        s.shakeAngle = 0;
      }

      s.glitchAmount *= Math.pow(0.9, rawDt * 60);
      if (s.bandSnapAmp > 0.2) {
        s.bandSnapPhase += rawDt * 44;
        s.bandSnapAmp *= Math.pow(0.9, rawDt * 60);
      } else {
        s.bandSnapAmp = 0;
      }

      // ======================================================================
      // AAA CANVAS 2D HARDWARE-ACCELERATED LAYERED RENDERING
      // ======================================================================
      ctx.save();

      // 1. Deep Obsidian Space Backdrop + Architectural Perspective Grid
      const overdraw = 64;
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      if (isZen) {
        bgGrad.addColorStop(0, '#061516');
        bgGrad.addColorStop(0.55, '#081b22');
        bgGrad.addColorStop(1, '#03080d');
      } else if (s.isOn) {
        bgGrad.addColorStop(0, '#040710');
        bgGrad.addColorStop(0.6, '#070f1c');
        bgGrad.addColorStop(1, '#03050a');
      } else {
        bgGrad.addColorStop(0, '#030205');
        bgGrad.addColorStop(0.6, '#090307');
        bgGrad.addColorStop(1, '#020103');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-overdraw, -overdraw, width + overdraw * 2, height + overdraw * 2);

      // Apply Directional & Rotational Camera Micro-Shake
      if (s.shakeTrauma > 0.001 || Math.abs(s.shakeX) > 0.1 || Math.abs(s.shakeY) > 0.1) {
        ctx.translate(width * 0.5 + s.shakeX, height * 0.5 + s.shakeY);
        ctx.rotate(s.shakeAngle);
        ctx.translate(-width * 0.5, -height * 0.5);
      }

      // Subtle Studio Telemetry Grid
      ctx.save();
      ctx.strokeStyle = isZen
        ? 'rgba(255, 215, 0, 0.028)'
        : s.isOn
        ? 'rgba(56, 189, 248, 0.025)'
        : 'rgba(255, 51, 102, 0.022)';
      ctx.lineWidth = 1;
      const gridStep = 64;
      ctx.beginPath();
      for (let gx = 0; gx < width; gx += gridStep) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
      }
      for (let gy = 0; gy < height; gy += gridStep) {
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
      }
      ctx.stroke();
      ctx.restore();

      // 2. Parallax Twinkling Starfield
      stars.forEach((st) => {
        const twinkle = st.baseAlpha + Math.sin(now * 0.001 * st.twinkleSpeed + st.phase) * 0.22;
        const alpha = Math.max(0.05, Math.min(0.9, twinkle * (s.isOn ? 1 : 0.32)));
        ctx.fillStyle = isZen ? `rgba(255, 228, 132, ${alpha})` : `rgba(186, 230, 253, ${alpha})`;
        ctx.beginPath();
        ctx.arc(st.xRatio * width, st.yRatio * height, st.size, 0, Math.PI * 2);
        ctx.fill();
      });

      const lx = lampBody.position.x;
      const ly = lampBody.position.y;

      const rebootFlicker =
        s.rebootProgress < 1
          ? Math.random() < s.rebootProgress
            ? 0.4 + s.rebootProgress * 0.6
            : 0.12
          : 1.0;

      // 3. Dynamic Volumetric Lamp Lighting & Downward Light Cone
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (s.isOn) {
        // Downward Volumetric Spotlight Cone
        const coneGrad = ctx.createLinearGradient(lx, ly, lx, height);
        if (isZen) {
          coneGrad.addColorStop(0, `rgba(255, 215, 0, ${0.14 * rebootFlicker})`);
          coneGrad.addColorStop(0.6, `rgba(245, 158, 11, ${0.04 * rebootFlicker})`);
          coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
          coneGrad.addColorStop(0, `rgba(0, 255, 135, ${0.11 * rebootFlicker})`);
          coneGrad.addColorStop(0.6, `rgba(56, 189, 248, ${0.03 * rebootFlicker})`);
          coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }
        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(lx - lampRadius * 0.8, ly);
        ctx.lineTo(lx + lampRadius * 0.8, ly);
        ctx.lineTo(lx + width * 0.42, height);
        ctx.lineTo(lx - width * 0.42, height);
        ctx.closePath();
        ctx.fill();

        // Radial Aura around THE DREAM
        const lightRadius = (isZen ? 580 : 450) * rebootFlicker;
        const volGrad = ctx.createRadialGradient(lx, ly, 8, lx, ly, lightRadius);
        if (isZen) {
          volGrad.addColorStop(0, `rgba(255, 215, 0, ${0.36 * rebootFlicker})`);
          volGrad.addColorStop(0.35, `rgba(245, 158, 11, ${0.15 * rebootFlicker})`);
          volGrad.addColorStop(0.7, `rgba(16, 185, 129, ${0.05 * rebootFlicker})`);
          volGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
          volGrad.addColorStop(0, `rgba(0, 255, 135, ${0.28 * rebootFlicker})`);
          volGrad.addColorStop(0.4, `rgba(56, 189, 248, ${0.12 * rebootFlicker})`);
          volGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }
        ctx.fillStyle = volGrad;
        ctx.beginPath();
        ctx.arc(lx, ly, lightRadius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Burnout Dying Ember Glow
        const emberFlicker = 0.6 + Math.sin(now * 0.018) * 0.25;
        const burnGrad = ctx.createRadialGradient(lx, ly, 4, lx, ly, 165);
        burnGrad.addColorStop(0, `rgba(255, 51, 102, ${0.2 * emberFlicker})`);
        burnGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = burnGrad;
        ctx.beginPath();
        ctx.arc(lx, ly, 165, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 4. EXACT VERBATIM BALLISTIC TRAJECTORY PREDICTOR & LOCK-ON RETICLE
      if (slingPhase === 'AIMING' && s.isOn) {
        const pullVec = Vector.sub(slingAnchor, aimPos);
        const pullDist = Vector.magnitude(pullVec);
        if (pullDist > 18) {
          let simVx = pullVec.x * LAUNCH_VELOCITY_SCALE;
          let simVy = pullVec.y * LAUNCH_VELOCITY_SCALE;
          let simX = slingAnchor.x;
          let simY = slingAnchor.y;
          const dragFactor = 1 - PROJECTILE_AIR_FRICTION;
          const gravStep = currentGravity * MATTER_GRAVITY_SCALE * FIXED_TIMESTEP_MS * FIXED_TIMESTEP_MS;

          let hitTargetType: 'dream' | 'obstacle' | null = null;
          let hitPoint = { x: 0, y: 0 };

          ctx.save();
          for (let step = 1; step <= 68; step++) {
            simVy += gravStep;
            simVx *= dragFactor;
            simVy *= dragFactor;
            simX += simVx;
            simY += simVy;

            // Check intersection with THE DREAM orb
            const distToLamp = Math.hypot(simX - lx, simY - ly);
            if (distToLamp <= lampRadius + projRadius - 2) {
              hitTargetType = 'dream';
              hitPoint = { x: simX, y: simY };
              break;
            }

            // Check intersection with active Distraction Capsules
            if (!isZen) {
              let hitObs = false;
              for (let j = 0; j < distractions.length; j++) {
                const d = distractions[j];
                const dx = Math.abs(simX - d.body.position.x);
                const dy = Math.abs(simY - d.body.position.y);
                if (dx <= d.width * 0.5 + projRadius * 0.7 && dy <= d.height * 0.5 + projRadius * 0.7) {
                  hitTargetType = 'obstacle';
                  hitPoint = { x: simX, y: simY };
                  hitObs = true;
                  break;
                }
              }
              if (hitObs) break;
            }

            // Draw every 2nd physics step for a crisp tactical arc
            if (step % 2 === 0) {
              const ratio = 1 - step / 70;
              const dotRadius = 1.6 + ratio * 2.8;
              ctx.fillStyle = isZen
                ? `rgba(255, 215, 0, ${ratio * 0.85})`
                : `rgba(0, 255, 135, ${ratio * 0.8})`;
              ctx.beginPath();
              ctx.arc(simX, simY, dotRadius, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Audio & Visual Lock-On Reticle Feedback
          if (hitTargetType === 'dream') {
            if (!wasLockedOnDream) {
              wasLockedOnDream = true;
              audio.playLockTick(s.soundOn);
            }
            const lockColor = isZen ? '#ffd700' : '#00ff87';
            ctx.strokeStyle = lockColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(hitPoint.x, hitPoint.y, 14 + Math.sin(now * 0.015) * 3, 0, Math.PI * 2);
            ctx.stroke();

            // Target Lock Crosshair around THE DREAM
            ctx.save();
            ctx.translate(lx, ly);
            ctx.rotate(now * 0.0015);
            ctx.strokeStyle = lockColor;
            ctx.lineWidth = 1.8;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.arc(0, 0, lampRadius + 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            ctx.font = '800 10px "JetBrains Mono", monospace';
            ctx.fillStyle = lockColor;
            ctx.textAlign = 'center';
            ctx.fillText('◎ TARGET LOCKED', lx, ly - lampRadius - 24);
          } else {
            wasLockedOnDream = false;
            if (hitTargetType === 'obstacle') {
              ctx.strokeStyle = '#ff3366';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(hitPoint.x - 7, hitPoint.y - 7);
              ctx.lineTo(hitPoint.x + 7, hitPoint.y + 7);
              ctx.moveTo(hitPoint.x + 7, hitPoint.y - 7);
              ctx.lineTo(hitPoint.x - 7, hitPoint.y + 7);
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }

      // 5. Slingshot Fork Posts, Radial Tension Gauge & Elastic Bands
      const leftFork = { x: slingAnchor.x - 22, y: slingAnchor.y };
      const rightFork = { x: slingAnchor.x + 22, y: slingAnchor.y };
      const basePostY = height - 30;

      ctx.save();
      if (slingPhase === 'AIMING' && s.isOn) {
        const pullVec = Vector.sub(slingAnchor, aimPos);
        const pullDist = Vector.magnitude(pullVec);
        const powerPct = Math.min(100, Math.round((pullDist / MAX_PULL_DISTANCE) * 100));
        const launchDeg = Math.round((-Math.atan2(pullVec.y, pullVec.x) * 180) / Math.PI);
        const gaugeColor = isZen ? '#ffd700' : '#00ff87';

        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(slingAnchor.x, slingAnchor.y, pullDist, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Power Progress Arc
        ctx.strokeStyle = gaugeColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          slingAnchor.x,
          slingAnchor.y,
          44,
          -Math.PI * 0.5,
          -Math.PI * 0.5 + (powerPct / 100) * Math.PI * 2
        );
        ctx.stroke();

        // Telemetry Readout beside Projectile
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillStyle = gaugeColor;
        ctx.textAlign = 'left';
        ctx.fillText(`${powerPct}% THRUST`, aimPos.x + 22, aimPos.y - 4);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
        ctx.fillText(`ANG ${launchDeg}°`, aimPos.x + 22, aimPos.y + 10);
        ctx.restore();
      } else if (slingPhase === 'IDLE' && s.isOn) {
        // Pulsing Interactive Cue around Slingshot Orb when idle
        const idlePulse = 0.3 + Math.sin(now * 0.005) * 0.18;
        const cueColor = isZen ? '#ffd700' : '#00ff87';
        ctx.strokeStyle = isZen
          ? `rgba(255, 215, 0, ${idlePulse})`
          : `rgba(0, 255, 135, ${idlePulse})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(slingAnchor.x, slingAnchor.y, projRadius + 10 + Math.sin(now * 0.005) * 3.5, 0, Math.PI * 2);
        ctx.stroke();

        if (s.shots === 0) {
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillStyle = cueColor;
          ctx.textAlign = 'center';
          ctx.fillText('↙ DRAG BACK TO LAUNCH', slingAnchor.x, slingAnchor.y - 38);
        }
      }

      // Metallic Slingshot Y-Frame Posts
      ctx.lineCap = 'round';
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(leftFork.x, basePostY);
      ctx.lineTo(leftFork.x, leftFork.y);
      ctx.moveTo(rightFork.x, basePostY);
      ctx.lineTo(rightFork.x, rightFork.y);
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.beginPath();
      ctx.moveTo(leftFork.x - 1.5, basePostY);
      ctx.lineTo(leftFork.x - 1.5, leftFork.y);
      ctx.moveTo(rightFork.x - 1.5, basePostY);
      ctx.lineTo(rightFork.x - 1.5, rightFork.y);
      ctx.stroke();

      // Glowing Anchor Nodes on Slingshot Tips
      const forkGlowColor = isZen ? '#ffd700' : s.isOn ? '#00ff87' : '#ff3366';
      [leftFork, rightFork].forEach((fk) => {
        ctx.fillStyle = forkGlowColor;
        ctx.shadowColor = forkGlowColor;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(fk.x, fk.y, 4.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;

      // Back Elastic Slingshot Band (Right fork to projectile)
      if (slingPhase !== 'FIRED') {
        const px = projectile.position.x;
        const py = projectile.position.y;
        const pullDist = Vector.magnitude(Vector.sub(slingAnchor, projectile.position));
        const bandThickness = Math.max(1.8, 4.4 - (pullDist / MAX_PULL_DISTANCE) * 2.2);
        const tensionRatio = Math.min(1, pullDist / MAX_PULL_DISTANCE);

        ctx.lineWidth = bandThickness;
        ctx.strokeStyle = isZen
          ? `rgba(255, 215, 0, ${0.55 + tensionRatio * 0.45})`
          : `rgba(0, 255, 135, ${0.45 + tensionRatio * 0.5})`;

        ctx.beginPath();
        ctx.moveTo(rightFork.x, rightFork.y);
        ctx.lineTo(px, py);
        ctx.stroke();
      } else if (s.bandSnapAmp > 0.4) {
        // Elastic snap-back harmonic oscillation after release
        const snapMidX = slingAnchor.x + Math.cos(s.bandSnapPhase) * s.bandSnapAmp;
        const snapMidY = slingAnchor.y - Math.sin(s.bandSnapPhase) * s.bandSnapAmp * 0.6;
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = isZen ? 'rgba(255, 215, 0, 0.5)' : 'rgba(0, 255, 135, 0.45)';
        ctx.beginPath();
        ctx.moveTo(leftFork.x, leftFork.y);
        ctx.quadraticCurveTo(snapMidX, snapMidY, rightFork.x, rightFork.y);
        ctx.stroke();
      }
      ctx.restore();

      // 6. Luminous Comet Ribbon Trail
      if (trailPoints.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < trailPoints.length - 1; i++) {
          const pt = trailPoints[i];
          const nextPt = trailPoints[i + 1];
          ctx.strokeStyle = isZen
            ? `rgba(255, 215, 0, ${pt.alpha * 0.7})`
            : `rgba(0, 255, 135, ${pt.alpha * 0.7})`;
          ctx.lineWidth = Math.max(1.5, pt.radius * 1.55);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(nextPt.x, nextPt.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 7. Projectile Orb (with Velocity Squash & Stretch) & Front Slingshot Band
      const px = projectile.position.x;
      const py = projectile.position.y;
      const vx = projectile.velocity.x;
      const vy = projectile.velocity.y;
      const speed = Math.hypot(vx, vy);

      ctx.save();
      ctx.translate(px, py);
      if (slingPhase === 'FIRED' && speed > 2.5) {
        const moveAngle = Math.atan2(vy, vx);
        const stretch = Math.min(1.32, 1 + speed * 0.012);
        const squash = 1 / Math.sqrt(stretch);
        ctx.rotate(moveAngle);
        ctx.scale(stretch, squash);
      }

      const projColor = isZen ? '#ffd700' : s.isOn ? '#00ff87' : '#475569';
      if (s.isOn) {
        ctx.shadowColor = projColor;
        ctx.shadowBlur = slingPhase === 'AIMING' ? 28 : 20;
      }
      ctx.fillStyle = projColor;
      ctx.beginPath();
      ctx.arc(0, 0, projRadius, 0, Math.PI * 2);
      ctx.fill();

      // Specular Inner Core
      ctx.fillStyle = s.isOn ? '#ffffff' : '#94a3b8';
      ctx.beginPath();
      ctx.arc(-3, -3, projRadius * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Front Elastic Slingshot Band (Left fork to projectile)
      if (slingPhase !== 'FIRED') {
        const pullDist = Vector.magnitude(Vector.sub(slingAnchor, projectile.position));
        const bandThickness = Math.max(1.9, 4.5 - (pullDist / MAX_PULL_DISTANCE) * 2.2);
        const tensionRatio = Math.min(1, pullDist / MAX_PULL_DISTANCE);
        ctx.save();
        ctx.lineWidth = bandThickness;
        ctx.lineCap = 'round';
        ctx.strokeStyle = isZen
          ? `rgba(255, 215, 0, ${0.68 + tensionRatio * 0.32})`
          : `rgba(0, 255, 135, ${0.58 + tensionRatio * 0.42})`;
        ctx.beginPath();
        ctx.moveTo(leftFork.x, leftFork.y);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();
      }

      // 8. Laser-Engraved Mental Friction Distraction Capsules
      distractions.forEach((d) => {
        const visibility = isZen ? 0.16 : s.isOn ? 1.0 : 0.25;
        const dx = d.body.position.x + d.shudderX;
        const dy = d.body.position.y + d.shudderY;
        const rx = dx - d.width / 2;
        const ry = dy - d.height / 2;

        ctx.save();
        ctx.globalAlpha = visibility;

        const capGrad = ctx.createLinearGradient(rx, ry, rx, ry + d.height);
        if (d.hitFlash > 0.05) {
          capGrad.addColorStop(0, `rgba(255, 51, 102, ${0.45 + d.hitFlash * 0.45})`);
          capGrad.addColorStop(1, `rgba(136, 19, 55, ${0.45 + d.hitFlash * 0.45})`);
        } else {
          capGrad.addColorStop(0, 'rgba(15, 23, 42, 0.88)');
          capGrad.addColorStop(1, 'rgba(9, 14, 26, 0.92)');
        }
        ctx.fillStyle = capGrad;
        drawRoundedRect(rx, ry, d.width, d.height, 15);
        ctx.fill();

        ctx.lineWidth = d.hitFlash > 0.05 ? 2.2 : 1.2;
        ctx.strokeStyle =
          d.hitFlash > 0.05
            ? '#ffffff'
            : isZen
            ? 'rgba(255, 215, 0, 0.4)'
            : 'rgba(255, 51, 102, 0.45)';
        drawRoundedRect(rx, ry, d.width, d.height, 15);
        ctx.stroke();

        if (s.isOn && !isZen) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx + 14, ry + 0.5);
          ctx.lineTo(rx + d.width - 14, ry + 0.5);
          ctx.stroke();
        }

        ctx.fillStyle = d.hitFlash > 0.1 ? '#ffffff' : isZen ? '#ffd700' : '#ff3366';
        ctx.beginPath();
        ctx.arc(rx + 14, dy, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.font = '800 11px "JetBrains Mono", "Inter", monospace';
        ctx.fillStyle = d.hitFlash > 0.1 ? '#ffffff' : isZen ? '#fde68a' : '#fda4af';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text, dx + 5, dy + 0.5);

        ctx.restore();
      });

      // 9. Swinging Pendulum Cord, Energy Pulse & "THE DREAM" Target Orb
      ctx.save();
      ctx.strokeStyle = s.isOn
        ? isZen
          ? 'rgba(255, 215, 0, 0.6)'
          : 'rgba(226, 232, 240, 0.32)'
        : 'rgba(148, 163, 184, 0.15)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(lampAnchor.x, lampAnchor.y);
      ctx.lineTo(lx, ly);
      ctx.stroke();

      if (s.cordPulseProgress > 0) {
        const pulseX = lx + (lampAnchor.x - lx) * (1 - s.cordPulseProgress);
        const pulseY = ly + (lampAnchor.y - ly) * (1 - s.cordPulseProgress);
        ctx.fillStyle = isZen ? '#ffd700' : '#00ff87';
        ctx.shadowColor = isZen ? '#ffd700' : '#00ff87';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(pulseX, pulseY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      const pulseScale = 1 + Math.sin(now * 0.0045) * 0.06;
      const effectiveR = lampRadius * pulseScale;

      if (s.isOn) {
        ctx.strokeStyle = isZen
          ? `rgba(255, 215, 0, ${0.46 * rebootFlicker})`
          : `rgba(0, 255, 135, ${0.4 * rebootFlicker})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lx, ly, effectiveR + 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.shadowColor = s.isOn ? (isZen ? '#ffd700' : '#00ff87') : '#ff3366';
      ctx.shadowBlur = s.isOn ? 42 * rebootFlicker : 12;
      const orbGrad = ctx.createRadialGradient(lx - 10, ly - 12, 4, lx, ly, lampRadius);
      if (s.isOn) {
        if (isZen) {
          orbGrad.addColorStop(0, '#ffffff');
          orbGrad.addColorStop(0.5, '#fef08a');
          orbGrad.addColorStop(0.85, '#eab308');
          orbGrad.addColorStop(1, '#ca8a04');
        } else {
          orbGrad.addColorStop(0, '#ffffff');
          orbGrad.addColorStop(0.55, '#d1fae5');
          orbGrad.addColorStop(0.88, '#10b981');
          orbGrad.addColorStop(1, '#059669');
        }
      } else {
        orbGrad.addColorStop(0, '#334155');
        orbGrad.addColorStop(0.7, '#1e293b');
        orbGrad.addColorStop(1, '#0f172a');
      }

      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, lampRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = s.isOn ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.ellipse(lx - 13, ly - 15, 11, 6, -Math.PI * 0.25, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = s.isOn ? '#04070d' : '#94a3b8';
      ctx.font = '900 11px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('THE', lx, ly - 6);
      ctx.fillText('DREAM', lx, ly + 6.5);
      ctx.restore();

      // 10. Expanding Geometric Shockwave Rings
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.radius += sw.speed * s.timeScale * (rawDt * 60);
        const progress = sw.radius / sw.maxRadius;
        sw.alpha = Math.max(0, 1 - progress);

        if (sw.alpha <= 0.02 || sw.radius >= sw.maxRadius) {
          shockwaves.splice(i, 1);
          continue;
        }

        ctx.globalAlpha = sw.alpha;
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = Math.max(0.8, sw.lineWidth * (1 - progress * 0.7));
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // 11. Exploding Star-Dust & Ember Particles
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const stepScale = s.timeScale * (rawDt * 60);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * stepScale;
        p.y += p.vy * stepScale;
        p.vy += 0.22 * stepScale;
        p.vx *= Math.pow(0.97, stepScale);
        p.vy *= Math.pow(0.97, stepScale);
        p.rotation += p.vRot * stepScale;
        p.alpha -= p.decay * (rawDt * 60);

        if (p.alpha <= 0.02) {
          particles.splice(i, 1);
          continue;
        }

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        if (p.isStar) {
          drawFourPointStar(p.x, p.y, p.size * 1.45, p.rotation);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // 12. Floating Celebratory Combo & Feedback Typography
      ctx.save();
      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.y += ft.vy * (rawDt * 60);
        ft.vy *= Math.pow(0.96, rawDt * 60);
        ft.scale += (1.0 - ft.scale) * 0.22;
        ft.alpha -= rawDt * 0.82;

        if (ft.alpha <= 0.02) {
          floatingTexts.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = ft.alpha;
        ctx.translate(ft.x, ft.y);
        ctx.scale(ft.scale, ft.scale);
        ctx.font = '800 14px "Inter", system-ui, sans-serif';
        ctx.fillStyle = ft.color;
        ctx.shadowColor = ft.color;
        ctx.shadowBlur = 14;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, 0, 0);
        if (ft.subtext) {
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#e2e8f0';
          ctx.shadowBlur = 0;
          ctx.fillText(ft.subtext, 0, 16);
        }
        ctx.restore();
      }
      ctx.restore();

      ctx.restore();

      // Micro-shudder on container DOM element during high-impact moments
      if (containerRef.current) {
        if (s.shakeTrauma > 0.12) {
          const hudShakeX = (s.shakeX * 0.32).toFixed(1);
          const hudShakeY = (s.shakeY * 0.32).toFixed(1);
          containerRef.current.style.transform = `translate3d(${hudShakeX}px, ${hudShakeY}px, 0)`;
        } else if (containerRef.current.style.transform !== '') {
          containerRef.current.style.transform = '';
        }
      }

      animFrameId = requestAnimationFrame(renderLoop);
    };

    animFrameId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animFrameId);
      if (respawnTimeout) clearTimeout(respawnTimeout);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUpOrCancel);
      window.removeEventListener('pointercancel', handlePointerUpOrCancel);
      Events.off(engine, 'collisionStart', handleCollisionStart);
      World.clear(world, false);
      Engine.clear(engine);
      audio.dispose();
    };
  }, [syncReactTelemetry, handleToggleCinema]);

  // Derived Narrative Copy & Telemetry Metrics
  const isZen = telemetry.consecutiveHits >= 3 && telemetry.isOn;
  const misses = Math.max(0, telemetry.shots - telemetry.hits);
  const gravityG = (telemetry.isOn ? 1 + Math.min(misses * 0.3, 2.5) : 2.8).toFixed(1);
  const accuracy = telemetry.shots > 0 ? Math.round((telemetry.hits / telemetry.shots) * 100) : 100;
  const streakProgress = Math.min(1, telemetry.consecutiveHits / 3);
  const ringCircumference = 2 * Math.PI * 18;

  let titleText = 'The journey is long.';
  let subtitleText = 'Pull back the slingshot at bottom-left and aim through the noise toward THE DREAM.';

  if (isZen) {
    titleText = 'Flow State Achieved.';
    subtitleText = 'Mental friction has dissolved into golden clarity. You are unstoppable.';
  } else if (!telemetry.isOn) {
    titleText = 'BURNOUT.';
    subtitleText = 'Repeated friction drained the light. Flip the FOCUS breaker on the right to reignite.';
  } else if (telemetry.rebooting) {
    titleText = 'Reigniting Focus...';
    subtitleText = 'Breathing through the setback. Gravity restored to 1.0G.';
  } else if (telemetry.hits > 0 && telemetry.consecutiveHits > 0) {
    titleText = `Momentum Building (${telemetry.consecutiveHits}/3).`;
    subtitleText = 'Every hit sharpens your focus. Chain 3 consecutive hits to unlock Zen Flow State.';
  } else if (telemetry.shots === 1 && telemetry.hits === 0) {
    titleText = 'Attempt 1: Reality hits hard.';
    subtitleText = 'You stumbled against the noise—but failure is just trajectory data. Aim again.';
  } else if (telemetry.shots >= 2 && telemetry.hits === 0) {
    titleText = `Pressure Builds (${gravityG}G).`;
    subtitleText = 'Each miss makes gravity heavier. Breathe, watch the predictive arc, and take your shot.';
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#03050a',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Scoped Broadcast-Grade Studio Styles */}
      <style>{`
        @keyframes burnoutGlitch {
          0% { transform: translate(0, 0); }
          20% { transform: translate(-3px, 1.5px); }
          40% { transform: translate(2.5px, -1.5px); }
          60% { transform: translate(-2px, -1px); }
          80% { transform: translate(2px, 1.5px); }
          100% { transform: translate(0, 0); }
        }
        .cyber-glass-pod {
          background: rgba(8, 13, 25, 0.76);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 16px;
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.08);
          transition: opacity 0.35s ease, transform 0.35s ease;
        }
        .cyber-btn {
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 9999px;
          padding: 8px 14px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #e2e8f0;
        }
        .cyber-btn:hover {
          transform: translateY(-1px);
          border-color: rgba(0, 255, 135, 0.65);
          box-shadow: 0 0 18px rgba(0, 255, 135, 0.24);
        }
        .cyber-btn:active {
          transform: translateY(0px);
        }
      `}</style>

      {/* High-DPI 2D Physics & Volumetric Lighting Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          touchAction: 'none',
          cursor: telemetry.isOn ? 'grab' : 'not-allowed',
          zIndex: 1,
        }}
      />

      {/* TOP-LEFT TELEMETRY HUD POD */}
      {!telemetry.cinemaMode && (
        <div
          className="cyber-glass-pod"
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            padding: '14px 18px',
            minWidth: 235,
            zIndex: 10,
            color: 'rgba(226, 232, 240, 0.88)',
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
              paddingBottom: 6,
              borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
            }}
          >
            <span
              style={{
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              Timeline Telemetry
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: 999,
                background: isZen
                  ? 'rgba(255, 215, 0, 0.18)'
                  : telemetry.isOn
                  ? 'rgba(0, 255, 135, 0.15)'
                  : 'rgba(255, 51, 102, 0.2)',
                color: isZen ? '#ffd700' : telemetry.isOn ? '#00ff87' : '#ff3366',
                border: `1px solid ${
                  isZen ? 'rgba(255,215,0,0.4)' : telemetry.isOn ? 'rgba(0,255,135,0.35)' : 'rgba(255,51,102,0.4)'
                }`,
              }}
            >
              {isZen ? 'ZEN FLOW' : telemetry.isOn ? 'IN PROGRESS' : 'BURNOUT'}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Gravity Load</span>
            <span
              style={{
                color: Number(gravityG) > 1.8 ? '#ff6b8b' : '#ffffff',
                fontWeight: 700,
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              {gravityG}G
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Attempts / Hits</span>
            <span style={{ color: '#ffffff', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>
              {telemetry.shots} / {telemetry.hits} ({accuracy}%)
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Flow Score</span>
            <span
              style={{
                color: isZen ? '#ffd700' : '#00ff87',
                fontWeight: 800,
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              {telemetry.score.toLocaleString()}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 4,
              paddingTop: 6,
              borderTop: '1px solid rgba(148,163,184,0.15)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              🏆 High Score
              {telemetry.isNewHighScore && telemetry.score > 0 && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#ffd700',
                    background: 'rgba(255,215,0,0.15)',
                    border: '1px solid rgba(255,215,0,0.4)',
                    borderRadius: 4,
                    padding: '1px 5px',
                    letterSpacing: '0.05em',
                    animation: 'burnoutGlitch 0.6s ease-in-out 1',
                  }}
                >
                  NEW!
                </span>
              )}
            </span>
            <span
              style={{
                color: '#ffd700',
                fontWeight: 800,
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              {telemetry.highScore.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* TOP-RIGHT STREAK RING, SHOWCASE CONTROLS & AUDIO */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 24,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          gap: 10,
        }}
      >
        {/* SVG Flow Streak Progress Ring */}
        {!telemetry.cinemaMode && (
          <div
            className="cyber-glass-pod"
            style={{
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderRadius: 9999,
            }}
          >
            <svg width="42" height="42" viewBox="0 0 44 44">
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke="rgba(148, 163, 184, 0.2)"
                strokeWidth="3.5"
              />
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke={isZen ? '#ffd700' : '#00ff87'}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringCircumference * (1 - streakProgress)}
                transform="rotate(-90 22 22)"
                style={{ transition: 'stroke-dashoffset 0.35s ease, stroke 0.35s ease' }}
              />
              <text
                x="22"
                y="25"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="11"
                fontWeight="800"
              >
                {telemetry.consecutiveHits}x
              </text>
            </svg>
            <div style={{ fontSize: 10, lineHeight: 1.25 }}>
              <div style={{ color: '#94a3b8', fontWeight: 700, letterSpacing: '0.06em' }}>STREAK</div>
              <div style={{ color: isZen ? '#ffd700' : '#ffffff', fontWeight: 800 }}>
                {isZen ? 'ZEN UNLOCKED' : `${Math.max(0, 3 - telemetry.consecutiveHits)} TO FLOW`}
              </div>
            </div>
          </div>
        )}

        {/* Quick-Reload Button while ball is in flight */}
        {telemetry.canQuickReload && telemetry.isOn && (
          <button
            type="button"
            className="cyber-btn"
            onClick={handleQuickReload}
            style={{
              borderColor: 'rgba(56, 189, 248, 0.6)',
              color: '#38bdf8',
            }}
          >
            <span>⚡ Quick Reload [Space]</span>
          </button>
        )}

        {!telemetry.cinemaMode && (
          <button
            type="button"
            className="cyber-btn"
            onClick={handleToggleAimAssist}
            style={{
              color: telemetry.aimAssist ? '#00ff87' : '#94a3b8',
              borderColor: telemetry.aimAssist ? 'rgba(0, 255, 135, 0.4)' : 'rgba(148, 163, 184, 0.25)',
            }}
          >
            <span>{telemetry.aimAssist ? '🎯 Aim Assist: ON' : '🎯 Aim Assist: OFF'}</span>
          </button>
        )}

        <button
          type="button"
          className="cyber-btn"
          onClick={handleToggleCinema}
          style={{
            color: telemetry.cinemaMode ? '#ffd700' : '#e2e8f0',
            borderColor: telemetry.cinemaMode ? 'rgba(255, 215, 0, 0.5)' : 'rgba(148, 163, 184, 0.25)',
          }}
        >
          <span>{telemetry.cinemaMode ? '🎬 Exit Cinema [H]' : '🎬 Showcase HUD'}</span>
        </button>

        {!telemetry.cinemaMode && (
          <>
            <button
              type="button"
              className="cyber-btn"
              onClick={handleToggleSound}
              style={{
                color: telemetry.soundOn ? (isZen ? '#ffd700' : '#00ff87') : '#94a3b8',
              }}
            >
              <span>{telemetry.soundOn ? '🔊 Synth: ON' : '🔇 Synth: OFF'}</span>
            </button>

            <button
              type="button"
              className="cyber-btn"
              onClick={handleResetJourney}
              style={{ color: '#e2e8f0' }}
            >
              <span>↺ Reset</span>
            </button>
          </>
        )}
      </div>

      {/* RIGHT-CENTER TACTILE FOCUS BREAKER SWITCH */}
      <div
        className="cyber-glass-pod"
        style={{
          position: 'absolute',
          top: '50%',
          right: 24,
          transform: 'translateY(-50%)',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          padding: '18px 14px',
          opacity: telemetry.cinemaMode && telemetry.isOn ? 0.35 : 1,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: telemetry.isOn ? '#e2e8f0' : '#ff3366',
            fontWeight: 800,
            letterSpacing: '0.12em',
          }}
        >
          FOCUS
        </span>

        <button
          type="button"
          aria-label="Toggle Focus Power"
          onClick={handleToggleSwitch}
          style={{
            width: 46,
            height: 92,
            background: telemetry.isOn
              ? 'rgba(0, 255, 135, 0.12)'
              : 'rgba(255, 51, 102, 0.15)',
            border: `2px solid ${
              telemetry.isOn ? (isZen ? '#ffd700' : '#00ff87') : '#ff3366'
            }`,
            borderRadius: 24,
            cursor: 'pointer',
            position: 'relative',
            transition: 'all 0.3s ease',
            boxShadow: telemetry.isOn
              ? isZen
                ? '0 0 22px rgba(255, 215, 0, 0.35)'
                : '0 0 18px rgba(0, 255, 135, 0.28)'
              : '0 0 22px rgba(255, 51, 102, 0.45)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 4,
              right: 4,
              height: 36,
              background: telemetry.isOn
                ? isZen
                  ? '#ffd700'
                  : '#00ff87'
                : '#ff3366',
              borderRadius: 18,
              top: telemetry.isOn ? 5 : 47,
              transition: 'all 0.32s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
              boxShadow: telemetry.isOn
                ? '0 0 12px rgba(255, 255, 255, 0.8)'
                : '0 0 10px rgba(255, 51, 102, 0.8)',
            }}
          />
        </button>

        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: telemetry.isOn ? '#00ff87' : '#ff6b8b',
            letterSpacing: '0.08em',
          }}
        >
          {telemetry.isOn ? 'ONLINE' : 'REBOOT'}
        </span>
      </div>

      {/* CENTER NARRATIVE HEADLINE OVERLAY */}
      <div
        style={{
          position: 'absolute',
          top: '42%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          width: '90%',
          maxWidth: 820,
          pointerEvents: 'none',
          zIndex: 5,
          opacity: telemetry.isOn ? 0.92 : 0.88,
        }}
      >
        <div
          style={{
            animation: !telemetry.isOn ? 'burnoutGlitch 0.28s infinite' : 'none',
            display: 'inline-block',
          }}
        >
          <h1
            style={{
              fontSize: 'clamp(2.2rem, 5vw, 4.5rem)',
              fontWeight: 900,
              margin: 0,
              color: isZen ? '#ffd700' : telemetry.isOn ? '#ffffff' : '#ff3366',
              letterSpacing: '-0.03em',
              textShadow: telemetry.isOn
                ? isZen
                  ? '0 10px 42px rgba(255, 215, 0, 0.55)'
                  : '0 10px 32px rgba(0, 255, 135, 0.32)'
                : '0 0 28px rgba(255, 51, 102, 0.6)',
              transition: 'color 0.4s ease, text-shadow 0.4s ease',
            }}
          >
            {titleText}
          </h1>
          <p
            style={{
              marginTop: 10,
              color: isZen
                ? 'rgba(254, 240, 138, 0.92)'
                : telemetry.isOn
                ? 'rgba(203, 213, 225, 0.82)'
                : 'rgba(253, 164, 175, 0.88)',
              fontSize: 'clamp(0.95rem, 1.6vw, 1.18rem)',
              fontWeight: 500,
              transition: 'color 0.4s ease',
            }}
          >
            {subtitleText}
          </p>
        </div>
      </div>

      {/* BOTTOM-LEFT COLLAPSIBLE TACTICAL CONTROL HINT */}
      {!telemetry.cinemaMode && showControlsHint && (
        <div
          className="cyber-glass-pod"
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            padding: '10px 14px',
            fontSize: 11,
            color: 'rgba(226, 232, 240, 0.8)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <span style={{ color: '#00ff87', fontWeight: 800 }}>CONTROLS:</span> Drag Orb to Aim •{' '}
            <span style={{ color: '#ffffff', fontWeight: 700 }}>[SPACE]</span> Quick-Reload •{' '}
            <span style={{ color: '#ffffff', fontWeight: 700 }}>[H]</span> Cinema HUD
          </div>
          <button
            type="button"
            onClick={() => setShowControlsHint(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 800,
              padding: '0 4px',
            }}
            title="Dismiss hint"
          >
            ✕
          </button>
        </div>
      )}

      {/* BOTTOM-RIGHT ENGINE STATUS BADGE */}
      {!telemetry.cinemaMode && (
        <div
          className="cyber-glass-pod"
          style={{
            position: 'absolute',
            bottom: 20,
            right: 24,
            padding: '10px 16px',
            fontSize: 12,
            color: 'rgba(226, 232, 240, 0.78)',
            textAlign: 'right',
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: '#ffffff',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 2,
            }}
          >
            The Journey • Best Streak: {telemetry.bestStreak}x
          </div>
          <div
            style={{
              color: isZen ? '#ffd700' : telemetry.isOn ? '#00ff87' : '#ff3366',
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            {isZen
              ? '✨ ZEN FLOW STATE ACTIVE (OBSTACLES DISSOLVED)'
              : telemetry.isOn
              ? '⚡ Deterministic Sub-Stepped Matter.js Physics'
              : '⚠️ SYSTEM BURNOUT — TOGGLE FOCUS SWITCH'}
          </div>
        </div>
      )}
    </div>
  );
}