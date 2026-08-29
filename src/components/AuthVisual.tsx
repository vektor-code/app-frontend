import { useEffect, useState } from 'react';
import { Activity, Network, Percent } from 'lucide-react';
import { CloudraftMark } from './CloudraftMark';

const SPANS = [
  { name: 'POST /checkout', svc: 'gateway', left: '4%', width: '88%', ms: '42ms', tone: 'root' },
  { name: 'auth.verify', svc: 'identity', left: '8%', width: '14%', ms: '4ms', tone: 'ok' },
  { name: 'GET /cart', svc: 'cart-service', left: '16%', width: '46%', ms: '18ms', tone: 'ok' },
  { name: 'SELECT orders', svc: 'postgres', left: '30%', width: '32%', ms: '13ms', tone: 'slow' },
  { name: 'redis.mget', svc: 'cache', left: '18%', width: '11%', ms: '3ms', tone: 'ok' },
];

function useCountUp(target: number, duration = 900, delay = 0) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return undefined;
    }

    let frame = 0;
    const start = performance.now() + delay;

    function update(now: number) {
      if (now < start) {
        frame = requestAnimationFrame(update);
        return;
      }

      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(update);
    }

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [delay, duration, target]);

  return value;
}

function AnimatedNumber({ delay = 0, duration = 900, value }: { delay?: number; duration?: number; value: number }) {
  return useCountUp(value, duration, delay).toLocaleString();
}

function LatencyGraph() {
  return (
    <svg className="apm-auth-latency-graph" viewBox="0 0 280 96" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="apmAuthP95Fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4338ca" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#4338ca" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="apm-auth-latency-grid">
        <path d="M0 18 H280" />
        <path d="M0 36 H280" />
        <path d="M0 54 H280" />
        <path d="M0 72 H280" />
      </g>
      <path
        className="apm-auth-latency-fill"
        d="M0 58 C24 54 42 46 64 48 C92 51 110 28 138 32 C164 36 182 52 210 40 C236 30 258 34 280 24 L280 80 L0 80 Z"
        fill="url(#apmAuthP95Fill)"
      />
      <path
        className="apm-auth-latency-p95"
        d="M0 58 C24 54 42 46 64 48 C92 51 110 28 138 32 C164 36 182 52 210 40 C236 30 258 34 280 24"
      />
      <path
        className="apm-auth-latency-p50"
        d="M0 68 C28 66 46 62 70 63 C98 64 118 52 146 54 C172 56 196 61 224 56 C248 52 266 50 280 46"
      />
      <circle className="apm-auth-latency-pulse" r="3.2" fill="#4338ca">
        <animateMotion
          dur="5.4s"
          repeatCount="indefinite"
          rotate="auto"
          path="M0 58 C24 54 42 46 64 48 C92 51 110 28 138 32 C164 36 182 52 210 40 C236 30 258 34 280 24"
        />
      </circle>
    </svg>
  );
}

function ThroughputSpark() {
  return (
    <svg className="apm-auth-spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="apmAuthSparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4338ca" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#4338ca" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        className="apm-auth-spark-fill"
        d="M0 24 C12 22 18 16 28 18 C40 21 48 8 62 12 C74 16 82 26 94 18 C104 12 112 10 120 8 L120 36 L0 36 Z"
        fill="url(#apmAuthSparkFill)"
      />
      <path
        className="apm-auth-spark-line"
        d="M0 24 C12 22 18 16 28 18 C40 21 48 8 62 12 C74 16 82 26 94 18 C104 12 112 10 120 8"
      />
    </svg>
  );
}

