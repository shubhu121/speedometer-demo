'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EngineAudio } from '@/lib/EngineAudio';
import { Volume2, VolumeX, Play, Pause, RotateCcw } from 'lucide-react';

interface SpeedometerGaugeProps {
  className?: string;
  speed?: number;
}

interface GearRatio {
  name: string;
  minSpeed: number;
  maxSpeed: number;
  shiftUpSpeed: number;
  shiftDownSpeed: number;
}

// Transmission configuration (realistic 6-speed sport ratio matching 0-320 km/h range)
const GEAR_RATIOS: GearRatio[] = [
  { name: 'N', minSpeed: 0, maxSpeed: 0, shiftUpSpeed: 1, shiftDownSpeed: 0 },
  { name: 'D1', minSpeed: 0, maxSpeed: 60, shiftUpSpeed: 58, shiftDownSpeed: 0 },
  { name: 'D2', minSpeed: 40, maxSpeed: 105, shiftUpSpeed: 102, shiftDownSpeed: 38 },
  { name: 'D3', minSpeed: 75, maxSpeed: 155, shiftUpSpeed: 152, shiftDownSpeed: 70 },
  { name: 'D4', minSpeed: 118, maxSpeed: 212, shiftUpSpeed: 208, shiftDownSpeed: 112 },
  { name: 'D5', minSpeed: 170, maxSpeed: 268, shiftUpSpeed: 264, shiftDownSpeed: 165 },
  { name: 'D6', minSpeed: 220, maxSpeed: 325, shiftUpSpeed: 325, shiftDownSpeed: 215 },
];

