import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

const getAudioCtx = () => {
  if (!window.audioCtxInstance) {
    window.audioCtxInstance = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (window.audioCtxInstance.state === 'suspended') {
    window.audioCtxInstance.resume();
  }
  return window.audioCtxInstance;
};

declare global {
  interface Window { audioCtxInstance: AudioContext; }
}

const playSound = (type: OscillatorType, startFreq: number, endFreq: number, duration: number, vol: number) => {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch(e) {}
};

const distData = [
  { text: 'PROCRASTINATION', w: 140, speed: 0.0015, range: 250, offset: 0 },
  { text: 'FEAR', w: 70, speed: 0.0028, range: 180, offset: Math.PI / 2 },
  { text: 'SELF-DOUBT', w: 90, speed: 0.002, range: 220, offset: Math.PI },
  { text: 'ANXIETY', w: 80, speed: 0.0035, range: 150, offset: Math.PI * 1.5 },
  { text: 'OVERTHINKING', w: 120, speed: 0.0018, range: 200, offset: Math.PI / 4 }
];

export default function HeroScene() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const lampRef = useRef<HTMLDivElement>(null);
  const projectileRef = useRef<HTMLDivElement>(null);
  const stringRef = useRef<HTMLDivElement>(null);
  const slingString1Ref = useRef<HTMLDivElement>(null);
  const slingString2Ref = useRef<HTMLDivElement>(null);
  const distRefs = useRef<(HTMLDivElement | null)[]>(Array(distData.length).fill(null));
  
  const NUM_TRAILS = 15;
  const trailsRef = useRef<(HTMLDivElement | null)[]>(Array(NUM_TRAILS).fill(null));
  const NUM_SPARKS = 30;
  const sparksRef = useRef<(HTMLDivElement | null)[]>(Array(NUM_SPARKS).fill(null));

  const [isOn, setIsOn] = useState(true);
  const [shots, setShots] = useState(0);
  const [hits, setHits] = useState(0);
  const [consecutiveHits, setConsecutiveHits] = useState(0);
  const [consecutiveMisses, setConsecutiveMisses] = useState(0);
  const [soundOn, setSoundOn] = useState(true);

  // Refs for physics callbacks
  const isOnRef = useRef(isOn);
  const soundOnRef = useRef(soundOn);
  const consecutiveHitsRef = useRef(consecutiveHits);
  const consecutiveMissesRef = useRef(consecutiveMisses);
  const shotsRef = useRef(shots);
  const hitsRef = useRef(hits);
  const physicsDistractionsRef = useRef<any[]>([]);
  const projBodyRef = useRef<Matter.Body | null>(null);
  
  useEffect(() => { 
    isOnRef.current = isOn; 
    if (projBodyRef.current) {
      Matter.Body.setStatic(projBodyRef.current, !isOn);
    }
  }, [isOn]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { consecutiveHitsRef.current = consecutiveHits; }, [consecutiveHits]);
  useEffect(() => { consecutiveMissesRef.current = consecutiveMisses; }, [consecutiveMisses]);
  useEffect(() => { shotsRef.current = shots; hitsRef.current = hits; }, [shots, hits]);

  const handleSwitch = () => {
    const nextIsOn = !isOn;
    setIsOn(nextIsOn);
    if (nextIsOn) {
      setConsecutiveMisses(0); // Reset misses when they turn it back on
    }
    if (soundOnRef.current) playSound('square', nextIsOn ? 800 : 400, 100, 0.1, 0.1);
  };

  useEffect(() => {
    if (!sceneRef.current) return;

    const Engine = Matter.Engine,
      World = Matter.World,
      Bodies = Matter.Bodies,
      Constraint = Matter.Constraint,
      MouseConstraint = Matter.MouseConstraint,
      Mouse = Matter.Mouse,
      Events = Matter.Events,
      Vector = Matter.Vector,
      Body = Matter.Body;

    const engine = Engine.create();
    const world = engine.world;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // --- LAMP (Target) ---
    const lampX = width / 2;
    const lampY = 250;
    const lampRadius = 40;
    const lampAnchor = { x: lampX, y: -50 };
    const lampBody = Bodies.circle(lampX, lampY, lampRadius, {
      restitution: 0.8, frictionAir: 0.01, density: 0.05, label: 'lamp', render: { visible: false }
    });
    const lampConstraint = Constraint.create({
      pointA: lampAnchor, bodyB: lampBody, stiffness: 1, length: 300, render: { visible: false }
    });

    // --- SLINGSHOT ---
    const slingAnchor = { x: 150, y: height - 150 };
    const projRadius = 15;
    let projectile = Bodies.circle(slingAnchor.x, slingAnchor.y, projRadius, {
      restitution: 0.5, density: 0.05, label: 'projectile', isStatic: !isOnRef.current, render: { visible: false }
    });
    projBodyRef.current = projectile;
    
    let slingConstraint = Constraint.create({
      pointA: slingAnchor, bodyB: projectile, stiffness: 0.04, damping: 0.01, render: { visible: false }
    });

    // --- DISTRACTIONS DYNAMIC ---
    const startY = lampY + 80;
    const endY = slingAnchor.y - 80;
    const stepY = (endY - startY) / distData.length;
    
    const distractions = distData.map((data, i) => {
       const y = startY + stepY * i;
       const body = Bodies.rectangle(width / 2, y, data.w, 20, { isStatic: true, label: 'distraction', render: { visible: false } });
       return { ...data, body, y };
    });
    physicsDistractionsRef.current = distractions;

    // --- WALLS ---
    const ground = Bodies.rectangle(width / 2, height + 10, width * 2, 20, { isStatic: true, label: 'wall' });
    const wallLeft = Bodies.rectangle(-10, height / 2, 20, height * 2, { isStatic: true, label: 'wall' });
    const wallRight = Bodies.rectangle(width + 10, height / 2, 20, height * 2, { isStatic: true, label: 'wall' });
    const ceiling = Bodies.rectangle(width / 2, -10, width * 2, 20, { isStatic: true, label: 'wall' });

    World.add(world, [lampBody, lampConstraint, projectile, slingConstraint, ground, wallLeft, wallRight, ceiling, ...distractions.map(d => d.body)]);

    // --- MOUSE CONTROL ---
    const mouse = Mouse.create(sceneRef.current);
    const mouseConstraint = MouseConstraint.create(engine, { mouse: mouse, constraint: { stiffness: 0.2, render: { visible: false } } });
    World.add(world, mouseConstraint);

    // --- GAME STATE ---
    let isDragging = false;
    let isFired = false;
    let hitThisShot = false;
    let trailIndex = 0;
    
    const sparksState = Array.from({length: NUM_SPARKS}, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }));

    Events.on(mouseConstraint, 'startdrag', function(event) {
      if (!isOnRef.current) return; // Prevent drag during burnout
      if (event.body === projectile) {
        isDragging = true;
        if (soundOnRef.current) playSound('sawtooth', 50, 100, 0.5, 0.05);
      }
    });

    Events.on(mouseConstraint, 'enddrag', function(event) {
      if (!isOnRef.current) return;
      if (event.body === projectile && isDragging) {
        isDragging = false;
        const dist = Vector.magnitude(Vector.sub(slingAnchor, projectile.position));
        if (dist > 30) {
          isFired = true;
          hitThisShot = false;
          setShots(s => s + 1);
          if (soundOnRef.current) playSound('triangle', 300, 50, 0.3, 0.2);
        }
      }
    });

    Events.on(engine, 'beforeUpdate', function() {
      const misses = shotsRef.current - hitsRef.current;
      engine.world.gravity.y = 1 + Math.min(misses * 0.3, 2.5);

      const isZen = consecutiveHitsRef.current >= 3;
      
      distractions.forEach((d) => {
        d.body.isSensor = isZen || !isOnRef.current; // Distractions don't hit when burnout or zen
        if (!isZen && isOnRef.current) {
          Body.setPosition(d.body, { 
            x: width / 2 + Math.sin(engine.timing.timestamp * d.speed + d.offset) * d.range, 
            y: d.y 
          });
        }
      });

      if (isFired && slingConstraint.bodyB) {
        if (projectile.position.x > slingAnchor.x - 10 || projectile.position.y < slingAnchor.y - 10) {
          World.remove(world, slingConstraint);
          slingConstraint.bodyB = null; 
          
          setTimeout(() => {
            if (hitThisShot) {
              setConsecutiveHits(c => c + 1);
              setConsecutiveMisses(0);
            } else {
              setConsecutiveHits(0);
              const newMisses = consecutiveMissesRef.current + 1;
              setConsecutiveMisses(newMisses);
              if (newMisses >= 3 && isOnRef.current) {
                // Auto Burnout
                setIsOn(false);
                if (soundOnRef.current) playSound('square', 150, 40, 1.0, 0.3); // Power down
              }
            }
            hitThisShot = false;

            World.remove(world, projectile);
            projectile = Bodies.circle(slingAnchor.x, slingAnchor.y, projRadius, { restitution: 0.5, density: 0.05, label: 'projectile', isStatic: !isOnRef.current, render: { visible: false } });
            projBodyRef.current = projectile;
            slingConstraint = Constraint.create({ pointA: slingAnchor, bodyB: projectile, stiffness: 0.04, damping: 0.01, render: { visible: false } });
            World.add(world, [projectile, slingConstraint]);
            isFired = false;
          }, 2500);
        }
      }
    });

    Events.on(engine, 'collisionStart', function(event) {
      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const { bodyA, bodyB } = pairs[i];
        
        if ((bodyA.label === 'lamp' && bodyB.label === 'projectile') || (bodyB.label === 'lamp' && bodyA.label === 'projectile')) {
          if (!hitThisShot) {
            hitThisShot = true;
            setHits(h => h + 1);
            if (soundOnRef.current) playSound('sine', 600, 150, 0.8, 0.4);
            for(let j=0; j<NUM_SPARKS; j++) {
              sparksState[j] = {
                x: lampBody.position.x, y: lampBody.position.y + 20,
                vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20,
                life: 1.0
              };
            }
          }
        } 
        else if ((bodyA.label === 'distraction' && bodyB.label === 'projectile') || (bodyB.label === 'distraction' && bodyA.label === 'projectile')) {
          if (soundOnRef.current) playSound('sawtooth', 100, 40, 0.2, 0.1);
        }
        else if ((bodyA.label === 'wall' && bodyB.label === 'projectile') || (bodyB.label === 'wall' && bodyA.label === 'projectile')) {
          if (soundOnRef.current) playSound('triangle', 200, 100, 0.1, 0.05);
        }
      }
    });

    const renderLoop = () => {
      Engine.update(engine, 1000 / 60);

      const px = projectile.position.x;
      const py = projectile.position.y;
      const isZen = consecutiveHitsRef.current >= 3;

      if (lampRef.current && lightRef.current && stringRef.current) {
        const lx = lampBody.position.x;
        const ly = lampBody.position.y;
        lampRef.current.style.transform = `translate(${lx - lampRadius}px, ${ly - lampRadius}px)`;
        
        if (isOnRef.current) {
           lightRef.current.style.transform = `translate(${lx - 400}px, ${ly - 400}px)`;
           lightRef.current.style.opacity = isZen ? '1' : '0.8';
        } else {
           lightRef.current.style.opacity = '0';
        }

        const dx = lx - lampAnchor.x;
        const dy = ly - lampAnchor.y;
        stringRef.current.style.width = `${Math.sqrt(dx * dx + dy * dy)}px`;
        stringRef.current.style.transform = `translate(${lampAnchor.x}px, ${lampAnchor.y}px) rotate(${Math.atan2(dy, dx)}rad)`;
      }

      if (projectileRef.current) {
        projectileRef.current.style.transform = `translate(${px - projRadius}px, ${py - projRadius}px)`;

        if (isFired) {
          const t = trailsRef.current[trailIndex];
          if (t) {
            t.style.transform = `translate(${px - projRadius}px, ${py - projRadius}px) scale(1)`;
            t.style.opacity = '0.5';
            setTimeout(() => { if(t) t.style.opacity = '0'; }, 300);
          }
          trailIndex = (trailIndex + 1) % NUM_TRAILS;
        }

        if (slingConstraint.bodyB && slingString1Ref.current && slingString2Ref.current) {
           const setStr = (el: HTMLDivElement, ax: number, ay: number) => {
             const dx = px - ax, dy = py - ay;
             el.style.width = `${Math.sqrt(dx*dx + dy*dy)}px`;
             el.style.transform = `translate(${ax}px, ${ay}px) rotate(${Math.atan2(dy, dx)}rad)`;
             el.style.opacity = '1';
           };
           setStr(slingString1Ref.current, slingAnchor.x - 20, slingAnchor.y);
           setStr(slingString2Ref.current, slingAnchor.x + 20, slingAnchor.y);
        } else {
           if(slingString1Ref.current) slingString1Ref.current.style.opacity = '0';
           if(slingString2Ref.current) slingString2Ref.current.style.opacity = '0';
        }
      }

      physicsDistractionsRef.current.forEach((d, i) => {
        const el = distRefs.current[i];
        if (el) {
          el.style.transform = `translate(${d.body.position.x - d.w / 2}px, ${d.y - 10}px)`;
          el.style.opacity = (isZen || !isOnRef.current) ? '0' : '1';
        }
      });

      sparksState.forEach((spark, i) => {
        if (spark.life > 0) {
          spark.x += spark.vx; spark.y += spark.vy; spark.vy += 0.5; spark.life -= 0.02;
          if (sparksRef.current[i]) {
            sparksRef.current[i]!.style.transform = `translate(${spark.x}px, ${spark.y}px) scale(${spark.life})`;
            sparksRef.current[i]!.style.opacity = spark.life.toString();
          }
        } else if (sparksRef.current[i]) sparksRef.current[i]!.style.opacity = '0';
      });

      requestAnimationFrame(renderLoop);
    };
    renderLoop();

    return () => Engine.clear(engine);
  }, []);

  const isZen = consecutiveHits >= 3;
  const misses = shots - hits;
  
  let titleText = "The journey is long.";
  let subtitleText = "Drag the slingshot to make your first attempt.";

  if (isZen && isOn) {
    titleText = "Flow State Achieved.";
    subtitleText = "You are unstoppable. The dream is within reach.";
  } else if (!isOn) {
    titleText = "BURNOUT.";
    subtitleText = "It's okay to feel lost. Turn the light back on to try again.";
  } else if (hits > 0) {
    titleText = "The target is yours.";
    subtitleText = "Every drop of sweat was worth it. Never stop aiming.";
  } else if (shots === 1) {
    titleText = "Attempt 1: Reality hits hard.";
    subtitleText = "You stumbled. But failure is just feedback. Try again.";
  } else if (shots >= 2) {
    titleText = "Attempt 2: The pressure builds.";
    subtitleText = "Gravity feels heavier now. But you are a fighter. Shoot again.";
  }

  return (
    <div ref={sceneRef} style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: isZen ? 'rgba(10, 31, 28, 0.4)' : (isOn ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.8)'), transition: 'background-color 1s ease' }}>
      <style>{`
        @keyframes heartbeat { 0% { transform: scale(1); } 15% { transform: scale(1.08); } 30% { transform: scale(1); } 45% { transform: scale(1.04); } 60% { transform: scale(1); } 100% { transform: scale(1); } }
        @keyframes glitch { 0% { transform: translate(0) } 20% { transform: translate(-2px, 1px) } 40% { transform: translate(-1px, -1px) } 60% { transform: translate(2px, 1px) } 80% { transform: translate(1px, -1px) } 100% { transform: translate(0) } }
      `}</style>
      
      <div ref={lightRef} style={{ position: 'absolute', top: 0, left: 0, width: 800, height: 800, background: isZen ? 'radial-gradient(circle, rgba(255,215,0,0.25) 0%, transparent 60%)' : 'radial-gradient(circle, rgba(0,255,135,0.2) 0%, rgba(96,239,255,0.1) 40%, transparent 70%)', pointerEvents: 'none', transition: 'opacity 0.2s ease, background 1s ease', willChange: 'transform' }} />
      <div ref={stringRef} style={{ position: 'absolute', top: 0, left: 0, height: 2, background: 'rgba(255,255,255,0.2)', transformOrigin: '0 50%', pointerEvents: 'none' }} />
      
      {distData.map((d, i) => (
        <div key={`dist-${i}`} ref={el => distRefs.current[i] = el} className="distraction-item" style={{ position: 'absolute', top: 0, left: 0, width: d.w, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff5555', fontSize: 11, fontWeight: 'bold', pointerEvents: 'none', transition: 'opacity 0.5s', zIndex: 4, letterSpacing: 1 }}>
          {d.text}
        </div>
      ))}

      <div ref={lampRef} style={{ position: 'absolute', top: 0, left: 0, width: 80, height: 80, pointerEvents: 'none', zIndex: 5 }}>
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: isOn ? (isZen ? '#ffd700' : '#fff') : '#333', boxShadow: isOn ? (isZen ? '0 0 50px 15px rgba(255,215,0,0.6)' : '0 0 40px 10px rgba(0,255,135,0.4)') : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOn ? '#000' : '#888', fontWeight: '900', fontSize: '10px', textAlign: 'center', lineHeight: 1.1, animation: isOn ? 'heartbeat 1.5s infinite' : 'none', transition: 'all 0.5s ease' }}>
          THE<br/>DREAM
        </div>
      </div>

      {Array.from({ length: NUM_TRAILS }).map((_, i) => (
        <div key={`trail-${i}`} ref={el => trailsRef.current[i] = el} style={{ position: 'absolute', top: 0, left: 0, width: 30, height: 30, borderRadius: '50%', background: isZen ? '#ffd700' : '#00ff87', opacity: 0, pointerEvents: 'none', transition: 'opacity 0.3s ease', zIndex: 3 }} />
      ))}
      {Array.from({ length: NUM_SPARKS }).map((_, i) => (
        <div key={`spark-${i}`} ref={el => sparksRef.current[i] = el} style={{ position: 'absolute', top: 0, left: 0, width: 6, height: 6, borderRadius: '50%', background: isZen ? '#fff' : '#00ff87', opacity: 0, pointerEvents: 'none', zIndex: 6, boxShadow: '0 0 10px #fff' }} />
      ))}

      <div ref={slingString1Ref} style={{ position: 'absolute', top: 0, left: 0, height: 2, background: 'rgba(255,255,255,0.4)', transformOrigin: '0 50%', pointerEvents: 'none' }} />
      <div ref={slingString2Ref} style={{ position: 'absolute', top: 0, left: 0, height: 2, background: 'rgba(255,255,255,0.4)', transformOrigin: '0 50%', pointerEvents: 'none' }} />
      <div ref={projectileRef} style={{ position: 'absolute', top: 0, left: 0, width: 30, height: 30, borderRadius: '50%', background: isZen ? '#ffd700' : '#00ff87', boxShadow: isZen ? '0 0 20px rgba(255,215,0,0.8)' : '0 0 15px rgba(0,255,135,0.5)', cursor: isOn ? 'grab' : 'default', zIndex: 5, transition: 'background 0.5s, box-shadow 0.5s', opacity: isOn ? 1 : 0.3 }} />
      
      <div style={{ position: 'absolute', left: 130, bottom: 50, width: 4, height: 100, background: '#444' }} />
      <div style={{ position: 'absolute', left: 170, bottom: 50, width: 4, height: 100, background: '#444' }} />

      <div className="glass-panel" style={{ position: 'absolute', top: 20, left: 20, fontSize: 13, color: 'rgba(255,255,255,0.7)', zIndex: 10, lineHeight: 1.6, minWidth: 160 }}>
        <div style={{ color: '#fff', fontWeight: 700, marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Timeline Stats</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Status</span> <span style={{ color: isOn ? '#00ff87' : '#ff5555', fontWeight: 600 }}>{isOn ? 'IN PROGRESS' : 'BURNOUT'}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Gravity</span> <span style={{ color: '#fff' }}>{(1 + Math.min(misses * 0.3, 2.5)).toFixed(1)}G</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Attempts</span> <span style={{ color: '#fff' }}>{shots}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Success</span> <span style={{ color: '#fff' }}>{hits}</span></div>
      </div>

      <div style={{ position: 'absolute', top: 20, right: 40, zIndex: 10 }}>
        <button className="interactive-btn" onClick={() => setSoundOn(!soundOn)} style={{ color: soundOn ? (isZen ? '#ffd700' : '#00ff87') : 'rgba(255,255,255,0.5)' }}>
          Sound: {soundOn ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="glass-panel" style={{ position: 'absolute', top: '50%', right: 40, transform: 'translateY(-50%)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 15, padding: '20px 15px' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: 700, letterSpacing: 1 }}>FOCUS</span>
        <button onClick={handleSwitch} style={{ width: 44, height: 88, background: isOn ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.5)', border: `2px solid ${isOn ? '#fff' : '#444'}`, borderRadius: 22, cursor: 'pointer', position: 'relative', transition: 'all 0.3s ease', boxShadow: isOn ? '0 0 15px rgba(255,255,255,0.2)' : 'none' }}>
          <div style={{ position: 'absolute', left: 4, right: 4, height: 34, background: isOn ? '#fff' : '#444', borderRadius: 17, top: isOn ? 4 : 46, transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)', boxShadow: isOn ? '0 0 10px rgba(255,255,255,0.8)' : 'none' }} />
        </button>
      </div>

      <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', width: '100%', pointerEvents: 'none', opacity: isOn ? 1 : 0.6 }}>
        <div style={{ animation: !isOn ? 'glitch 0.3s infinite' : 'none', display: 'inline-block' }}>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '5rem', fontWeight: 800, margin: 0, color: isZen ? '#ffd700' : '#fff', letterSpacing: '-2px', textShadow: isOn ? (isZen ? '0 10px 40px rgba(255,215,0,0.6)' : '0 10px 30px rgba(0,255,135,0.4)') : 'none', transition: 'all 0.5s ease' }}>
            {titleText}
          </h1>
          <p style={{ marginTop: 10, color: isZen ? 'rgba(255,215,0,0.8)' : 'rgba(255,255,255,0.7)', fontSize: '1.2rem', transition: 'all 0.5s ease', fontWeight: 400 }}>
            {subtitleText}
          </p>
        </div>
      </div>

      <div className="glass-panel" style={{ position: 'absolute', bottom: 20, right: 20, fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'right' }}>
        <div style={{ fontWeight: 700, color: '#fff', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>The Journey</div>
        <div style={{ color: isZen ? '#ffd700' : '#00ff87', fontWeight: 600 }}>{isZen ? 'ZEN MODE ACTIVE' : 'Physics Engine Active'}</div>
      </div>
    </div>
  );
}
