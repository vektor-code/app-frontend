import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  operationName: string;
  traceIdShort: string;
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.15;
const NODE_W = 150;
const NODE_H = 50;

export default function ServiceMap({ namespace }: ServiceMapProps) {
  const [data, setData] = useState<ServiceMapData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });

  // Interaction state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Refs for interaction tracking
  const isPanningRef = useRef(false);
  const isDraggingNodeRef = useRef<string | null>(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const layoutComputedForRef = useRef<Set<string>>(new Set());

  // Refs for zoom/pan used inside render loop without re-triggering effect
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // Refs for tracking real-time particles and cached span mappings
  const particlesRef = useRef<Particle[]>([]);
  const spanServiceCache = useRef<Map<string, string>>(new Map());
  const spanNameCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    api.getServiceMap(namespace).then(setData).catch(() => {});
  }, [namespace]);

  // Convert screen coordinates to world coordinates
  const screenToWorld = useCallback((sx: number, sy: number) => {
    return {
      x: (sx - panRef.current.x) / zoomRef.current,
      y: (sy - panRef.current.y) / zoomRef.current,
    };
  }, []);

  // Find which node (if any) is under world coordinates
  const hitTestNode = useCallback((wx: number, wy: number): string | null => {
    for (const [name, pos] of nodePositionsRef.current.entries()) {
      const rx = pos.x - NODE_W / 2;
      const ry = pos.y - NODE_H / 2;
      if (wx >= rx && wx <= rx + NODE_W && wy >= ry && wy <= ry + NODE_H) {
        return name;
      }
    }
    return null;
  }, []);

  // Handle incoming live spans from the WebSocket connection
  const onSpanReceived = useCallback((span: Span) => {
    // 1. Cache the span ID to service name and operation name
    spanServiceCache.current.set(span.spanId, span.serviceName);
    spanNameCache.current.set(span.spanId, span.name);
    if (spanServiceCache.current.size > 1500) {
      const firstKey = spanServiceCache.current.keys().next().value;
      if (firstKey) {
        spanServiceCache.current.delete(firstKey);
        spanNameCache.current.delete(firstKey);
      }
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
        source = 'gateway-backend';
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
        duration: 1000,
        isError: span.status === 'ERROR',
        operationName: span.name || 'unknown',
        traceIdShort: span.traceId ? span.traceId.slice(0, 8) : '',
      });
    }

    // 4. Update the nodes stats in real-time
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
  }, []);

  // Setup WebSocket connection for live telemetry streaming
  useEffect(() => {
    const disconnect = connectLiveStream(
      namespace || undefined,
      onSpanReceived
    );
    return () => disconnect();
  }, [namespace, data, onSpanReceived]);

  // --- Mouse Event Handlers ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasPos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom(prev => {
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev + delta));
        const scale = newZoom / prev;
        // Zoom towards mouse cursor
        setPan(p => ({
          x: pos.x - (pos.x - p.x) * scale,
          y: pos.y - (pos.y - p.y) * scale,
        }));
        return newZoom;
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const world = screenToWorld(pos.x, pos.y);
      const hitNode = hitTestNode(world.x, world.y);

      lastMouseRef.current = pos;

      if (hitNode) {
        isDraggingNodeRef.current = hitNode;
        canvas.style.cursor = 'grabbing';
      } else {
        isPanningRef.current = true;
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const dx = pos.x - lastMouseRef.current.x;
      const dy = pos.y - lastMouseRef.current.y;
      lastMouseRef.current = pos;

      if (isDraggingNodeRef.current) {
        const nodeName = isDraggingNodeRef.current;
        const currentPos = nodePositionsRef.current.get(nodeName);
        if (currentPos) {
          nodePositionsRef.current.set(nodeName, {
            x: currentPos.x + dx / zoomRef.current,
            y: currentPos.y + dy / zoomRef.current,
          });
        }
      } else if (isPanningRef.current) {
        setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      } else {
        // Update cursor based on hover
        const world = screenToWorld(pos.x, pos.y);
        const hitNode = hitTestNode(world.x, world.y);
        canvas.style.cursor = hitNode ? 'grab' : 'default';
      }
    };

    const handleMouseUp = () => {
      isPanningRef.current = false;
      isDraggingNodeRef.current = null;
      canvas.style.cursor = 'default';
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [screenToWorld, hitTestNode]);

  // --- Canvas Render Loop ---
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      const { width, height } = dimensions;
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      canvas.width = width * 2;
      canvas.height = height * 2;
      ctx.scale(2, 2);

      ctx.clearRect(0, 0, width, height);

      const isDark = document.body.classList.contains('dark-theme');

      // Background (drawn in screen space, before transform)
      ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      // Apply zoom and pan transforms
      ctx.save();
      ctx.translate(currentPan.x, currentPan.y);
      ctx.scale(currentZoom, currentZoom);

      // Grid (in world space so it scales with zoom)
      ctx.strokeStyle = isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(226, 232, 240, 0.8)';
      ctx.lineWidth = 0.5 / currentZoom;
      const gridSize = 40;
      const worldLeft = -currentPan.x / currentZoom;
      const worldTop = -currentPan.y / currentZoom;
      const worldRight = (width - currentPan.x) / currentZoom;
      const worldBottom = (height - currentPan.y) / currentZoom;
      const gridStartX = Math.floor(worldLeft / gridSize) * gridSize;
      const gridStartY = Math.floor(worldTop / gridSize) * gridSize;

      for (let x = gridStartX; x <= worldRight; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, worldTop); ctx.lineTo(x, worldBottom); ctx.stroke();
      }
      for (let y = gridStartY; y <= worldBottom; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(worldLeft, y); ctx.lineTo(worldRight, y); ctx.stroke();
      }

      const nodes = data.nodes || [];
      const edges = data.edges || [];
      if (nodes.length === 0) {
        ctx.restore();
        animationId = requestAnimationFrame(render);
        return;
      }

      // --- DAG Layered Layout Algorithm (Cycle-Safe BFS) ---
      // Only compute layout for nodes that don't already have positions
      const needsLayout = nodes.some(n => !nodePositionsRef.current.has(n.serviceName));

      if (needsLayout) {
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
          if (!layers.has(d)) layers.set(d, []);
          layers.get(d)!.push(n.serviceName);
        });

        const padX = 110;
        const padY = 65;
        const cols = maxDepth + 1;

        for (let d = 0; d <= maxDepth; d++) {
          const layerNodes = layers.get(d) || [];
          const colX = cols > 1 ? padX + d * (width - 2 * padX) / (cols - 1) : width / 2;
          const rows = layerNodes.length;

          layerNodes.forEach((nodeName, r) => {
            // Only set position if we don't already have one for this node
            if (!nodePositionsRef.current.has(nodeName)) {
              const rowY = rows > 1 ? padY + r * (height - 2 * padY) / (rows - 1) : height / 2;
              nodePositionsRef.current.set(nodeName, { x: colX, y: rowY });
              layoutComputedForRef.current.add(nodeName);
            }
          });
        }
      }

      // Use the ref positions for rendering
      const positions = nodePositionsRef.current;

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

      const getEdgeCurve = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        let x1: number, y1: number, x2: number, y2: number;
        let cp1x: number, cp1y: number, cp2x: number, cp2y: number;

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

        return { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 };
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

        const { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 } = getEdgeCurve(from, to);

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
        if (progress >= 1) return false;

        const { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 } = getEdgeCurve(from, to);
        const pos = getBezierPoint(progress, x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2);

        // Glowing dot
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, particle.isError ? 6.5 : 5, 0, Math.PI * 2);
        const color = particle.isError ? '#f43f5e' : '#10b981';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = particle.isError ? 12 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Floating operation label
        if (particle.operationName) {
          const labelText = particle.operationName.length > 24
            ? particle.operationName.slice(0, 22) + '…'
            : particle.operationName;

          ctx.font = '600 8px Inter';
          const tw = ctx.measureText(labelText).width;
          const lx = pos.x - tw / 2 - 4;
          const ly = pos.y - 16;
          const lw = tw + 8;
          const lh = 14;

          // Label background pill
          ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(lx, ly, lw, lh, 3);
          } else {
            ctx.rect(lx, ly, lw, lh);
          }
          ctx.fill();

          // Label border
          ctx.strokeStyle = particle.isError
            ? 'rgba(244, 63, 94, 0.5)'
            : 'rgba(16, 185, 129, 0.5)';
          ctx.lineWidth = 0.5;
          ctx.stroke();

          // Label text
          ctx.fillStyle = particle.isError
            ? '#fb7185'
            : (isDark ? '#6ee7b7' : '#059669');
          ctx.textAlign = 'center';
          ctx.fillText(labelText, pos.x, ly + 10);

          // Trace ID micro-label
          if (particle.traceIdShort) {
            ctx.font = '500 6px JetBrains Mono';
            ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.6)';
            ctx.fillText(particle.traceIdShort, pos.x, ly + lh + 8);
          }
        }

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

        const w = NODE_W;
        const h = NODE_H;
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

      // Restore the canvas transform
      ctx.restore();

      // --- Zoom level indicator (screen space, drawn after restore) ---
      const zoomPercent = Math.round(currentZoom * 100);
      ctx.font = '500 10px JetBrains Mono';
      ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(`${zoomPercent}%`, 12, height - 10);

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [data, dimensions]);

  // --- Window resize handler ---
  useEffect(() => {
    const handleResize = () => {
      const w = Math.max(600, window.innerWidth - 340);
      setDimensions({ width: w, height: 600 });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Zoom Control Handlers ---
  const handleZoomIn = () => {
    setZoom(prev => {
      const newZoom = Math.min(ZOOM_MAX, prev + ZOOM_STEP);
      const cx = dimensions.width / 2;
      const cy = dimensions.height / 2;
      const scale = newZoom / prev;
      setPan(p => ({
        x: cx - (cx - p.x) * scale,
        y: cy - (cy - p.y) * scale,
      }));
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    setZoom(prev => {
      const newZoom = Math.max(ZOOM_MIN, prev - ZOOM_STEP);
      const cx = dimensions.width / 2;
      const cy = dimensions.height / 2;
      const scale = newZoom / prev;
      setPan(p => ({
        x: cx - (cx - p.x) * scale,
        y: cy - (cy - p.y) * scale,
      }));
      return newZoom;
    });
  };

  const handleFitView = () => {
    if (!data || !data.nodes || data.nodes.length === 0) return;
    const positions = nodePositionsRef.current;
    if (positions.size === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positions.forEach(pos => {
      minX = Math.min(minX, pos.x - NODE_W / 2);
      minY = Math.min(minY, pos.y - NODE_H / 2);
      maxX = Math.max(maxX, pos.x + NODE_W / 2);
      maxY = Math.max(maxY, pos.y + NODE_H / 2);
    });

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const padding = 60;
    const scaleX = (dimensions.width - padding * 2) / contentW;
    const scaleY = (dimensions.height - padding * 2) / contentH;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(scaleX, scaleY)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(newZoom);
    setPan({
      x: dimensions.width / 2 - centerX * newZoom,
      y: dimensions.height / 2 - centerY * newZoom,
    });
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
      <h1 className="page-title">Service Map</h1>
      <p className="page-subtitle">
        {namespace ? `Service dependencies in ${namespace}` : 'Service dependencies across all namespaces'}
      </p>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Service Topology</div>
          <span className="text-sm text-muted">{data?.nodes?.length || 0} services</span>
        </div>
        <div className="card-body" ref={containerRef} style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            style={{ width: dimensions.width, height: dimensions.height, display: 'block' }}
          />

          {/* Floating Zoom Controls */}
          <div style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            zIndex: 10,
          }}>
            {[
              { label: '+', title: 'Zoom In', handler: handleZoomIn },
              { label: '−', title: 'Zoom Out', handler: handleZoomOut },
              { label: '⊞', title: 'Fit View', handler: handleFitView },
              { label: '↺', title: 'Reset', handler: handleReset },
            ].map(btn => (
              <button
                key={btn.title}
                title={btn.title}
                onClick={btn.handler}
                style={{
                  width: 32,
                  height: 32,
                  border: 'none',
                  borderRadius: 8,
                  background: 'var(--bg-card, rgba(30, 41, 59, 0.85))',
                  color: 'var(--text-primary, #f1f5f9)',
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  lineHeight: 1,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.1)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(99,102,241,0.35)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
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