export default function SpeedometerGauge({ className = '', speed: externalSpeed }: SpeedometerGaugeProps) {
  // Vehicle Telemetry State
  const [speed, setSpeed] = useState<number>(externalSpeed ?? 0);
  const [rpm, setRpm] = useState<number>(850);
  const [gear, setGear] = useState<string>('N');
  const [isAccelerating, setIsAccelerating] = useState<boolean>(false);
  const [isBraking, setIsBraking] = useState<boolean>(false);
  const [isAutoPlay, setIsAutoPlay] = useState<boolean>(externalSpeed === undefined);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(true);

  // Engine Audio ref
  const audioRef = useRef<EngineAudio | null>(null);

  // Internal physics refs to avoid React state lag in animation frames
  const telemetry = useRef({
    speed: 0,
    rpm: 850,
    gear: 'N',
    gearIndex: 0, // 0 = N, 1 = D1, ..., 6 = D6
    targetSpeed: 0,
    shiftTimer: 0,
    isShifting: false,
    autoPhase: 'accel' as 'accel' | 'hold' | 'brake' | 'idle',
    autoPhaseTimer: 0,
  });

  // Initialize engine audio
  useEffect(() => {
    audioRef.current = new EngineAudio();
    return () => {
      // Audio cleanup on unmount
    };
  }, []);

  // Keyboard controls listener (Space/W/Up to throttle, S/Down to brake)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        setIsAutoPlay(false);
        setIsAccelerating(true);
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        setIsAutoPlay(false);
        setIsBraking(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        setIsAccelerating(false);
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        setIsBraking(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Main simulation physics loop
  useEffect(() => {
    let animationFrameId: number;
    let lastTimestamp = performance.now();

    const loop = (currentTimestamp: number) => {
      const dt = Math.min((currentTimestamp - lastTimestamp) / 1000, 0.1);
      lastTimestamp = currentTimestamp;

      const t = telemetry.current;

      // Determine throttle & brake inputs
      let throttle = 0;
      let brake = 0;

      if (isAutoPlay) {
        // Auto simulation matching the video: 0 -> 320 km/h run, brief top speed hold at ~300-320 km/h, brake to 0, idle pause, repeat
        if (t.autoPhase === 'accel') {
          throttle = 1.0;
          if (t.speed >= 305) {
            t.autoPhase = 'hold';
            t.autoPhaseTimer = 0;
          }
        } else if (t.autoPhase === 'hold') {
          throttle = 0.45;
          t.autoPhaseTimer += dt;
          if (t.autoPhaseTimer >= 2.5) {
            t.autoPhase = 'brake';
            t.autoPhaseTimer = 0;
          }
        } else if (t.autoPhase === 'brake') {
          brake = 0.95;
          throttle = 0;
          if (t.speed <= 0.5) {
            t.speed = 0;
            t.autoPhase = 'idle';
            t.autoPhaseTimer = 0;
          }
        } else if (t.autoPhase === 'idle') {
          throttle = 0;
          brake = 0;
          t.autoPhaseTimer += dt;
          if (t.autoPhaseTimer >= 1.5) {
            t.autoPhase = 'accel';
            t.autoPhaseTimer = 0;
          }
        }
      } else {
        if (isAccelerating) throttle = 1.0;
        if (isBraking) brake = 1.0;
      }

      // Transmission & RPM computation
      if (t.isShifting) {
        t.shiftTimer -= dt;
        if (t.shiftTimer <= 0) {
          t.isShifting = false;
        }
      }

      // Acceleration physics
      if (throttle > 0 && brake === 0) {
        // Power curve decreases slightly as aerodynamic drag builds at 280+ km/h
        const aeroDrag = Math.pow(t.speed / 320, 2) * 12;
        const baseAccel = (1 - (t.speed / 380) * 0.45) * 36;
        const effectiveAccel = Math.max(7, baseAccel - aeroDrag);

        t.speed = Math.min(320, t.speed + effectiveAccel * throttle * dt);

        // Automatic Upshift logic
        if (t.gearIndex === 0 && t.speed > 0.5) {
          t.gearIndex = 1;
          t.gear = 'D1';
        } else if (t.gearIndex >= 1 && t.gearIndex < 6) {
          const currentGearConfig = GEAR_RATIOS[t.gearIndex];
          if (t.speed >= currentGearConfig.shiftUpSpeed && !t.isShifting) {
            t.gearIndex += 1;
            t.gear = GEAR_RATIOS[t.gearIndex].name;
            t.isShifting = true;
            t.shiftTimer = 0.18; // quick dual-clutch shift
          }
        }
      } else if (brake > 0) {
        // Braking physics
        const brakeForce = 65 * brake;
        t.speed = Math.max(0, t.speed - brakeForce * dt);

        // Automatic Downshift logic
        if (t.gearIndex > 1) {
          const currentGearConfig = GEAR_RATIOS[t.gearIndex];
          if (t.speed < currentGearConfig.shiftDownSpeed && !t.isShifting) {
            t.gearIndex -= 1;
            t.gear = GEAR_RATIOS[t.gearIndex].name;
            t.isShifting = true;
            t.shiftTimer = 0.14;
          }
        } else if (t.gearIndex === 1 && t.speed <= 0.8) {
          t.gearIndex = 0;
          t.gear = 'N';
        }
      } else {
        // Natural rolling resistance and engine braking
        const coastDrag = 14 + (t.speed / 50) * 3;
        t.speed = Math.max(0, t.speed - coastDrag * dt);

        if (t.speed <= 0.5 && t.gearIndex === 1) {
          t.gearIndex = 0;
          t.gear = 'N';
        } else if (t.gearIndex > 1) {
          const currentGearConfig = GEAR_RATIOS[t.gearIndex];
          if (t.speed < currentGearConfig.shiftDownSpeed) {
            t.gearIndex -= 1;
            t.gear = GEAR_RATIOS[t.gearIndex].name;
          }
        }
      }

      // Calculate RPM corresponding to current gear and speed
      if (t.gearIndex === 0) {
        // Neutral idle + blip if throttled
        const targetRpm = throttle > 0 ? 5500 : 850;
        t.rpm += (targetRpm - t.rpm) * Math.min(dt * 8, 1);
      } else {
        const curGear = GEAR_RATIOS[t.gearIndex];
        const speedInGearRatio = (t.speed - curGear.minSpeed) / (curGear.maxSpeed - curGear.minSpeed);
        let baseRpm = 2200 + speedInGearRatio * 5600;

        if (t.isShifting) {
          // Clutch disengaged RPM drop
          baseRpm = Math.max(3800, baseRpm - 1600);
        }

        if (t.speed >= 360) {
          // Soft rev limiter vibration
          baseRpm = 7600 + Math.sin(currentTimestamp * 0.05) * 180;
        }

        const clampedRpm = Math.max(900, Math.min(8000, baseRpm));
        t.rpm += (clampedRpm - t.rpm) * Math.min(dt * 15, 1);
      }

      // Update Audio
      if (audioRef.current) {
        audioRef.current.update(t.rpm, throttle > 0);
      }

      // Sync React state for rendering
      setSpeed(t.speed);
      setRpm(t.rpm);
      setGear(t.gear);

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isAutoPlay, isAccelerating, isBraking]);

  // Audio mute toggle handler
  const handleToggleAudio = () => {
    if (audioRef.current) {
      const active = audioRef.current.toggleMute();
      setIsAudioMuted(!active);
    }
  };

  // Reset demo handler
  const handleReset = () => {
    telemetry.current.speed = 0;
    telemetry.current.rpm = 850;
    telemetry.current.gear = 'N';
    telemetry.current.gearIndex = 0;
    telemetry.current.autoPhase = 'accel';
    telemetry.current.autoPhaseTimer = 0;
    setSpeed(0);
    setRpm(850);
    setGear('N');
  };

  // Helper to calculate realistic RPM and gear matching any speed value
  const getTelemetryForSpeed = useCallback((spd: number) => {
    if (spd <= 0.8) {
      return { gear: 'N', gearIndex: 0, rpm: 850 };
    }
    let gearIdx = 1;
    for (let i = 1; i < GEAR_RATIOS.length; i++) {
      if (spd >= GEAR_RATIOS[i].minSpeed) {
        gearIdx = i;
      }
    }
    const curGear = GEAR_RATIOS[gearIdx];
    const range = Math.max(1, curGear.maxSpeed - curGear.minSpeed);
    const speedInGearRatio = Math.min(1, Math.max(0, (spd - curGear.minSpeed) / range));
    const calculatedRpm = 2200 + speedInGearRatio * 5600;
    return {
      gear: curGear.name,
      gearIndex: gearIdx,
      rpm: Math.max(900, Math.min(8000, calculatedRpm)),
    };
  }, []);

  // Manual speed adjustment (scrubber slider or direct change)
  const handleManualSpeedChange = (newSpeed: number) => {
    setIsAutoPlay(false);
    const { gear: g, gearIndex: gi, rpm: r } = getTelemetryForSpeed(newSpeed);
    telemetry.current.speed = newSpeed;
    telemetry.current.rpm = r;
    telemetry.current.gear = g;
    telemetry.current.gearIndex = gi;
    setSpeed(newSpeed);
    setRpm(r);
    setGear(g);
  };

  // Manual drive on press & hold gauge face
  const handlePointerDown = () => {
    setIsAutoPlay(false);
    setIsAccelerating(true);
    if (audioRef.current && isAudioMuted) {
      // Unmute on first intentional interaction if user desires
    }
  };

  const handlePointerUp = () => {
    setIsAccelerating(false);
  };

  // ===================== SVG GEOMETRY CALCULATIONS =====================
  const cx = 250;
  const cy = 250;
  const rDial = 215;
  const rTicks = 188;
  const rArc = 172;

  // Rounding helper to prevent SSR floating-point hydration mismatches
  const roundVal = (val: number) => Math.round(val * 100) / 100;

  // Derive effective telemetry if externally controlled or internally simulated
  const effectiveSpeed = externalSpeed !== undefined ? externalSpeed : speed;
  const effectiveTelemetry = externalSpeed !== undefined ? getTelemetryForSpeed(externalSpeed) : { gear, rpm };
  const effectiveRpm = effectiveTelemetry.rpm;

  // Speedometer 0 - 320 km/h:
  // Starts at 135 deg (bottom-left) and sweeps 270 deg clockwise to 405 deg (bottom-right)
  // 160 is at exactly 270 deg (top dead center / 12 o'clock, directly above RPM gauge)
  const speedToAngle = useCallback((s: number) => {
    const clamped = Math.max(0, Math.min(340, s));
    return roundVal(135 + (clamped / 320) * 270);
  }, []);

  const currentSpeedAngle = speedToAngle(effectiveSpeed);

  // Calculate SVG arc path for the illuminated green arc
  const createSpeedArcPath = useCallback(() => {
    const startAngle = 135;
    const endAngle = Math.max(135.05, currentSpeedAngle);
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const sx = roundVal(cx + rArc * Math.cos(startRad));
    const sy = roundVal(cy + rArc * Math.sin(startRad));
    const ex = roundVal(cx + rArc * Math.cos(endRad));
    const ey = roundVal(cy + rArc * Math.sin(endRad));

    const arcSweep = endAngle - startAngle;
    const largeArcFlag = arcSweep > 180 ? 1 : 0;

    return {
      path: `M ${sx} ${sy} A ${rArc} ${rArc} 0 ${largeArcFlag} 1 ${ex} ${ey}`,
      tipX: ex,
      tipY: ey,
    };
  }, [currentSpeedAngle]);

  const speedArc = createSpeedArcPath();

  // Major tick speeds: 0, 40, 80, 120, 160, 200, 240, 280, 320 (exactly matching original)
  const majorSpeeds = [0, 40, 80, 120, 160, 200, 240, 280, 320];

  // Minor ticks: every 10 km/h from 0 to 340
  const minorTicks = Array.from({ length: 35 }, (_, i) => i * 10);

  // ===================== MINI TACHOMETER CALCULATIONS =====================
  const cxRpm = 250;
  const cyRpm = 172;
  const rRpmTicks = 38;

  // Tachometer sweeps 240 deg from 150 deg (7:30) to 390 deg (4:30), with '4' at top (270 deg)
  const rpmToAngle = (val: number) => {
    const clamped = Math.max(0, Math.min(8000, val));
    return roundVal(150 + (clamped / 8000) * 240);
  };

  const currentRpmAngle = rpmToAngle(effectiveRpm);

  return (
    <div
      id="speedometer-component-container"
      className={`relative flex flex-col items-center justify-center select-none ${className}`}
    >
      {/* Gauge Cluster Frame */}
      <div
        id="gauge-interactive-stage"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="relative cursor-pointer touch-none flex items-center justify-center active:scale-[0.995] transition-transform duration-100"
        title="Click and hold to accelerate manually (or press Space / W / Up Arrow)"
      >
        <svg
          id="speedometer-svg"
          viewBox="0 0 500 500"
          className="w-[340px] h-[340px] sm:w-[460px] sm:h-[460px] md:w-[540px] md:h-[540px] drop-shadow-[0_24px_50px_rgba(0,0,0,0.85)]"
        >
          <defs>
            {/* Outer metallic bezel ring gradient */}
            <linearGradient id="bezelOuterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#414a45" />
              <stop offset="25%" stopColor="#252c28" />
              <stop offset="50%" stopColor="#1a201d" />
              <stop offset="75%" stopColor="#303833" />
              <stop offset="100%" stopColor="#171b18" />
            </linearGradient>

            {/* Inner rim subtle olive green rim gradient */}
            <linearGradient id="innerRimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2e3831" />
              <stop offset="100%" stopColor="#161c18" />
            </linearGradient>

            {/* Dial face matte texture */}
            <radialGradient id="dialFaceGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#151b18" />
              <stop offset="65%" stopColor="#0d1210" />
              <stop offset="100%" stopColor="#070a08" />
            </radialGradient>

            {/* Green glowing arc gradient */}
            <linearGradient id="speedArcGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#15803d" />
              <stop offset="45%" stopColor="#22c55e" />
              <stop offset="85%" stopColor="#4ade80" />
              <stop offset="100%" stopColor="#86efac" />
            </linearGradient>

            {/* Needle white gradient with subtle sheen */}
            <linearGradient id="needleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="70%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>

            {/* Needle center hub metal cap */}
            <radialGradient id="hubGrad" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#475569" />
              <stop offset="50%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#0f172a" />
            </radialGradient>

            {/* Xbox logo green badge gradient */}
            <radialGradient id="xboxBadgeGrad" cx="38%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="35%" stopColor="#16a34a" />
              <stop offset="80%" stopColor="#107c10" />
              <stop offset="100%" stopColor="#0a4608" />
            </radialGradient>

            {/* Arc tip radial glow filter */}
            <filter id="tipGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Drop shadow for needles */}
            <filter id="needleShadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="2" dy="5" stdDeviation="4" floodColor="#000000" floodOpacity="0.75" />
            </filter>
          </defs>

          {/* ================= 1. GAUGE BEZEL & CASING ================= */}
          {/* Outer metal rim */}
          <circle cx={cx} cy={cy} r={rDial + 24} fill="url(#bezelOuterGrad)" stroke="#111613" strokeWidth="2" />
          
          {/* Outer bevel ring */}
          <circle cx={cx} cy={cy} r={rDial + 18} fill="none" stroke="#525f57" strokeWidth="1" opacity="0.6" />
          <circle cx={cx} cy={cy} r={rDial + 12} fill="#181e1b" stroke="#0d110f" strokeWidth="1.5" />

          {/* Subtle olive green track ring */}
          <circle cx={cx} cy={cy} r={rDial + 5} fill="none" stroke="#2c3a30" strokeWidth="3" opacity="0.85" />
          <circle cx={cx} cy={cy} r={rDial} fill="url(#innerRimGrad)" stroke="#090d0b" strokeWidth="2" />

          {/* Main Dial Face */}
          <circle cx={cx} cy={cy} r={rDial - 4} fill="url(#dialFaceGrad)" />

          {/* Fine inner accent circle */}
          <circle cx={cx} cy={cy} r={rArc + 12} fill="none" stroke="#1f2823" strokeWidth="1" opacity="0.5" />

          {/* ================= 2. SPEED TICK MARKS & LABELS ================= */}
          {/* Minor tick marks */}
          {minorTicks.map((s) => {
            const isMajor = s % 40 === 0;
            const isMid = s % 20 === 0 && !isMajor;
            const angle = speedToAngle(s);
            const rad = (angle * Math.PI) / 180;

            const tickLen = isMajor ? 12 : isMid ? 8 : 5;
            const tickWidth = isMajor ? 2.5 : isMid ? 1.5 : 1;
            const tickColor = isMajor ? '#ffffff' : isMid ? '#94a3b8' : '#475569';

            const x1 = roundVal(cx + (rTicks - tickLen) * Math.cos(rad));
            const y1 = roundVal(cy + (rTicks - tickLen) * Math.sin(rad));
            const x2 = roundVal(cx + rTicks * Math.cos(rad));
            const y2 = roundVal(cy + rTicks * Math.sin(rad));

            return (
              <line
                key={`tick-${s}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={tickColor}
                strokeWidth={tickWidth}
                strokeLinecap="round"
                opacity={s > 320 && speed < 300 ? 0.45 : 0.9}
              />
            );
          })}

          {/* Major Numeric Labels (0, 40, 80, 120, 160, 200, 240, 280, 320, 360) */}
          {majorSpeeds.map((s) => {
            const angle = speedToAngle(s);
            const rad = (angle * Math.PI) / 180;
            const labelR = rTicks - 25;
            const lx = roundVal(cx + labelR * Math.cos(rad));
            const ly = roundVal(cy + labelR * Math.sin(rad));

            return (
              <text
                key={`label-${s}`}
                x={lx}
                y={ly}
                fill="#f1f5f9"
                fontSize="17"
                fontWeight="500"
                fontFamily="system-ui, -apple-system, sans-serif"
                textAnchor="middle"
                dominantBaseline="central"
                opacity={s > 320 && speed < 300 ? 0.5 : 0.95}
                className="transition-opacity duration-300"
              >
                {s}
              </text>
            );
          })}

          {/* ================= 3. MINI TACHOMETER (RPM DIAL) ================= */}
          <g id="mini-tachometer">
            {/* Redline outer sector arc (from ~6.2 to 8 x1000 RPM) */}
            {(() => {
              const startA = rpmToAngle(6200);
              const endA = rpmToAngle(8000);
              const startR = (startA * Math.PI) / 180;
              const endR = (endA * Math.PI) / 180;
              const arcRadius = rRpmTicks + 3;
              const x1 = roundVal(cxRpm + arcRadius * Math.cos(startR));
              const y1 = roundVal(cyRpm + arcRadius * Math.sin(startR));
              const x2 = roundVal(cxRpm + arcRadius * Math.cos(endR));
              const y2 = roundVal(cyRpm + arcRadius * Math.sin(endR));
              return (
                <path
                  d={`M ${x1} ${y1} A ${arcRadius} ${arcRadius} 0 0 1 ${x2} ${y2}`}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              );
            })()}

            {/* Half-tick intermediate marks (0.5 to 7.5) */}
            {[0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((val) => {
              const angle = rpmToAngle(val * 1000);
              const rad = (angle * Math.PI) / 180;
              const isRed = val >= 6.5;
              const x1 = roundVal(cxRpm + (rRpmTicks - 3) * Math.cos(rad));
              const y1 = roundVal(cyRpm + (rRpmTicks - 3) * Math.sin(rad));
              const x2 = roundVal(cxRpm + rRpmTicks * Math.cos(rad));
              const y2 = roundVal(cyRpm + rRpmTicks * Math.sin(rad));

              return (
                <line
                  key={`rpm-half-tick-${val}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isRed ? '#ef4444' : '#64748b'}
                  strokeWidth="0.8"
                />
              );
            })}

            {/* RPM Major ticks & Numeric labels (0 to 8) */}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((val) => {
              const angle = rpmToAngle(val * 1000);
              const rad = (angle * Math.PI) / 180;
              const isRed = val >= 7;
              const x1 = roundVal(cxRpm + (rRpmTicks - 5) * Math.cos(rad));
              const y1 = roundVal(cyRpm + (rRpmTicks - 5) * Math.sin(rad));
              const x2 = roundVal(cxRpm + rRpmTicks * Math.cos(rad));
              const y2 = roundVal(cyRpm + rRpmTicks * Math.sin(rad));

              const textR = rRpmTicks - 11;
              const tx = roundVal(cxRpm + textR * Math.cos(rad));
              const ty = roundVal(cyRpm + textR * Math.sin(rad));

              return (
                <React.Fragment key={`rpm-tick-${val}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isRed ? '#ef4444' : '#cbd5e1'}
                    strokeWidth="1.2"
                  />
                  <text
                    x={tx}
                    y={ty}
                    fill={isRed ? '#ef4444' : '#cbd5e1'}
                    fontSize="7"
                    fontWeight="600"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {val}
                  </text>
                </React.Fragment>
              );
            })}

            {/* "RPM" and "x 1000" labels */}
            <text
              x={cxRpm}
              y={cyRpm + 12}
              fill="#94a3b8"
              fontSize="6.5"
              fontWeight="600"
              letterSpacing="0.6"
              textAnchor="middle"
            >
              RPM
            </text>
            <text
              x={cxRpm}
              y={cyRpm + 19}
              fill="#64748b"
              fontSize="5"
              fontWeight="500"
              letterSpacing="0.3"
              textAnchor="middle"
            >
              x 1000
            </text>

            {/* Mini RPM Needle with smooth transition */}
            <g
              id="rpm-needle-assembly"
              transform={`rotate(${roundVal(currentRpmAngle)}, ${cxRpm}, ${cyRpm})`}
              style={{
                transform: `rotate(${roundVal(currentRpmAngle)}deg)`,
                transformOrigin: `${cxRpm}px ${cyRpm}px`,
                transformBox: 'view-box',
                transition: 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1)',
                willChange: 'transform',
              }}
              filter="url(#needleShadow)"
            >
              <polygon
                points={`${cxRpm - 5},${cyRpm - 0.8} ${cxRpm + 25},${cyRpm} ${cxRpm - 5},${cyRpm + 0.8}`}
                fill="#ffffff"
              />
              <circle cx={cxRpm} cy={cyRpm} r="3.2" fill="#151b18" stroke="#334155" strokeWidth="0.8" />
              <circle cx={cxRpm} cy={cyRpm} r="1.2" fill="#ffffff" />
            </g>
          </g>

          {/* ================= 4. ILLUMINATED GREEN ARC & TIP GLOW ================= */}
          {/* Subtle background track guide */}
          <path
            d={`M ${roundVal(cx + rArc * Math.cos((135 * Math.PI) / 180))} ${roundVal(cy + rArc * Math.sin((135 * Math.PI) / 180))} A ${rArc} ${rArc} 0 1 1 ${roundVal(cx + rArc * Math.cos((405 * Math.PI) / 180))} ${roundVal(cy + rArc * Math.sin((405 * Math.PI) / 180))}`}
            fill="none"
            stroke="#1c2520"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Active Glowing Arc */}
          {effectiveSpeed > 0.5 && (
            <>
              {/* Outer soft glow trail */}
              <path
                d={speedArc.path}
                fill="none"
                stroke="#22c55e"
                strokeWidth="7"
                strokeLinecap="round"
                opacity="0.35"
                filter="url(#tipGlow)"
              />
              {/* Core vibrant line */}
              <path
                d={speedArc.path}
                fill="none"
                stroke="url(#speedArcGrad)"
                strokeWidth="3.5"
                strokeLinecap="round"
              />

              {/* Dynamic glowing head orb at needle tip */}
              <g transform={`translate(${speedArc.tipX}, ${speedArc.tipY})`}>
                <circle cx="0" cy="0" r="18" fill="#4ade80" opacity="0.25" filter="url(#tipGlow)" />
                <circle cx="0" cy="0" r="8" fill="#86efac" opacity="0.75" filter="url(#tipGlow)" />
                <circle cx="0" cy="0" r="3.5" fill="#ffffff" />
              </g>
            </>
          )}

          {/* Zero speed indicator green dot/notch */}
          <circle
            cx={roundVal(cx + rArc * Math.cos((135 * Math.PI) / 180))}
            cy={roundVal(cy + rArc * Math.sin((135 * Math.PI) / 180))}
            r="2.5"
            fill="#22c55e"
            opacity="0.9"
          />

          {/* ================= 5. CENTER DIGITAL READOUT ================= */}
          {/* Large Digital Speed Readout */}
          <text
            id="digital-speed-display"
            x={cx}
            y={328}
            fill="#ffffff"
            fontSize="52"
            fontWeight="800"
            fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            textAnchor="middle"
            dominantBaseline="central"
            letterSpacing="-1.5"
          >
            {Math.round(effectiveSpeed)}
          </text>

          {/* Speed unit "km/h" positioned cleanly below digital readout */}
          <text
            x={cx}
            y={362}
            fill="#64748b"
            fontSize="11.5"
            fontWeight="600"
            fontFamily="system-ui, sans-serif"
            textAnchor="middle"
            letterSpacing="0.6"
          >
            km/h
          </text>

          {/* ================= 6. MAIN SPEEDOMETER NEEDLE ================= */}
          <g
            id="main-needle-assembly"
            transform={`rotate(${currentSpeedAngle}, ${cx}, ${cy})`}
            filter="url(#needleShadow)"
          >
            {/* White counter-balance stub extending backwards along -X */}
            <rect
              x={cx - 24}
              y={cy - 2.4}
              width="24"
              height="4.8"
              rx="1.5"
              fill="#ffffff"
            />

            {/* Needle tapered blade pointing along +X */}
            <polygon
              points={`
                ${cx},${cy - 2.3}
                ${cx + rTicks - 4},${cy}
                ${cx},${cy + 2.3}
              `}
              fill="url(#needleGrad)"
            />

            {/* Needle center ridge for 3D highlight */}
            <line
              x1={cx - 20}
              y1={cy}
              x2={cx + rTicks - 8}
              y2={cy}
              stroke="#ffffff"
              strokeWidth="0.8"
              opacity="0.9"
            />

            {/* Needle center hub cap matching authentic gauge */}
            <circle cx={cx} cy={cy} r="12" fill="#141a16" stroke="#252f28" strokeWidth="1.2" />
            <circle cx={cx} cy={cy} r="4.5" fill="#f8fafc" />
          </g>
        </svg>
      </div>

      {/* Minimal Unobtrusive Controls Bar (Centered below gauge, very subtle) */}
      <div
        id="minimal-controls-bar"
        className="mt-4 flex items-center justify-center gap-3 text-xs text-neutral-400 font-medium z-10"
      >
        {/* Play/Pause Auto-Demo */}
        <button
          id="toggle-auto-play-btn"
          onClick={() => setIsAutoPlay((prev) => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors ${
            isAutoPlay
              ? 'bg-neutral-900/80 border-neutral-700 text-neutral-200 hover:border-neutral-500'
              : 'bg-emerald-950/60 border-emerald-600/70 text-emerald-300'
          }`}
          title={isAutoPlay ? 'Switch to Manual Drive' : 'Resume Auto Demo Loop'}
        >
          {isAutoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isAutoPlay ? 'Auto Demo' : 'Manual Mode'}</span>
        </button>

        {/* Audio Mute/Unmute */}
        <button
          id="toggle-audio-btn"
          onClick={handleToggleAudio}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors ${
            isAudioMuted
              ? 'bg-neutral-900/80 border-neutral-700 text-neutral-400 hover:border-neutral-500'
              : 'bg-neutral-800 border-lime-500/60 text-lime-400'
          }`}
          title={isAudioMuted ? 'Unmute Sound' : 'Mute Sound'}
        >
          {isAudioMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span>{isAudioMuted ? 'Sound Off' : 'Sound On'}</span>
        </button>

        {/* Reset */}
        <button
          id="reset-speedometer-btn"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900/80 border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
          title="Reset to 0 km/h"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {/* Manual Speed Scrubber (Active in Manual Mode for interactive testing) */}
      {!isAutoPlay && (
        <div
          id="manual-speed-scrubber-container"
          className="mt-3 flex items-center gap-3 w-full max-w-[320px] px-3.5 py-1.5 rounded-xl bg-neutral-900/70 border border-neutral-800 text-xs text-neutral-300 z-10"
        >
          <span className="text-[11px] text-neutral-400 font-medium whitespace-nowrap min-w-[76px]">
            {Math.round(speed)} km/h
          </span>
          <input
            id="speed-scrubber-slider"
            type="range"
            min="0"
            max="320"
            step="1"
            value={Math.round(speed)}
            onChange={(e) => handleManualSpeedChange(Number(e.target.value))}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            aria-label="Adjust vehicle speed"
          />
        </div>
      )}
    </div>
  );
}
