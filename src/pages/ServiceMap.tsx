import React, { useState, useEffect, useRef } from 'react';
import { api, type ServiceMapData, type ServiceStats, type Span, connectLiveStream } from '../api/client';

interface ServiceMapProps {
  namespace: string;
}

interface Particle {
  id: string;
  source: string;
  target: string;
  startTime: number;
  duration: number;
  isError: boolean;
}

export default function ServiceMap({ namespace }: ServiceMapProps) {
  const [data, setData] = useState<ServiceMapData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });

  // Refs for tracking real-time particles and cached span mappings
  const particlesRef = useRef<Particle[]>([]);
  const spanServiceCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    api.getServiceMap(namespace).then(setData).catch(() => {});
  }, [namespace]);

  // Handle incoming live spans from the WebSocket connection
  const onSpanReceived = (span: Span) => {
    // 1. Cache the span ID to service name
    spanServiceCache.current.set(span.spanId, span.serviceName);
    if (spanServiceCache.current.size > 1500) {
      const firstKey = spanServiceCache.current.keys().next().value;
      if (firstKey) spanServiceCache.current.delete(firstKey);
    }

    // 2. Resolve the source (caller) of this trace span
    let source = '';
    if (!span.parentSpanId || span.parentSpanId === '0000000000000000' || span.parentSpanId === '0') {
      if (span.kind === 'SERVER') {
        source = 'Internet';
      }
    } else {
      source = spanServiceCache.current.get(span.parentSpanId) || '';
    }

    // Fallback heuristic for internal requests where parent span isn't in cache yet
    if (!source && span.kind === 'SERVER') {
      if (span.serviceName === 'gateway-backend') {
        source = 'Internet';
      } else {
        source = 'gateway-backend'; // Most internal backends are called by the API gateway
      }
    }

    const target = span.serviceName;

    // 3. Trigger a dynamic particle if the call is external or inter-service
    if (source && target && source !== target) {
      particlesRef.current.push({
        id: Math.random().toString(36).slice(2),
        source,
        target,
        startTime: performance.now(),
        duration: 1000, // Travel time in ms
        isError: span.status === 'ERROR',
      });
    }

    // 4. Update the nodes stats in real-time so stats table/cards increment dynamically
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map(node => {
          if (node.serviceName === target) {
            const reqs = node.requestCount + 1;
            const errs = node.errorCount + (span.status === 'ERROR' ? 1 : 0);
            return {
              ...node,
              requestCount: reqs,
              errorCount: errs,
              errorRate: (errs / reqs) * 100,
              p50Ms: (node.p50Ms * node.requestCount + span.durationMs) / reqs,
            };
          }
          if (source === 'Internet' && node.serviceName === 'Internet') {
            const reqs = node.requestCount + 1;
            const errs = node.errorCount + (span.status === 'ERROR' ? 1 : 0);
            return {
              ...node,
              requestCount: reqs,
              errorCount: errs,
              errorRate: (errs / reqs) * 100,
            };
          }
          return node;
        }),
      };
    });
  };

  // Setup WebSocket connection for live telemetry streaming
  useEffect(() => {
    const disconnect = connectLiveStream(
      namespace || undefined,
      onSpanReceived
    );
    return () => disconnect();
  }, [namespace, data]); // Rebind websocket if namespace changes or data is initialized

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      const { width, height } = dimensions;
      canvas.width = width * 2;
      canvas.height = height * 2;
      ctx.scale(2, 2);

      ctx.clearRect(0, 0, width, height);

      const isDark = document.body.classList.contains('dark-theme');

      // Background
      ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      // Grid
      ctx.strokeStyle = isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(226, 232, 240, 0.8)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      const nodes = data.nodes || [];
      const edges = data.edges || [];
      if (nodes.length === 0) return;

      // --- DAG Layered Layout Algorithm (Cycle-Safe BFS) ---
      const positions = new Map<string, { x: number; y: number }>();
      const depthMap = new Map<string, number>();
      const adj = new Map<string, string[]>();
      const inDegree = new Map<string, number>();

      nodes.forEach(n => {
        adj.set(n.serviceName, []);
        inDegree.set(n.serviceName, 0);
      });

      edges.forEach(e => {
        if (adj.has(e.source) && adj.has(e.target)) {
          adj.get(e.source)!.push(e.target);
          inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
        }
      });

      const visited = new Set<string>();
      const queue: { node: string; depth: number }[] = [];

      nodes.forEach(n => {
        if (n.serviceName === 'Internet' || (inDegree.get(n.serviceName) || 0) === 0) {
          queue.push({ node: n.serviceName, depth: 0 });
          depthMap.set(n.serviceName, 0);
          visited.add(n.serviceName);
        }
      });

      if (queue.length === 0 && nodes.length > 0) {
        queue.push({ node: nodes[0].serviceName, depth: 0 });
        depthMap.set(nodes[0].serviceName, 0);
        visited.add(nodes[0].serviceName);
      }

      let head = 0;
      while (head < queue.length) {
        const { node: u, depth: uDepth } = queue[head++];
        const neighbors = adj.get(u) || [];
        neighbors.forEach(v => {
          if (!visited.has(v)) {
            visited.add(v);
            depthMap.set(v, uDepth + 1);
            queue.push({ node: v, depth: uDepth + 1 });
          } else {
            const currentDepth = depthMap.get(v) || 0;
            if (uDepth + 1 > currentDepth && uDepth + 1 < nodes.length) {
              depthMap.set(v, uDepth + 1);
            }
          }
        });
      }

      let maxDepth = 0;
      depthMap.forEach(d => {
        if (d > maxDepth) maxDepth = d;
      });

      const layers = new Map<number, string[]>();
      for (let d = 0; d <= maxDepth; d++) {
        layers.set(d, []);
      }
      nodes.forEach(n => {
        const d = depthMap.get(n.serviceName) || 0;
        if (!layers.has(d)) {
          layers.set(d, []);
        }
        layers.get(d)!.push(n.serviceName);
      });

      // Compute coordinate mappings (Left-to-Right layout)
      const padX = 110;
      const padY = 65;
      const cols = maxDepth + 1;

      for (let d = 0; d <= maxDepth; d++) {
        const layerNodes = layers.get(d) || [];
        const colX = cols > 1 ? padX + d * (width - 2 * padX) / (cols - 1) : width / 2;
        const rows = layerNodes.length;

        layerNodes.forEach((nodeName, r) => {
          const rowY = rows > 1 ? padY + r * (height - 2 * padY) / (rows - 1) : height / 2;
          positions.set(nodeName, { x: colX, y: rowY });
        });
      }

      const outgoingTotalDuration = new Map<string, number>();
      edges.forEach(e => {
        const current = outgoingTotalDuration.get(e.source) || 0;
        outgoingTotalDuration.set(e.source, current + e.avgDurationMs);
      });

      const getBezierPoint = (t: number, x1: number, y1: number, cp1x: number, cp1y: number, cp2x: number, cp2y: number, x2: number, y2: number) => {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        const x = mt3 * x1 + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * x2;
        const y = mt3 * y1 + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * y2;

        const dx = 3 * mt2 * (cp1x - x1) + 6 * mt * t * (cp2x - cp1x) + 3 * t2 * (x2 - cp2x);
        const dy = 3 * mt2 * (cp1y - y1) + 6 * mt * t * (cp2y - cp1y) + 3 * t2 * (x2 - cp2y);
        const angle = Math.atan2(dy, dx);

        return { x, y, angle };
      };

      // --- Draw Ambient Edges ---
      edges.forEach(edge => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return;

        const totalDuration = outgoingTotalDuration.get(edge.source) || 0;
        const contributionPercent = totalDuration > 0 ? (edge.avgDurationMs / totalDuration) * 100 : 0;

        const isError = edge.errorCount > 0;
        const isCritical = contributionPercent > 50 && edge.avgDurationMs > 50;

        let x1, y1, x2, y2;
        let cp1x, cp1y, cp2x, cp2y;

        if (to.x > from.x) {
          x1 = from.x + 75;
          y1 = from.y;
          x2 = to.x - 75;
          y2 = to.y;

          const dx = x2 - x1;
          cp1x = x1 + dx * 0.45;
          cp1y = y1;
          cp2x = x2 - dx * 0.45;
          cp2y = y2;
        } else {
          x1 = from.x;
          y1 = from.y - 25;
          x2 = to.x;
          y2 = to.y - 25;

          cp1x = x1 + 40;
          cp1y = y1 - 60;
          cp2x = x2 - 40;
          cp2y = y2 - 60;
        }

        ctx.strokeStyle = isError 
          ? 'rgba(244, 63, 94, 0.45)' 
          : isCritical ? 'rgba(245, 158, 11, 0.6)' : 'rgba(99, 102, 241, 0.35)';
        
        ctx.lineWidth = Math.min(8, 1.5 + (contributionPercent / 100) * 4 + (isCritical ? 2 : 0));

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
        ctx.stroke();

        const midPoint = getBezierPoint(0.5, x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2);
        const arrowLen = 9;

        ctx.beginPath();
        ctx.moveTo(midPoint.x + arrowLen * Math.cos(midPoint.angle - Math.PI / 6), midPoint.y + arrowLen * Math.sin(midPoint.angle - Math.PI / 6));
        ctx.lineTo(midPoint.x, midPoint.y);
        ctx.lineTo(midPoint.x + arrowLen * Math.cos(midPoint.angle + Math.PI / 6), midPoint.y + arrowLen * Math.sin(midPoint.angle + Math.PI / 6));
        ctx.strokeStyle = isError ? 'rgba(244, 63, 94, 0.75)' : isCritical ? 'rgba(245, 158, 11, 0.85)' : 'rgba(99, 102, 241, 0.65)';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        const badgeText1 = `${edge.callCount} calls`;
        const badgeText2 = `${edge.avgDurationMs.toFixed(1)}ms (${contributionPercent.toFixed(0)}%)`;
        
        ctx.font = '700 9px Inter';
        const textWidth = Math.max(ctx.measureText(badgeText1).width, ctx.measureText(badgeText2).width);
        const badgeWidth = textWidth + 12;
        const badgeHeight = 26;
        const bx = midPoint.x - badgeWidth / 2;
        const by = midPoint.y - badgeHeight / 2 - 16; 

        ctx.fillStyle = isDark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = isError ? 'rgba(244, 63, 94, 0.65)' : isCritical ? 'rgba(245, 158, 11, 0.65)' : 'rgba(99, 102, 241, 0.45)';
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bx, by, badgeWidth, badgeHeight, 4);
        } else {
          ctx.rect(bx, by, badgeWidth, badgeHeight);
        }
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
        ctx.textAlign = 'center';
        ctx.fillText(badgeText1, midPoint.x, by + 10);
        
        ctx.fillStyle = isError ? '#f43f5e' : isCritical ? '#f59e0b' : (isDark ? '#94a3b8' : '#475569');
        ctx.fillText(badgeText2, midPoint.x, by + 21);
      });

      // --- Draw Active Real-Time Particles (Actual Request Flows) ---
      const now = performance.now();
      particlesRef.current = particlesRef.current.filter(particle => {
        const from = positions.get(particle.source);
        const to = positions.get(particle.target);
        if (!from || !to) return false;

        const progress = (now - particle.startTime) / particle.duration;
        if (progress >= 1) return false; // Particle arrived, remove it

        let x1, y1, x2, y2;
        let cp1x, cp1y, cp2x, cp2y;

        if (to.x > from.x) {
          x1 = from.x + 75;
          y1 = from.y;
          x2 = to.x - 75;
          y2 = to.y;

          const dx = x2 - x1;
          cp1x = x1 + dx * 0.45;
          cp1y = y1;
          cp2x = x2 - dx * 0.45;
          cp2y = y2;
        } else {
          x1 = from.x;
          y1 = from.y - 25;
          x2 = to.x;
          y2 = to.y - 25;

          cp1x = x1 + 40;
          cp1y = y1 - 60;
          cp2x = x2 - 40;
          cp2y = y2 - 60;
        }

        const pos = getBezierPoint(progress, x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2);
        
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, particle.isError ? 6.5 : 5, 0, Math.PI * 2);
        const color = particle.isError ? '#f43f5e' : '#10b981';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = particle.isError ? 12 : 8;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow

        return true;
      });

      // --- Draw Nodes (Microservice Cards) ---
      nodes.forEach(node => {
        const pos = positions.get(node.serviceName);
        if (!pos) return;

        const isInternet = node.serviceName === 'Internet';
        const hasErrors = node.errorCount > 0;
        const errRate = node.errorRate;
        const reqCount = node.requestCount;

        const w = 150;
        const h = 50;
        const rx = pos.x - w / 2;
        const ry = pos.y - h / 2;

        ctx.save();
        const pulse = 1 + 0.05 * Math.sin(Date.now() * 0.005);
        const glowRadius = 85 * pulse;

        const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowRadius);
        if (isInternet) {
          gradient.addColorStop(0, 'rgba(56, 189, 248, 0.15)');
        } else {
          gradient.addColorStop(0, hasErrors ? 'rgba(244, 63, 94, 0.15)' : 'rgba(99, 102, 241, 0.12)');
        }
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = hasErrors ? 12 : 6;
        ctx.shadowColor = isInternet 
          ? 'rgba(56, 189, 248, 0.4)' 
          : hasErrors ? 'rgba(244, 63, 94, 0.4)' : 'rgba(99, 102, 241, 0.3)';

        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = isInternet 
          ? '#38bdf8' 
          : hasErrors ? '#f43f5e' : (isDark ? '#475569' : '#cbd5e1');
        ctx.lineWidth = hasErrors ? 2.5 : 1.5;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(rx, ry, w, h, 8);
        } else {
          ctx.rect(rx, ry, w, h);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.font = '700 11px Inter';
        ctx.textAlign = 'left';
        ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
        let displayName = node.serviceName;
        if (displayName.length > 18) displayName = displayName.slice(0, 16) + '...';
        ctx.fillText(displayName, rx + 12, ry + 20);

        ctx.font = '500 10px JetBrains Mono';
        ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
        
        let statsText = `${reqCount} reqs`;
        if (errRate > 0) {
          statsText += ` · ${errRate.toFixed(1)}% err`;
        }
        
        ctx.fillStyle = errRate > 5 ? '#f43f5e' : (isDark ? '#94a3b8' : '#64748b');
        ctx.fillText(statsText, rx + 12, ry + 36);

        ctx.beginPath();
        ctx.arc(rx + w - 12, ry + 12, 4, 0, Math.PI * 2);
        ctx.fillStyle = isInternet 
          ? '#38bdf8' 
          : hasErrors ? '#f43f5e' : '#10b981';
        ctx.fill();
      });

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [data, dimensions]);

  useEffect(() => {
    const handleResize = () => {
      const w = Math.max(600, window.innerWidth - 340);
      setDimensions({ width: w, height: 600 });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
      <h1 className="page-title">Service Map</h1>
      <p className="page-subtitle">
        {namespace ? `Service dependencies in ${namespace}` : 'Service dependencies across all namespaces'}
      </p>

      <div className="card">
        <div className="card-header">
          <div className="card-title">🕸️ Service Topology</div>
          <span className="text-sm text-muted">{data?.nodes?.length || 0} services</span>
        </div>
        <div className="card-body" ref={containerRef} style={{ padding: 0 }}>
          <canvas
            ref={canvasRef}
            style={{ width: dimensions.width, height: dimensions.height, display: 'block' }}
          />
        </div>
      </div>

      {data && data.nodes && data.nodes.length > 0 && (
        <div className="card mt-6">
          <div className="card-header">
            <div className="card-title">📊 Service Details</div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Namespace</th>
                  <th>Requests</th>
                  <th>Errors</th>
                  <th>Error Rate</th>
                  <th>P50</th>
                  <th>P95</th>
                  <th>P99</th>
                </tr>
              </thead>
              <tbody>
                {data.nodes.map(node => (
                  <tr key={node.serviceName}>
                    <td style={{ fontWeight: 600 }}>{node.serviceName}</td>
                    <td><span className="badge badge-ns">{node.namespace}</span></td>
                    <td className="mono">{node.requestCount}</td>
                    <td className="mono" style={{ color: node.errorCount > 0 ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>{node.errorCount}</td>
                    <td className="mono" style={{ color: node.errorRate > 5 ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>{node.errorRate.toFixed(1)}%</td>
                    <td className="mono">{node.p50Ms.toFixed(1)}ms</td>
                    <td className="mono">{node.p95Ms.toFixed(1)}ms</td>
                    <td className="mono">{node.p99Ms.toFixed(1)}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(!data || !data.nodes || data.nodes.length === 0) && (
        <div className="card mt-4">
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-state-icon">🕸️</div>
              <div className="empty-state-title">No services discovered</div>
              <div className="empty-state-text">Service map will populate as traces flow through your cluster</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