export function AuthVisual() {
  return (
    <aside className="apm-auth-visual" aria-hidden="true">
      <div className="apm-auth-visual-brand">
        <CloudraftMark className="apm-auth-visual-brand__mark" title="Cloudraft" />
      </div>
      <div className="apm-auth-visual-grid" />
      <div className="apm-auth-product-stage">
        <section className="apm-auth-product-window">
          <header className="apm-auth-product-header">
            <div className="apm-auth-product-heading">
              <span className="apm-auth-product-heading-icon">
                <Activity size={14} strokeWidth={1.7} />
              </span>
              <div>
                <span>Trace explorer</span>
                <small>Last 15 minutes</small>
              </div>
            </div>
            <div className="apm-auth-live-status">
              <i />
              Live
            </div>
          </header>

          <div className="apm-auth-exposure-panel">
            <div className="apm-auth-exposure-score">
              <span>P95 LATENCY</span>
              <strong>
                <AnimatedNumber delay={160} value={42} />
                <em>ms</em>
              </strong>
              <small>11% faster this week</small>
            </div>
            <div className="apm-auth-latency-wrap">
              <div className="apm-auth-latency-legend">
                <span><i /> p95</span>
                <span><i /> p50</span>
              </div>
              <LatencyGraph />
              <div className="apm-auth-latency-axis">
                <span>-15m</span>
                <span>-10m</span>
                <span>-5m</span>
                <span>now</span>
              </div>
            </div>
          </div>

          <div className="apm-auth-kpi-grid">
            <div>
              <span className="apm-auth-kpi-icon is-accent">
                <Activity size={14} strokeWidth={1.7} />
              </span>
              <strong>
                12.4k
              </strong>
              <small>spans / min</small>
            </div>
            <div>
              <span className="apm-auth-kpi-icon is-neutral">
                <Network size={14} strokeWidth={1.7} />
              </span>
              <strong>
                <AnimatedNumber delay={440} value={128} />
              </strong>
              <small>services</small>
            </div>
            <div>
              <span className="apm-auth-kpi-icon is-critical">
                <Percent size={14} strokeWidth={1.7} />
              </span>
              <strong>0.08%</strong>
              <small>error rate</small>
            </div>
          </div>

          <div className="apm-auth-risk-queue">
            <div className="apm-auth-risk-queue-header">
              <strong>Trace waterfall</strong>
              <span>checkout-api · 42ms</span>
            </div>
            {SPANS.map((span, index) => (
              <div
                className="apm-auth-span-row"
                key={span.name}
                style={{ animationDelay: `${680 + index * 90}ms` }}
              >
                <div>
                  <strong>{span.name}</strong>
                  <small>{span.svc}</small>
                </div>
                <div className="apm-auth-span-track">
                  <i
                    className={span.tone}
                    style={{ left: span.left, width: span.width, animationDelay: `${780 + index * 90}ms` }}
                  />
                </div>
                <em>{span.ms}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="apm-auth-context-card">
          <header>
            <span>
              <Network size={11} strokeWidth={1.7} />
              Service map
            </span>
            <i />
          </header>
          <svg className="apm-auth-context-graph" viewBox="0 0 190 78">
            <g className="apm-auth-context-links">
              <path d="M28 20 78 39" />
              <path d="M28 58 78 39" />
              <path d="M78 39 132 18" />
              <path d="M78 39 132 39" />
              <path d="M78 39 132 60" />
            </g>
            <g className="apm-auth-context-nodes">
              <circle cx="28" cy="20" r="6" />
              <circle cx="28" cy="58" r="6" />
              <circle className="is-active" cx="78" cy="39" r="8" />
              <circle cx="132" cy="18" r="5" />
              <circle cx="132" cy="39" r="5" />
              <circle cx="132" cy="60" r="5" />
            </g>
            <g className="apm-auth-topo-labels">
              <text x="28" y="11">web</text>
              <text x="28" y="73">mobile</text>
              <text x="78" y="28">api</text>
              <text x="158" y="21">db</text>
              <text x="158" y="42">cache</text>
              <text x="158" y="63">queue</text>
            </g>
          </svg>
          <div>
            <strong>
              <AnimatedNumber delay={420} duration={1200} value={128} />
            </strong>
            <small>services connected</small>
          </div>
        </section>

        <section className="apm-auth-fix-card">
          <div>
            <small>Throughput</small>
            <strong>12.4k spans / min</strong>
          </div>
          <ThroughputSpark />
        </section>
      </div>
    </aside>
  );
}
