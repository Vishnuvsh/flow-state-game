import React, { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';

// ============================================================================
// 1. STRICT TYPESCRIPT INTERFACES & CONFIGURATION
// ============================================================================

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

interface DistractionConfig {
  readonly id: string;
  readonly text: string;
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
  soundOn: boolean;
  rebooting: boolean;
}

const DISTRACTION_CONFIGS: readonly DistractionConfig[] = [
  { id: 'procrastination', text: 'PROCRASTINATION', width: 168, height: 28, speed: 0.0014, rangeRatio: 0.24, phaseOffset: 0 },
  { id: 'fear', text: 'FEAR', width: 96, height: 28, speed: 0.0026, rangeRatio: 0.19, phaseOffset: Math.PI * 0.5 },
  { id: 'self-doubt', text: 'SELF-DOUBT', width: 132, height: 28, speed: 0.0019, rangeRatio: 0.22, phaseOffset: Math.PI },
  { id: 'anxiety', text: 'ANXIETY', width: 112, height: 28, speed: 0.0031, rangeRatio: 0.17, phaseOffset: Math.PI * 1.5 },
  { id: 'overthinking', text: 'OVERTHINKING', width: 152, height: 28, speed: 0.0017, rangeRatio: 0.21, phaseOffset: Math.PI * 0.25 },
];

const PENTATONIC_SCALE: readonly number[] = [523.25, 659.25, 783.99, 987.77, 1174.66, 1318.51, 1567.98];

// ============================================================================
// 2. PROCEDURAL WEB AUDIO SYNTHESIZER ENGINE (ZERO EXTERNAL ASSETS)
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
      osc1.frequency.setValueAtTime(95, now);
      osc2.frequency.setValueAtTime(190, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(260, now);
      filter.Q.setValueAtTime(3.5, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.065, now + 0.08);

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
    } catch {
      // Ignore audio hardware lock errors
    }
  }

  public updatePullTension(normalizedTension: number, enabled: boolean): void {
    if (!enabled || !this.ctx || !this.pullOsc1 || !this.pullOsc2 || !this.pullFilter || !this.pullGain) return;
    try {
      const now = this.ctx.currentTime;
      const clamped = Math.max(0, Math.min(1, normalizedTension));
      const baseFreq = 95 + clamped * 235;
      this.pullOsc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
      this.pullOsc2.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.03);
      this.pullFilter.frequency.setTargetAtTime(240 + clamped * 1100, now, 0.03);
      this.pullGain.gain.setTargetAtTime(0.025 + clamped * 0.075, now, 0.03);
    } catch {}
  }

  public stopPullTension(): void {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      if (this.pullGain) {
        this.pullGain.gain.cancelScheduledValues(now);
        this.pullGain.gain.setTargetAtTime(0.0001, now, 0.025);
      }
      const o1 = this.pullOsc1;
      const o2 = this.pullOsc2;
      setTimeout(() => {
        try {
          o1?.stop();
          o2?.stop();
          o1?.disconnect();
          o2?.disconnect();
        } catch {}
      }, 60);
    } catch {}
    this.pullOsc1 = null;
    this.pullOsc2 = null;
    this.pullFilter = null;
    this.pullGain = null;
  }

  public playReleaseSnap(tension: number, enabled: boolean): void {
    this.stopPullTension();
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      const startF = 240 + tension * 220;
      osc.frequency.setValueAtTime(startF, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.19);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
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

      // Create stereo delay feedback for lush ethereal tail
      const delay = ctx.createDelay();
      const feedback = ctx.createGain();
      const delayFilter = ctx.createBiquadFilter();
      delay.delayTime.setValueAtTime(0.16, now);
      feedback.gain.setValueAtTime(0.36, now);
      delayFilter.type = 'lowpass';
      delayFilter.frequency.setValueAtTime(2200, now);

      delay.connect(delayFilter);
      delayFilter.connect(feedback);
      feedback.connect(delay);
      delay.connect(ctx.destination);

      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noteStart = now + idx * 0.045;

        osc.type = idx === 2 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.003, noteStart + 1.1);

        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.linearRampToValueAtTime(0.18 / (idx + 1), noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0008, noteStart + 1.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.connect(delay);

        osc.start(noteStart);
        osc.stop(noteStart + 1.3);
      });
    } catch {}
  }

  public playZenAscensionPad(enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const freqs = [261.63, 329.63, 392.0, 493.88, 587.33]; // Cmaj9 Lush Pad
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = i % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(f * 0.5, now);
        osc.frequency.exponentialRampToValueAtTime(f, now + 0.45);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, now);
        filter.frequency.exponentialRampToValueAtTime(2400, now + 0.9);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.055, now + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0005, now + 2.4);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 2.45);
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
      osc.frequency.setValueAtTime(145, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(420, now);
      filter.Q.setValueAtTime(2.5, now);

      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.2);
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
      osc.frequency.setValueAtTime(170, now);
      osc.frequency.exponentialRampToValueAtTime(65, now + 0.08);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
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
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.95);
      sub.frequency.setValueAtTime(95, now);
      sub.frequency.exponentialRampToValueAtTime(18, now + 0.95);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 0.95);

      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.98);

      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      sub.start(now);
      osc.stop(now + 1.0);
      sub.stop(now + 1.0);
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

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
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
// 3. MAIN HERO SCENE COMPONENT (HYBRID CANVAS2D + MATTER.JS + GLASS HUD)
// ============================================================================

