import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Activity,
  Cloud,
  Database,
  Gauge,
  Network,
  Server,
} from 'lucide-react';

const FLOATING = [
  { Icon: Activity, label: 'Traces', className: 'apm-float-a', color: '#0891b2' },
  { Icon: Server, label: 'Services', className: 'apm-float-b', color: '#0e7490' },
  { Icon: Database, label: 'Datastores', className: 'apm-float-c', color: '#155e75' },
  { Icon: Cloud, label: 'Cloud', className: 'apm-float-d', color: '#0284c7' },
  { Icon: Gauge, label: 'Latency', className: 'apm-float-e', color: '#0d9488' },
  { Icon: Network, label: 'Topology', className: 'apm-float-f', color: '#0369a1' },
];

const IDLE_TILT = {
  rotateX: 12,
  rotateY: -18,
  translateX: 0,
  translateY: 0,
  scale: 1,
  glareX: 32,
  glareY: 26,
  shadowX: -10,
  shadowY: 24,
};

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

type Tilt = typeof IDLE_TILT;

function MonitoringModel({ transform }: { transform: Tilt }) {
  return (
    <div
      className="apm-model-scene"
      style={
        {
          '--model-rotate-x': `${transform.rotateX}deg`,
          '--model-rotate-y': `${transform.rotateY}deg`,
          '--model-translate-x': `${transform.translateX}px`,
          '--model-translate-y': `${transform.translateY}px`,
          '--model-scale': transform.scale,
          '--model-shadow-x': `${transform.shadowX}px`,
          '--model-shadow-y': `${transform.shadowY}px`,
        } as CSSProperties
      }
    >
      <div className="apm-model-pivot">
        <svg className="apm-model" viewBox="0 0 320 300" aria-hidden="true">
          <defs>
            <linearGradient id="apmCubeTop" x1="40" y1="40" x2="280" y2="120" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#a5f3fc" />
              <stop offset="55%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#0e7490" />
            </linearGradient>
            <linearGradient id="apmCubeLeft" x1="40" y1="100" x2="160" y2="280" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#155e75" />
            </linearGradient>
            <linearGradient id="apmCubeRight" x1="160" y1="100" x2="280" y2="280" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#0f766e" />
            </linearGradient>
            <radialGradient
              id="apmModelGlare"
              cx={`${transform.glareX}%`}
              cy={`${transform.glareY}%`}
              r="48%"
            >
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <filter id="apmModelShadow" x="-40%" y="-30%" width="180%" height="170%">
              <feDropShadow
                dx={transform.shadowX * 0.2}
                dy={Math.max(12, transform.shadowY * 0.4)}
                stdDeviation="14"
                floodColor="#0c4a6e"
                floodOpacity="0.35"
              />
            </filter>
          </defs>

          {/* Isometric monitoring cube */}
          <g filter="url(#apmModelShadow)">
            <path fill="url(#apmCubeTop)" d="M160 48 L268 108 L160 168 L52 108 Z" />
            <path fill="url(#apmCubeLeft)" d="M52 108 L160 168 L160 268 L52 208 Z" />
            <path fill="url(#apmCubeRight)" d="M160 168 L268 108 L268 208 L160 268 Z" />
            <path fill="url(#apmModelGlare)" d="M160 48 L268 108 L160 168 L52 108 Z" opacity="0.85" />
          </g>

          {/* Trace / telemetry surface on top face */}
          <g className="apm-model-traces" strokeLinecap="round" fill="none">
            <path d="M92 118 C120 108 140 122 160 112 C180 102 200 118 228 108" stroke="#ecfeff" strokeWidth="2.2" opacity="0.9" />
            <path className="apm-trace-pulse" d="M92 118 C120 108 140 122 160 112 C180 102 200 118 228 108" stroke="#ffffff" strokeWidth="1.4" />
            <circle cx="92" cy="118" r="4" fill="#ecfeff" />
            <circle cx="160" cy="112" r="5" fill="#ffffff" />
            <circle cx="228" cy="108" r="4" fill="#a5f3fc" />
          </g>

          {/* Side metric bars */}
          <g opacity="0.85">
            <rect x="78" y="150" width="10" height="36" rx="2" fill="#a5f3fc" opacity="0.55" />
            <rect x="94" y="138" width="10" height="48" rx="2" fill="#67e8f9" opacity="0.7" />
            <rect x="110" y="144" width="10" height="42" rx="2" fill="#22d3ee" opacity="0.65" />
            <rect x="200" y="142" width="10" height="44" rx="2" fill="#5eead4" opacity="0.6" />
            <rect x="216" y="132" width="10" height="54" rx="2" fill="#2dd4bf" opacity="0.75" />
            <rect x="232" y="148" width="10" height="38" rx="2" fill="#14b8a6" opacity="0.55" />
          </g>
        </svg>
        <div className="apm-model-floor" />
      </div>
    </div>
  );
}

