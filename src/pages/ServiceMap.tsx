import React, { useState, useEffect, useRef } from 'react';
import { api, type ServiceMapData } from '../api/client';

interface ServiceMapProps {
  namespace: string;
}

export default function ServiceMap({ namespace }: ServiceMapProps) {
  const [data, setData] = useState<ServiceMapData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 500 });

  useEffect(() => {
    api.getServiceMap(namespace).then(setData).catch(() => {});
  }, [namespace]);

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

      // --- DAG Layered Layout Algorithm ---
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

      // BFS Starting points: Internet node, or nodes with 0 incoming dependencies
      const queue: string[] = [];
      nodes.forEach(n => {
        if (n.serviceName === 'Internet' || (inDegree.get(n.serviceName) || 0) === 0) {
          depthMap.set(n.serviceName, 0);
          queue.push(n.serviceName);
        }
      });

      // Cycle fallback: start with everything
      if (queue.length === 0 && nodes.length > 0) {
        nodes.forEach(n => {
          depthMap.set(n.serviceName, 0);
          queue.push(n.serviceName);
        });
      }

      let head = 0;
      while (head < queue.length) {
        const u = queue[head++];
        const uDepth = depthMap.get(u) || 0;
        const neighbors = adj.get(u) || [];
        neighbors.forEach(v => {
          const vDepth = depthMap.get(v);
          if (vDepth === undefined || uDepth + 1 > vDepth) {
            depthMap.set(v, uDepth + 1);
            queue.push(v);
          }
        });
      }

      let maxDepth = 0;
      nodes.forEach(n => {
        const d = depthMap.get(n.serviceName) || 0;
        if (d > maxDepth) maxDepth = d;
      });

      // Group into layer columns
      const layers = new Map<number, string[]>();
      for (let d = 0; d <= maxDepth; d++) {
        layers.set(d, []);
      }
      nodes.forEach(n => {
        const d = depthMap.get(n.serviceName) || 0;
        layers.get(d)!.push(n.serviceName);
      });

      // Compute coordinate mappings (Left-to-Right layout)
      const padX = 90;
      const padY = 70;
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

      // Compute total outgoing duration for each source node to compute percentages
      const outgoingTotalDuration = new Map<string, number>();
      edges.forEach(e => {
        const current = outgoingTotalDuration.get(e.source) || 0;
        outgoingTotalDuration.set(e.source, current + e.avgDurationMs);
      });

      // --- Draw Edges & Flow Animation ---
      edges.forEach(edge => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return;

        // Path contribution percentage calculation
        const totalDuration = outgoingTotalDuration.get(edge.source) || 0;
        const contributionPercent = totalDuration > 0 ? (edge.avgDurationMs / totalDuration) * 100 : 0;

        // Visual properties based on errors and latency
        const isError = edge.errorCount > 0;
        const isCritical = contributionPercent > 50 && edge.avgDurationMs > 50; // Critical path indicator
        
        ctx.strokeStyle = isError 
          ? 'rgba(244, 63, 94, 0.45)' 
          : isCritical ? 'rgba(245, 158, 11, 0.6)' : 'rgba(99, 102, 241, 0.35)';
        
        // Thicker lines for critical path or higher contribution
        ctx.lineWidth = Math.min(8, 1.5 + (contributionPercent / 100) * 4 + (isCritical ? 2 : 0));

        // Edge Path
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        // Moving pulse dots (size proportional to contribution percentage)
        const timeScale = 0.0018;
        const flowProgress = (Date.now() * timeScale) % 1;
        const flowX = from.x + (to.x - from.x) * flowProgress;
        const flowY = from.y + (to.y - from.y) * flowProgress;

        const pulseRadius = Math.max(3.5, Math.min(10, 3.5 + (contributionPercent / 100) * 6));
        ctx.beginPath();
        ctx.arc(flowX, flowY, pulseRadius, 0, Math.PI * 2);
        
        let pulseColor = '#10b981';
        if (isError) pulseColor = '#f43f5e';
        else if (isCritical) pulseColor = '#f59e0b';
        
        ctx.fillStyle = pulseColor;
        ctx.shadowColor = pulseColor;
        ctx.shadowBlur = pulseRadius + 2;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow

        // Arrow tip at middle section
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowLen = 10;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;

        ctx.beginPath();
        ctx.moveTo(midX + arrowLen * Math.cos(angle - Math.PI / 6), midY + arrowLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(midX, midY);
        ctx.lineTo(midX + arrowLen * Math.cos(angle + Math.PI / 6), midY + arrowLen * Math.sin(angle + Math.PI / 6));
        ctx.strokeStyle = isError ? 'rgba(244, 63, 94, 0.75)' : isCritical ? 'rgba(245, 158, 11, 0.85)' : 'rgba(99, 102, 241, 0.65)';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Floating Call details badge with background
        const badgeText1 = `${edge.callCount} calls`;
        const badgeText2 = `${edge.avgDurationMs.toFixed(1)}ms (${contributionPercent.toFixed(0)}%)`;
        
        ctx.font = '700 9px Inter';
        const textWidth = Math.max(ctx.measureText(badgeText1).width, ctx.measureText(badgeText2).width);
        const badgeWidth = textWidth + 12;
        const badgeHeight = 26;
        const bx = midX - badgeWidth / 2;
        const by = midY - badgeHeight / 2 - 12; // Shift up slightly to clear the arrow head

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
        ctx.fillText(badgeText1, midX, by + 10);
        
        ctx.fillStyle = isError ? '#f43f5e' : isCritical ? '#f59e0b' : (isDark ? '#94a3b8' : '#475569');
        ctx.fillText(badgeText2, midX, by + 21);
      });

      // --- Draw Nodes ---
      nodes.forEach(node => {
        const pos = positions.get(node.serviceName);
        if (!pos) return;

        const isInternet = node.serviceName === 'Internet';
        const hasErrors = node.errorCount > 0;
        const nodeRadius = isInternet ? 24 : 20 + Math.min(12, node.requestCount * 0.15);

        // Core dynamic pulse ring
        const pulse = 1 + 0.08 * Math.sin(Date.now() * 0.005);
        const glowRadius = nodeRadius * 2 * pulse;

        const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowRadius);
        if (isInternet) {
          gradient.addColorStop(0, 'rgba(56, 189, 248, 0.2)');
        } else {
          gradient.addColorStop(0, hasErrors ? 'rgba(244, 63, 94, 0.2)' : 'rgba(99, 102, 241, 0.18)');
        }
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        if (isInternet) {
          // Beautiful Cloud representation for incoming Internet traffic
          ctx.beginPath();
          const r = nodeRadius * 0.8;
          ctx.arc(pos.x - r * 0.5, pos.y + r * 0.1, r * 0.6, 0.5 * Math.PI, 1.5 * Math.PI);
          ctx.arc(pos.x, pos.y - r * 0.4, r * 0.8, 1.0 * Math.PI, 2.0 * Math.PI);
          ctx.arc(pos.x + r * 0.5, pos.y + r * 0.1, r * 0.6, 1.5 * Math.PI, 0.5 * Math.PI);
          ctx.arc(pos.x, pos.y + r * 0.3, r * 0.8, 0, Math.PI);
          ctx.closePath();
          ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Icon character inside
          ctx.fillStyle = '#38bdf8';
          ctx.font = '14px Inter';
          ctx.fillText("☁", pos.x, pos.y + 4);
        } else {
          // Microservice Node representation
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
          ctx.fillStyle = hasErrors ? 'rgba(244, 63, 94, 0.25)' : 'rgba(99, 102, 241, 0.25)';
          ctx.fill();
          ctx.strokeStyle = hasErrors ? '#f43f5e' : '#6366f1';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Inside Text: Request counts
          ctx.fillStyle = hasErrors ? '#fb7185' : '#818cf8';
          ctx.font = '700 11px JetBrains Mono';
          ctx.fillText(String(node.requestCount), pos.x, pos.y + 4);
        }

        // Node Label
        ctx.fillStyle = isInternet ? '#38bdf8' : (isDark ? '#f1f5f9' : '#0f172a');
        ctx.font = '600 11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(node.serviceName, pos.x, pos.y + nodeRadius + 16);
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
      setDimensions({ width: w, height: 500 });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="animate-fade-in">
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
        <div className="card mt-4">
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