export default function HeroScene(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<ProceduralAudioEngine | null>(null);

  const [telemetry, setTelemetry] = useState<TelemetryState>({
    isOn: true,
    shots: 0,
    hits: 0,
    consecutiveHits: 0,
    bestStreak: 0,
    consecutiveMisses: 0,
    score: 0,
    soundOn: true,
    rebooting: false,
  });

  // Mutable simulation state decoupled from React renders for 60/120 FPS lock
  const simRef = useRef<{
    isOn: boolean;
    soundOn: boolean;
    shots: number;
    hits: number;
    consecutiveHits: number;
    bestStreak: number;
    consecutiveMisses: number;
    score: number;
    rebootProgress: number; // 0 to 1
    timeScale: number;
    hitStopTimer: number;
    shakeTrauma: number; // 0 to 1 trauma system
    shakeMaxOffset: number; // max pixels
    shakeX: number;
    shakeY: number;
    shakeAngle: number; // rotational roll in radians
    glitchAmount: number;
    bandSnapPhase: number;
    bandSnapAmp: number;
    resetTrigger: (() => void) | null;
    togglePowerTrigger: ((nextOn: boolean) => void) | null;
  }>({
    isOn: true,
    soundOn: true,
    shots: 0,
    hits: 0,
    consecutiveHits: 0,
    bestStreak: 0,
    consecutiveMisses: 0,
    score: 0,
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
    resetTrigger: null,
    togglePowerTrigger: null,
  });

  const syncReactTelemetry = useCallback(() => {
    const s = simRef.current;
    setTelemetry({
      isOn: s.isOn,
      shots: s.shots,
      hits: s.hits,
      consecutiveHits: s.consecutiveHits,
      bestStreak: s.bestStreak,
      consecutiveMisses: s.consecutiveMisses,
      score: s.score,
      soundOn: s.soundOn,
      rebooting: s.rebootProgress < 1 && s.isOn,
    });
  }, []);

  const handleToggleSwitch = useCallback(() => {
    const s = simRef.current;
    const nextIsOn = !s.isOn;
    s.isOn = nextIsOn;
    if (nextIsOn) {
      s.consecutiveMisses = 0;
      s.rebootProgress = 0.02; // Triggers dramatic tungsten-to-emerald reboot flicker
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

  const handleResetJourney = useCallback(() => {
    const s = simRef.current;
    s.isOn = true;
    s.shots = 0;
    s.hits = 0;
    s.consecutiveHits = 0;
    s.consecutiveMisses = 0;
    s.score = 0;
    s.rebootProgress = 1;
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

    const {
      Engine,
      World,
      Bodies,
      Constraint,
      Mouse,
      MouseConstraint,
      Events,
      Vector,
      Body,
    } = Matter;

    const engine = Engine.create({
      positionIterations: 8,
      velocityIterations: 6,
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

    // Coordinate helpers responsive to screen size
    const getLampAnchor = (w: number) => ({ x: w * 0.5, y: -45 });
    const getLampStart = (w: number, h: number) => ({
      x: w * 0.5,
      y: Math.max(175, Math.min(245, h * 0.27)),
    });
    const getSlingAnchor = (w: number, h: number) => ({
      x: Math.max(135, Math.min(240, w * 0.15)),
      y: h - Math.max(135, Math.min(185, h * 0.21)),
    });

    const lampRadius = 42;
    const projRadius = 15;
    let lampAnchor = getLampAnchor(width);
    let lampStart = getLampStart(width, height);
    let slingAnchor = getSlingAnchor(width, height);

    // 1. Swinging Pendulum Target ("THE DREAM")
    const lampBody = Bodies.circle(lampStart.x, lampStart.y, lampRadius, {
      restitution: 0.85,
      frictionAir: 0.008,
      density: 0.045,
      label: 'lamp',
    });

    const lampConstraint = Constraint.create({
      pointA: lampAnchor,
      bodyB: lampBody,
      stiffness: 0.98,
      length: lampStart.y - lampAnchor.y,
    });

    // 2. Slingshot Projectile
    let projectile = Bodies.circle(slingAnchor.x, slingAnchor.y, projRadius, {
      restitution: 0.62,
      frictionAir: 0.004,
      density: 0.055,
      label: 'projectile',
      isStatic: !simRef.current.isOn,
    });

    let slingConstraint: Matter.Constraint | null = Constraint.create({
      pointA: slingAnchor,
      bodyB: projectile,
      stiffness: 0.046,
      damping: 0.015,
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
        restitution: 0.9,
        label: 'distraction',
        chamfer: { radius: 14 },
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
    const wallThickness = 60;
    const ground = Bodies.rectangle(width / 2, height + wallThickness / 2, width * 3, wallThickness, {
      isStatic: true,
      restitution: 0.55,
      label: 'wall',
    });
    const ceiling = Bodies.rectangle(width / 2, -wallThickness * 2, width * 3, wallThickness, {
      isStatic: true,
      restitution: 0.55,
      label: 'wall',
    });
    const wallLeft = Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height * 3, {
      isStatic: true,
      restitution: 0.55,
      label: 'wall',
    });
    const wallRight = Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height * 3, {
      isStatic: true,
      restitution: 0.55,
      label: 'wall',
    });

    World.add(world, [
      lampBody,
      lampConstraint,
      projectile,
      slingConstraint,
      ground,
      ceiling,
      wallLeft,
      wallRight,
      ...distractions.map((d) => d.body),
    ]);

    // 5. Mouse & Touch Interaction Constraint
    const mouse = Mouse.create(canvas);
    // Keep Matter.js mouse coordinates in CSS pixel space regardless of canvas DPI scaling
    Mouse.setScale(mouse, { x: 1 / dpr, y: 1 / dpr });

    const mouseConstraint = MouseConstraint.create(engine, {
      mouse,
      constraint: {
        stiffness: 0.24,
        damping: 0.1,
        render: { visible: false },
      },
    });
    World.add(world, mouseConstraint);

    // Background Starfield & Ambient Motes
    const stars: StarNode[] = Array.from({ length: 75 }, () => ({
      xRatio: Math.random(),
      yRatio: Math.random(),
      size: 0.7 + Math.random() * 1.8,
      baseAlpha: 0.15 + Math.random() * 0.55,
      twinkleSpeed: 0.8 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
    }));

    const particles: Particle[] = [];
    const floatingTexts: FloatingText[] = [];
    const trailPoints: TrailPoint[] = [];

    let isDragging = false;
    let isFired = false;
    let hitThisShot = false;
    let respawnTimeout: ReturnType<typeof setTimeout> | null = null;

    const spawnParticles = (
      x: number,
      y: number,
      count: number,
      colors: readonly string[],
      speedRange: number,
      starProbability = 0.4
    ) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (0.2 + Math.random() * 0.8) * speedRange;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          size: 2 + Math.random() * 4.5,
          alpha: 1,
          decay: 0.012 + Math.random() * 0.018,
          color: colors[i % colors.length],
          isStar: Math.random() < starProbability,
          rotation: Math.random() * Math.PI,
          vRot: (Math.random() - 0.5) * 0.18,
        });
      }
    };



    // Micro-shake impact trigger: non-linear trauma system for tactile game feel
    const triggerHitImpact = (trauma: number, maxOffset: number) => {
      const s = simRef.current;
      s.shakeTrauma = Math.min(1.0, Math.max(s.shakeTrauma, trauma));
      s.shakeMaxOffset = Math.max(s.shakeMaxOffset, maxOffset);
    };

    const spawnFloatingText = (x: number, y: number, text: string, color: string, subtext?: string) => {
      floatingTexts.push({
        x,
        y,
        vy: -1.65,
        text,
        subtext,
        alpha: 1,
        scale: 0.65,
        color,
      });
    };

    const respawnProjectile = () => {
      if (respawnTimeout) {
        clearTimeout(respawnTimeout);
        respawnTimeout = null;
      }
      if (slingConstraint) {
        World.remove(world, slingConstraint);
        slingConstraint = null;
      }
      World.remove(world, projectile);

      projectile = Bodies.circle(slingAnchor.x, slingAnchor.y, projRadius, {
        restitution: 0.62,
        frictionAir: 0.004,
        density: 0.055,
        label: 'projectile',
        isStatic: !simRef.current.isOn,
      });

      slingConstraint = Constraint.create({
        pointA: slingAnchor,
        bodyB: projectile,
        stiffness: 0.046,
        damping: 0.015,
      });

      World.add(world, [projectile, slingConstraint]);
      isFired = false;
      isDragging = false;
      trailPoints.length = 0;
    };

    // Hook up external triggers for Reset and Power Switch
    simRef.current.togglePowerTrigger = (nextOn: boolean) => {
      Body.setStatic(projectile, !nextOn);
      if (nextOn) {
        triggerHitImpact(0.4, 10);
        spawnFloatingText(lampBody.position.x, lampBody.position.y + 55, 'LIGHT REIGNITED', '#00ff87', 'Gravity Reset to 1.0G');
      }
    };

    simRef.current.resetTrigger = () => {
      respawnProjectile();
      Body.setPosition(lampBody, { x: lampStart.x, y: lampStart.y });
      Body.setVelocity(lampBody, { x: 0, y: 0 });
      triggerHitImpact(0.3, 8);
    };

    // Drag Events
    Events.on(mouseConstraint, 'startdrag', (event: any) => {
      const dragBody = (event as unknown as { body: Matter.Body }).body;
      if (!simRef.current.isOn || isFired) return;
      if (dragBody === projectile) {
        isDragging = true;
        audio.startPullTension(simRef.current.soundOn);
      }
    });

    Events.on(mouseConstraint, 'enddrag', (event: any) => {
      const dragBody = (event as unknown as { body: Matter.Body }).body;
      if (!simRef.current.isOn) return;
      if (dragBody === projectile && isDragging) {
        isDragging = false;
        const pullVec = Vector.sub(slingAnchor, projectile.position);
        const pullDist = Vector.magnitude(pullVec);

        if (pullDist > 26) {
          isFired = true;
          hitThisShot = false;
          simRef.current.shots += 1;
          const normTension = Math.min(1, pullDist / 160);
          simRef.current.bandSnapAmp = Math.min(28, pullDist * 0.22);
          simRef.current.bandSnapPhase = 0;

          triggerHitImpact(0.22, 6);

          audio.playReleaseSnap(normTension, simRef.current.soundOn);
          syncReactTelemetry();
        } else {
          audio.stopPullTension();
        }
      }
    });

    // Collision Events
    Events.on(engine, 'collisionStart', (event: Matter.IEventCollision<Matter.Engine>) => {
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

            // Hit-Stop Time Dilation
            s.timeScale = 0.12;
            s.hitStopTimer = 0.14;

            const lx = lampBody.position.x;
            const ly = lampBody.position.y;
            const enteringZen = nextStreak >= 3;

            // Pure Punchy Screen Shake
            triggerHitImpact(enteringZen ? 1.0 : 0.85, enteringZen ? 28 : 20);

            spawnParticles(
              lx,
              ly,
              enteringZen ? 60 : 40,
              enteringZen ? ['#ffd700', '#fef08a', '#ffffff', '#00ff87'] : ['#00ff87', '#38bdf8', '#ffffff'],
              enteringZen ? 15 : 11,
              0.55
            );

            if (nextStreak === 3) {
              audio.playZenAscensionPad(s.soundOn);
              spawnFloatingText(lx, ly - 48, 'FLOW STATE ACHIEVED!', '#ffd700', `+$${pointsEarned} • DISTRACTIONS DISSOLVED`);
            } else if (nextStreak > 3) {
              audio.playDreamHitChime(nextStreak, s.soundOn);
              spawnFloatingText(lx, ly - 45, `TRANSCENDENCE x${nextStreak}`, '#ffd700', `+${pointsEarned} FLOW`);
            } else {
              audio.playDreamHitChime(nextStreak, s.soundOn);
              spawnFloatingText(
                lx,
                ly - 42,
                nextStreak === 2 ? `HYPERFOCUS x2` : `+${pointsEarned} CLARITY`,
                '#00ff87',
                `${3 - nextStreak} more for Flow State`
              );
            }

            syncReactTelemetry();
          }
        }
        // 2. Distraction Barrier Hit ("PROCRASTINATION", "FEAR", etc.)
        else if (labels.includes('distraction') && labels.includes('projectile')) {
          const distBody = bodyA.label === 'distraction' ? bodyA : bodyB;
          const distEntity = distractions.find((d) => d.body === distBody);
          if (distEntity && !distBody.isSensor) {
            distEntity.hitFlash = 1.0;
            distEntity.shudderX = (Math.random() - 0.5) * 16;
            distEntity.shudderY = (Math.random() - 0.5) * 12;

            // Pure Punchy Screen Shake on Obstacle Hit
            triggerHitImpact(0.65, 14);

            const cx = projectile.position.x;
            const cy = projectile.position.y;
            spawnParticles(cx, cy, 20, ['#ff3366', '#fb7185', '#fda4af'], 8, 0.2);
            spawnFloatingText(cx, cy - 22, `${distEntity.text} BLOCKED`, '#ff3366');
            audio.playDistractionHit(s.soundOn);
          }
        }
        // 3. Boundary Wall Bounce
        else if (labels.includes('wall') && labels.includes('projectile')) {
          audio.playWallBounce(s.soundOn);
        }
      }
    });

    // Handle Viewport Resize cleanly
    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth || window.innerWidth;
      height = container.clientHeight || window.innerHeight;
      resizeCanvas(width, height);
      Mouse.setScale(mouse, { x: 1 / dpr, y: 1 / dpr });

      lampAnchor = getLampAnchor(width);
      lampStart = getLampStart(width, height);
      slingAnchor = getSlingAnchor(width, height);

      lampConstraint.pointA = lampAnchor;
      lampConstraint.length = lampStart.y - lampAnchor.y;
      if (Math.abs(lampBody.velocity.x) < 0.1 && Math.abs(lampBody.velocity.y) < 0.1) {
        Body.setPosition(lampBody, { x: lampStart.x, y: lampStart.y });
      }

      if (slingConstraint) {
        slingConstraint.pointA = slingAnchor;
      }
      if (!isFired && !isDragging) {
        Body.setPosition(projectile, slingAnchor);
        Body.setVelocity(projectile, { x: 0, y: 0 });
      }

      distractions.forEach((d, idx) => {
        d.baseY = buildDistractionY(idx, distractions.length, height);
      });

      Body.setPosition(ground, { x: width / 2, y: height + wallThickness / 2 });
      Body.setPosition(ceiling, { x: width / 2, y: -wallThickness * 2 });
      Body.setPosition(wallLeft, { x: -wallThickness / 2, y: height / 2 });
      Body.setPosition(wallRight, { x: width + wallThickness / 2, y: height / 2 });
    };

    window.addEventListener('resize', handleResize);

    // Helper to draw rounded capsule rectangles on Canvas2D
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
    // HIGH-FREQUENCY 60/120 FPS HYBRID PHYSICS & CANVAS RENDER LOOP
    // ========================================================================
    let animFrameId = 0;
    let lastTime = performance.now();

    const renderLoop = (now: number) => {
      const rawDt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000));
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

      // 2. Dynamic Gravity & Distraction Kinematics
      const misses = Math.max(0, s.shots - s.hits);
      const currentGravity = s.isOn ? 1 + Math.min(misses * 0.3, 2.5) : 2.8;
      engine.world.gravity.y = currentGravity;

      const isZen = s.consecutiveHits >= 3 && s.isOn;

      distractions.forEach((d, idx) => {
        d.body.isSensor = isZen || !s.isOn;
        if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - rawDt * 3.2);
        d.shudderX *= 0.82;
        d.shudderY *= 0.82;

        if (!isZen && s.isOn) {
          const swingX = width * 0.5 + Math.sin(now * d.speed + d.phaseOffset) * (width * d.rangeRatio);
          const bobY = d.baseY + Math.cos(now * 0.0022 + idx * 1.3) * 6;
          Body.setPosition(d.body, { x: swingX, y: bobY });
        }
      });

      // Clamp maximum drag stretch so the slingshot feels taut & controllable
      if (isDragging) {
        const pullVec = Vector.sub(projectile.position, slingAnchor);
        const pullDist = Vector.magnitude(pullVec);
        const maxPull = 175;
        if (pullDist > maxPull) {
          const clampedPos = Vector.add(slingAnchor, Vector.mult(Vector.normalise(pullVec), maxPull));
          Body.setPosition(projectile, clampedPos);
        }
        audio.updatePullTension(Math.min(1, pullDist / maxPull), s.soundOn);
      }

      // Release projectile from elastic sling band once it crosses the anchor plane
      if (isFired && slingConstraint && slingConstraint.bodyB) {
        const distFromAnchor = Vector.magnitude(Vector.sub(projectile.position, slingAnchor));
        if (
          projectile.position.x > slingAnchor.x + 12 ||
          projectile.position.y < slingAnchor.y - 14 ||
          distFromAnchor < 22
        ) {
          World.remove(world, slingConstraint);
          slingConstraint.bodyB = null;

          respawnTimeout = setTimeout(() => {
            if (!hitThisShot) {
              s.consecutiveHits = 0;
              s.consecutiveMisses += 1;
              if (s.consecutiveMisses >= 3 && s.isOn) {
                s.isOn = false;
                s.rebootProgress = 0;
                s.glitchAmount = 1.0;
                triggerHitImpact(0.85, 22);
              }
            }
            hitThisShot = false;
            respawnProjectile();
            syncReactTelemetry();
          }, 2300);
        }
      }

      // Step Matter.js Physics with Hit-Stop timeScale
      Engine.update(engine, (1000 / 60) * s.timeScale);

      // Record Comet Trail Points when projectile is in flight
      if (isFired || isDragging) {
        trailPoints.unshift({
          x: projectile.position.x,
          y: projectile.position.y,
          vx: projectile.velocity.x,
          vy: projectile.velocity.y,
          alpha: 0.9,
          radius: projRadius * 0.92,
        });
        if (trailPoints.length > 22) trailPoints.pop();
      }
      for (let i = trailPoints.length - 1; i >= 0; i--) {
        trailPoints[i].alpha -= rawDt * 2.6;
        trailPoints[i].radius *= 0.96;
        if (trailPoints[i].alpha <= 0.02) trailPoints.splice(i, 1);
      }

      // Decay Trauma-based Micro-Shake, Glitch, and Slingshot Band Snap-Back
      if (s.shakeTrauma > 0.001) {
        const shakePower = s.shakeTrauma * s.shakeTrauma; // Quadratic punch curve
        const freq = now * 0.052;
        s.shakeX = (Math.sin(freq * 1.7) * 0.75 + (Math.random() - 0.5) * 0.5) * s.shakeMaxOffset * shakePower;
        s.shakeY = (Math.cos(freq * 2.1) * 0.75 + (Math.random() - 0.5) * 0.5) * s.shakeMaxOffset * shakePower;
        s.shakeAngle = (Math.sin(freq * 0.95) * 0.7 + (Math.random() - 0.5) * 0.3) * 0.026 * shakePower;
        s.shakeTrauma = Math.max(0, s.shakeTrauma - rawDt * 2.6);
      } else {
        s.shakeTrauma = 0;
        s.shakeX = 0;
        s.shakeY = 0;
        s.shakeAngle = 0;
      }



      s.glitchAmount *= 0.9;
      if (s.bandSnapAmp > 0.2) {
        s.bandSnapPhase += rawDt * 42;
        s.bandSnapAmp *= 0.9;
      } else {
        s.bandSnapAmp = 0;
      }

      // ======================================================================
      // CANVAS 2D LAYERED HARDWARE-ACCELERATED RENDERING
      // ======================================================================
      ctx.save();

      // 1. Deep Obsidian Space Backdrop (64px overdraw prevents camera shake edge gaps)
      const overdraw = 64;
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      if (isZen) {
        bgGrad.addColorStop(0, '#071717');
        bgGrad.addColorStop(0.55, '#091d24');
        bgGrad.addColorStop(1, '#040a10');
      } else if (s.isOn) {
        bgGrad.addColorStop(0, '#050811');
        bgGrad.addColorStop(0.6, '#08101d');
        bgGrad.addColorStop(1, '#04060c');
      } else {
        bgGrad.addColorStop(0, '#030306');
        bgGrad.addColorStop(0.6, '#090408');
        bgGrad.addColorStop(1, '#020204');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-overdraw, -overdraw, width + overdraw * 2, height + overdraw * 2);

      // Apply Directional & Rotational Camera Micro-Shake Centered on Screen
      if (s.shakeTrauma > 0.001 || Math.abs(s.shakeX) > 0.1 || Math.abs(s.shakeY) > 0.1) {
        ctx.translate(width * 0.5 + s.shakeX, height * 0.5 + s.shakeY);
        ctx.rotate(s.shakeAngle);
        ctx.translate(-width * 0.5, -height * 0.5);
      }

      // 2. Parallax Twinkling Starfield & Subtle Horizon Grid
      stars.forEach((st) => {
        const twinkle = st.baseAlpha + Math.sin(now * 0.001 * st.twinkleSpeed + st.phase) * 0.22;
        const alpha = Math.max(0.05, Math.min(0.9, twinkle * (s.isOn ? 1 : 0.35)));
        ctx.fillStyle = isZen ? `rgba(255, 225, 130, ${alpha})` : `rgba(186, 230, 253, ${alpha})`;
        ctx.beginPath();
        ctx.arc(st.xRatio * width, st.yRatio * height, st.size, 0, Math.PI * 2);
        ctx.fill();
      });

      const lx = lampBody.position.x;
      const ly = lampBody.position.y;

      // Reboot flicker calculation
      const rebootFlicker =
        s.rebootProgress < 1
          ? Math.random() < s.rebootProgress
            ? 0.4 + s.rebootProgress * 0.6
            : 0.12
          : 1.0;

      // 3. Dynamic Volumetric Lamp Lighting ("THE DREAM" Aura)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (s.isOn) {
        const lightRadius = (isZen ? 560 : 440) * rebootFlicker;
        const volGrad = ctx.createRadialGradient(lx, ly, 10, lx, ly, lightRadius);
        if (isZen) {
          volGrad.addColorStop(0, `rgba(255, 215, 0, ${0.34 * rebootFlicker})`);
          volGrad.addColorStop(0.35, `rgba(245, 158, 11, ${0.14 * rebootFlicker})`);
          volGrad.addColorStop(0.7, `rgba(16, 185, 129, ${0.05 * rebootFlicker})`);
          volGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
          volGrad.addColorStop(0, `rgba(0, 255, 135, ${0.26 * rebootFlicker})`);
          volGrad.addColorStop(0.4, `rgba(56, 189, 248, ${0.11 * rebootFlicker})`);
          volGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }
        ctx.fillStyle = volGrad;
        ctx.beginPath();
        ctx.arc(lx, ly, lightRadius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Burnout Dying Ember Glow
        const emberFlicker = 0.6 + Math.sin(now * 0.018) * 0.25;
        const burnGrad = ctx.createRadialGradient(lx, ly, 4, lx, ly, 150);
        burnGrad.addColorStop(0, `rgba(255, 51, 102, ${0.18 * emberFlicker})`);
        burnGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = burnGrad;
        ctx.beginPath();
        ctx.arc(lx, ly, 150, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 4. Predictive Ballistic Trajectory Arc (while aiming slingshot)
      if (isDragging && s.isOn && slingConstraint?.bodyB) {
        const pullVec = Vector.sub(slingAnchor, projectile.position);
        const pullDist = Vector.magnitude(pullVec);
        if (pullDist > 26) {
          // Calibrated initial velocity matching Matter.js constraint integration
          const launchSpeedScale = 0.265;
          let simVx = pullVec.x * launchSpeedScale;
          let simVy = pullVec.y * launchSpeedScale;
          let simX = slingAnchor.x;
          let simY = slingAnchor.y;
          const gravStep = currentGravity * 0.285;

          ctx.save();
          for (let step = 1; step <= 34; step++) {
            simVy += gravStep;
            simX += simVx * 1.35;
            simY += simVy * 1.35;
            simVx *= 0.995;
            simVy *= 0.995;

            const ratio = 1 - step / 35;
            const dotRadius = 1.6 + ratio * 2.8;
            ctx.fillStyle = isZen
              ? `rgba(255, 215, 0, ${ratio * 0.75})`
              : `rgba(0, 255, 135, ${ratio * 0.72})`;
            ctx.beginPath();
            ctx.arc(simX, simY, dotRadius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // 5. Slingshot Fork Posts & Elastic Tension Bands
      const leftFork = { x: slingAnchor.x - 22, y: slingAnchor.y };
      const rightFork = { x: slingAnchor.x + 22, y: slingAnchor.y };
      const basePostY = height - 35;

      // Metallic Slingshot Y-Frame Posts
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(leftFork.x, basePostY);
      ctx.lineTo(leftFork.x, leftFork.y);
      ctx.moveTo(rightFork.x, basePostY);
      ctx.lineTo(rightFork.x, rightFork.y);
      ctx.stroke();

      // Glowing Anchor Nodes on Slingshot Tips
      const forkGlowColor = isZen ? '#ffd700' : s.isOn ? '#00ff87' : '#ff3366';
      [leftFork, rightFork].forEach((fk) => {
        ctx.fillStyle = forkGlowColor;
        ctx.beginPath();
        ctx.arc(fk.x, fk.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Elastic Slingshot Bands (with dynamic thickness & snap-back harmonic)
      if (slingConstraint && slingConstraint.bodyB) {
        const px = projectile.position.x;
        const py = projectile.position.y;
        const pullDist = Vector.magnitude(Vector.sub(slingAnchor, projectile.position));
        const bandThickness = Math.max(1.6, 4.2 - (pullDist / 175) * 2.2);
        const tensionRatio = Math.min(1, pullDist / 175);

        ctx.lineWidth = bandThickness;
        ctx.strokeStyle = isZen
          ? `rgba(255, 215, 0, ${0.55 + tensionRatio * 0.45})`
          : `rgba(0, 255, 135, ${0.45 + tensionRatio * 0.5})`;

        // Back band (Right fork to projectile)
        ctx.beginPath();
        ctx.moveTo(rightFork.x, rightFork.y);
        ctx.lineTo(px, py);
        ctx.stroke();
      } else if (s.bandSnapAmp > 0.4) {
        // Elastic snap-back oscillation after release
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
            ? `rgba(255, 215, 0, ${pt.alpha * 0.65})`
            : `rgba(0, 255, 135, ${pt.alpha * 0.65})`;
          ctx.lineWidth = Math.max(1.5, pt.radius * 1.5);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(nextPt.x, nextPt.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 7. Projectile Orb & Front Slingshot Band
      const px = projectile.position.x;
      const py = projectile.position.y;
      ctx.save();
      const projColor = isZen ? '#ffd700' : s.isOn ? '#00ff87' : '#475569';
      if (s.isOn) {
        ctx.shadowColor = projColor;
        ctx.shadowBlur = isDragging ? 26 : 18;
      }
      ctx.fillStyle = projColor;
      ctx.beginPath();
      ctx.arc(px, py, projRadius, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright core
      ctx.fillStyle = s.isOn ? '#ffffff' : '#94a3b8';
      ctx.beginPath();
      ctx.arc(px - 3, py - 3, projRadius * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Front band (Left fork to projectile) drawn over the projectile for depth
      if (slingConstraint && slingConstraint.bodyB) {
        const pullDist = Vector.magnitude(Vector.sub(slingAnchor, projectile.position));
        const bandThickness = Math.max(1.8, 4.4 - (pullDist / 175) * 2.2);
        const tensionRatio = Math.min(1, pullDist / 175);
        ctx.save();
        ctx.lineWidth = bandThickness;
        ctx.lineCap = 'round';
        ctx.strokeStyle = isZen
          ? `rgba(255, 215, 0, ${0.65 + tensionRatio * 0.35})`
          : `rgba(0, 255, 135, ${0.55 + tensionRatio * 0.45})`;
        ctx.beginPath();
        ctx.moveTo(leftFork.x, leftFork.y);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();
      }

      // 8. Mental Friction Distraction Capsules
      distractions.forEach((d) => {
        const visibility = isZen ? 0.14 : s.isOn ? 1.0 : 0.22;
        const dx = d.body.position.x + d.shudderX;
        const dy = d.body.position.y + d.shudderY;
        const rx = dx - d.width / 2;
        const ry = dy - d.height / 2;

        ctx.save();
        ctx.globalAlpha = visibility;

        // Capsule glass fill
        ctx.fillStyle =
          d.hitFlash > 0.05
            ? `rgba(255, 51, 102, ${0.28 + d.hitFlash * 0.45})`
            : 'rgba(15, 23, 42, 0.78)';
        drawRoundedRect(rx, ry, d.width, d.height, 14);
        ctx.fill();

        // Crisp Geometric Typography
        ctx.shadowBlur = 0;
        ctx.font = '700 11px "JetBrains Mono", "Inter", monospace';
        ctx.fillStyle = d.hitFlash > 0.1 ? '#ffffff' : isZen ? '#fde68a' : '#ff6b8b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text, dx, dy + 0.5);

        ctx.restore();
      });

      // 9. Swinging Pendulum Cord & "THE DREAM" Target Orb
      ctx.save();
      ctx.strokeStyle = s.isOn
        ? isZen
          ? 'rgba(255, 215, 0, 0.55)'
          : 'rgba(255, 255, 255, 0.28)'
        : 'rgba(148, 163, 184, 0.15)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(lampAnchor.x, lampAnchor.y);
      ctx.lineTo(lx, ly);
      ctx.stroke();

      // Pulsing Outer Energy Halo around "THE DREAM"
      const pulseScale = 1 + Math.sin(now * 0.0045) * 0.06;
      const effectiveR = lampRadius * pulseScale;

      if (s.isOn) {
        ctx.strokeStyle = isZen
          ? `rgba(255, 215, 0, ${0.42 * rebootFlicker})`
          : `rgba(0, 255, 135, ${0.36 * rebootFlicker})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lx, ly, effectiveR + 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Main Orb Body
      ctx.shadowColor = s.isOn ? (isZen ? '#ffd700' : '#00ff87') : '#ff3366';
      ctx.shadowBlur = s.isOn ? 38 * rebootFlicker : 10;
      const orbGrad = ctx.createRadialGradient(lx, ly, 4, lx, ly, lampRadius);
      if (s.isOn) {
        if (isZen) {
          orbGrad.addColorStop(0, '#ffffff');
          orbGrad.addColorStop(0.55, '#fde047');
          orbGrad.addColorStop(1, '#eab308');
        } else {
          orbGrad.addColorStop(0, '#ffffff');
          orbGrad.addColorStop(0.65, '#d1fae5');
          orbGrad.addColorStop(1, '#10b981');
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

      // "THE DREAM" Label inside Orb
      ctx.shadowBlur = 0;
      ctx.fillStyle = s.isOn ? '#04070d' : '#94a3b8';
      ctx.font = '900 10.5px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('THE', lx, ly - 6);
      ctx.fillText('DREAM', lx, ly + 6);
      ctx.restore();



      // 11. Exploding Star-Dust & Ember Particles
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * s.timeScale;
        p.y += p.vy * s.timeScale;
        p.vy += 0.22 * s.timeScale;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.rotation += p.vRot;
        p.alpha -= p.decay;

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
        ft.y += ft.vy;
        ft.vy *= 0.96;
        ft.scale += (1.0 - ft.scale) * 0.2;
        ft.alpha -= rawDt * 0.85;

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
        ctx.shadowBlur = 12;
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, 0, 0);
        if (ft.subtext) {
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#e2e8f0';
          ctx.shadowBlur = 0;
          ctx.fillText(ft.subtext, 0, 16);
        }
        ctx.restore();
      }
      ctx.restore();

      ctx.restore();

      // Clean canvas filter
      if (canvasRef.current && canvasRef.current.style.filter !== '') {
        canvasRef.current.style.filter = '';
      }

      // Micro-shudder on container DOM element during high-impact moments
      if (containerRef.current) {
        if (s.shakeTrauma > 0.12) {
          const hudShakeX = (s.shakeX * 0.35).toFixed(1);
          const hudShakeY = (s.shakeY * 0.35).toFixed(1);
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
      Events.off(engine, 'collisionStart', () => {});
      Events.off(mouseConstraint, 'startdrag', () => {});
      Events.off(mouseConstraint, 'enddrag', () => {});
      World.clear(world, false);
      Engine.clear(engine);
      audio.dispose();
    };
  }, [syncReactTelemetry]);

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
        backgroundColor: '#04070d',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Embedded Scoped Styles for Glassmorphism HUD & Glitch Keyframes */}
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
          background: rgba(9, 14, 26, 0.72);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 16px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .cyber-btn {
          background: rgba(15, 23, 42, 0.82);
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
        }
        .cyber-btn:hover {
          transform: translateY(-1px);
          border-color: rgba(0, 255, 135, 0.6);
          box-shadow: 0 0 18px rgba(0, 255, 135, 0.22);
        }
      `}</style>

      {/* High-DPI 2D Physics & Particle Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          cursor: telemetry.isOn ? 'grab' : 'not-allowed',
          zIndex: 1,
        }}
      />

      {/* TOP-LEFT TELEMETRY HUD POD */}
      <div
        className="cyber-glass-pod"
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          padding: '14px 18px',
          minWidth: 220,
          zIndex: 10,
          color: 'rgba(226, 232, 240, 0.85)',
          fontSize: 12,
          lineHeight: 1.65,
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
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: isZen
                ? 'rgba(255, 215, 0, 0.18)'
                : telemetry.isOn
                ? 'rgba(0, 255, 135, 0.15)'
                : 'rgba(255, 51, 102, 0.2)',
              color: isZen ? '#ffd700' : telemetry.isOn ? '#00ff87' : '#ff3366',
              border: `1px solid ${isZen ? 'rgba(255,215,0,0.4)' : telemetry.isOn ? 'rgba(0,255,135,0.35)' : 'rgba(255,51,102,0.4)'}`,
            }}
          >
            {isZen ? 'ZEN FLOW' : telemetry.isOn ? 'IN PROGRESS' : 'BURNOUT'}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Gravity Load</span>
          <span style={{ color: Number(gravityG) > 1.8 ? '#ff6b8b' : '#ffffff', fontWeight: 700 }}>
            {gravityG}G
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Attempts / Hits</span>
          <span style={{ color: '#ffffff', fontWeight: 600 }}>
            {telemetry.shots} / {telemetry.hits} ({accuracy}%)
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Flow Score</span>
          <span style={{ color: isZen ? '#ffd700' : '#00ff87', fontWeight: 700 }}>
            {telemetry.score.toLocaleString()}
          </span>
        </div>
      </div>

      {/* TOP-RIGHT STREAK RING & AUDIO CONTROLS */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 24,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* SVG Flow Streak Progress Ring */}
        <div
          className="cyber-glass-pod"
          style={{
            padding: '6px 12px',
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
              : '0 0 18px rgba(255, 51, 102, 0.35)',
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
            fontWeight: 700,
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
          opacity: telemetry.isOn ? 0.92 : 0.85,
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
                ? 'rgba(254, 240, 138, 0.9)'
                : telemetry.isOn
                ? 'rgba(203, 213, 225, 0.8)'
                : 'rgba(253, 164, 175, 0.85)',
              fontSize: 'clamp(0.95rem, 1.6vw, 1.18rem)',
              fontWeight: 500,
              transition: 'color 0.4s ease',
            }}
          >
            {subtitleText}
          </p>
        </div>
      </div>

      {/* BOTTOM-RIGHT ENGINE STATUS BADGE */}
      <div
        className="cyber-glass-pod"
        style={{
          position: 'absolute',
          bottom: 20,
          right: 24,
          padding: '10px 16px',
          fontSize: 12,
          color: 'rgba(226, 232, 240, 0.75)',
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
            ? '⚡ 60/120 FPS Hybrid Canvas + Matter.js Physics'
            : '⚠️ SYSTEM BURNOUT — TOGGLE FOCUS SWITCH'}
        </div>
      </div>
    </div>
  );
}
