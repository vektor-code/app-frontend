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
  rotateX: 18,
  rotateY: -28,
  translateX: 0,
  translateY: 0,
  scale: 1,
  glareX: 34,
  glareY: 28,
  shadowX: -12,
  shadowY: 28,
};

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

type Tilt = typeof IDLE_TILT;

function MonitoringModel({ transform, breathing }: { transform: Tilt; breathing: boolean }) {
  return (
    <div
      className={`apm-model-scene${breathing ? ' is-breathing' : ''}`}
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
        <div className="apm-crystal">
          <div className="apm-crystal-ring apm-crystal-ring--outer" />
          <div className="apm-crystal-ring apm-crystal-ring--inner" />

          <div className="apm-crystal-cube">
            <div className="apm-crystal-face apm-crystal-face--front">
              <span className="apm-face-bars">
                <i style={{ height: '42%' }} />
                <i style={{ height: '68%' }} />
                <i style={{ height: '54%' }} />
                <i style={{ height: '78%' }} />
                <i style={{ height: '48%' }} />
              </span>
            </div>
            <div className="apm-crystal-face apm-crystal-face--back" />
            <div className="apm-crystal-face apm-crystal-face--right">
              <span className="apm-face-wave" />
            </div>
            <div className="apm-crystal-face apm-crystal-face--left">
              <span className="apm-face-bars apm-face-bars--dense">
                <i style={{ height: '56%' }} />
                <i style={{ height: '38%' }} />
                <i style={{ height: '72%' }} />
                <i style={{ height: '46%' }} />
              </span>
            </div>
            <div className="apm-crystal-face apm-crystal-face--top">
              <svg className="apm-face-trace" viewBox="0 0 100 100" aria-hidden="true">
                <path
                  d="M12 62 C28 48 38 70 50 52 C62 34 72 58 88 44"
                  fill="none"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <path
                  className="apm-trace-pulse"
                  d="M12 62 C28 48 38 70 50 52 C62 34 72 58 88 44"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="62" r="3.2" fill="#ecfeff" />
                <circle cx="50" cy="52" r="4" fill="#fff" />
                <circle cx="88" cy="44" r="3.2" fill="#a5f3fc" />
              </svg>
            </div>
            <div className="apm-crystal-face apm-crystal-face--bottom" />
          </div>

          <div className="apm-crystal-core" />
          <div className="apm-crystal-nodes" aria-hidden="true">
            <span className="apm-node apm-node-a" />
            <span className="apm-node apm-node-b" />
            <span className="apm-node apm-node-c" />
            <span className="apm-node apm-node-d" />
          </div>
        </div>
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
  const startRef = useRef(performance.now());
  const [tilt, setTilt] = useState(IDLE_TILT);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    let active = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function tick(now: number) {
      if (!active) return;

      if (!trackingRef.current && !reduceMotion) {
        const t = (now - startRef.current) / 1000;
        // Idle breathing: gentle scale + yaw sway when the pointer is away.
        const breath = Math.sin(t * 0.9);
        const sway = Math.sin(t * 0.45);
        targetRef.current = {
          ...IDLE_TILT,
          rotateX: IDLE_TILT.rotateX + breath * 2.2,
          rotateY: IDLE_TILT.rotateY + sway * 10,
          translateY: breath * 6,
          scale: 1 + breath * 0.035,
          glareX: 34 + sway * 8,
          glareY: 28 + breath * 6,
          shadowY: 28 + breath * 4,
        };
      }

      const current = currentRef.current;
      const target = targetRef.current;
      const amount = trackingRef.current ? 0.14 : 0.06;
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
      rotateX: 12 - ny * 18,
      rotateY: -22 + nx * 28,
      translateX: nx * 12,
      translateY: ny * 8,
      scale: 1.06,
      glareX: 24 + x * 48,
      glareY: 18 + y * 44,
      shadowX: -nx * 18,
      shadowY: 22 + ny * 10,
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
          startRef.current = performance.now();
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
          <MonitoringModel transform={tilt} breathing={!tracking} />
          <div
            className="apm-visual-card"
            style={{
              transform: `
                translate3d(${tilt.translateX * 0.25}px, ${tilt.translateY * 0.2}px, 0)
                rotateX(${tilt.rotateX * 0.12}deg)
                rotateY(${tilt.rotateY * 0.1}deg)
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