export function AuthVisual() {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const targetRef = useRef(IDLE_TILT);
  const currentRef = useRef(IDLE_TILT);
  const trackingRef = useRef(false);
  const [tilt, setTilt] = useState(IDLE_TILT);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    let active = true;
    function tick() {
      if (!active) return;
      const current = currentRef.current;
      const target = targetRef.current;
      const amount = trackingRef.current ? 0.12 : 0.08;
      const next = {
        rotateX: lerp(current.rotateX, target.rotateX, amount),
        rotateY: lerp(current.rotateY, target.rotateY, amount),
        translateX: lerp(current.translateX, target.translateX, amount),
        translateY: lerp(current.translateY, target.translateY, amount),
        scale: lerp(current.scale, target.scale, amount),
        glareX: lerp(current.glareX, target.glareX, amount),
        glareY: lerp(current.glareY, target.glareY, amount),
        shadowX: lerp(current.shadowX, target.shadowX, amount),
        shadowY: lerp(current.shadowY, target.shadowY, amount),
      };
      currentRef.current = next;
      setTilt(next);
      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  function aimFromPointer(clientX: number, clientY: number) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const nx = x - 0.5;
    const ny = y - 0.5;
    targetRef.current = {
      rotateX: 8 - ny * 16,
      rotateY: -14 + nx * 22,
      translateX: nx * 10,
      translateY: ny * 6,
      scale: 1.03,
      glareX: 26 + x * 46,
      glareY: 20 + y * 42,
      shadowX: -nx * 16,
      shadowY: 20 + ny * 8,
    };
  }

  return (
    <aside className="apm-auth-visual" aria-hidden="true">
      <div className="apm-auth-visual-brand">
        <img src="/branding/crnet-apm-mark.png" alt="" className="apm-auth-visual-brand__mark" />
        <strong>CRNET APM</strong>
      </div>

      <div
        className={`apm-auth-visual-stage${tracking ? ' is-tracking' : ''}`}
        onPointerLeave={() => {
          trackingRef.current = false;
          setTracking(false);
          targetRef.current = IDLE_TILT;
        }}
        onPointerMove={(event) => {
          if (!trackingRef.current) {
            trackingRef.current = true;
            setTracking(true);
          }
          aimFromPointer(event.clientX, event.clientY);
        }}
        ref={stageRef}
      >
        <div className="apm-orb apm-orb-a" />
        <div className="apm-orb apm-orb-b" />
        <div className="apm-orb apm-orb-c" />

        {FLOATING.map(({ Icon, label, className, color }) => (
          <div key={label} className={`apm-icon-tile ${className}`} style={{ color }} title={label}>
            <Icon size={26} strokeWidth={2.1} aria-hidden />
          </div>
        ))}

        <div className="apm-hero-stack">
          <MonitoringModel transform={tilt} />
          <div
            className="apm-visual-card"
            style={{
              transform: `
                translate3d(${tilt.translateX * 0.25}px, ${tilt.translateY * 0.2}px, 0)
                rotateX(${tilt.rotateX * 0.15}deg)
                rotateY(${tilt.rotateY * 0.12}deg)
              `,
            }}
          >
            <div className="apm-visual-live">
              <b>LIVE</b>
              <span>12.4k spans / min</span>
            </div>
            <div className="apm-visual-card-top">
              <strong>42</strong>
              <span className="apm-visual-delta">ms p95</span>
            </div>
            <p>Latency across 128 services</p>
            <div className="apm-visual-bar" role="presentation">
              <i className="ok" />
              <i className="warn" />
              <i className="slow" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
