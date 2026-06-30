import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Trace, type Span, type DiagnosticReport, isSpanError } from '../api/client';
import { createPortal } from 'react-dom';
import SpanTimeline, { getSpanDestination } from '../components/SpanTimeline';

const SERVICE_COLORS: Record<string, string> = {};
const PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 155) ? '#0f172a' : '#ffffff';
}

function getSvcColor(name: string): string {
  if (!SERVICE_COLORS[name]) {
    SERVICE_COLORS[name] = PALETTE[Object.keys(SERVICE_COLORS).length % PALETTE.length];
  }
  return SERVICE_COLORS[name];
}

// Convert numbers of ms into readable formats
function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface SpanNode {
  span: Span;
  depth: number;
  children: SpanNode[];
}

function buildSpanTree(spans: Span[]): { rootNodes: SpanNode[]; maxDepth: number } {
  const spanMap = new Map<string, SpanNode>();
  spans.forEach(s => {
    spanMap.set(s.spanId, { span: s, depth: 0, children: [] });
  });

  const rootNodes: SpanNode[] = [];
  let maxDepth = 0;

  spans.forEach(s => {
    const node = spanMap.get(s.spanId)!;
    if (s.parentSpanId && spanMap.has(s.parentSpanId)) {
      const parent = spanMap.get(s.parentSpanId)!;
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  function traverse(node: SpanNode, currentDepth: number) {
    node.depth = currentDepth;
    if (currentDepth > maxDepth) maxDepth = currentDepth;
    node.children.sort((a, b) => new Date(a.span.startTime).getTime() - new Date(b.span.startTime).getTime());
    node.children.forEach(child => traverse(child, currentDepth + 1));
  }

  rootNodes.forEach(rn => traverse(rn, 0));
  return { rootNodes, maxDepth };
}

function adjustColorBrightness(hex: string, percent: number): string {
  let hexVal = hex.replace('#', '');
  if (hexVal.length !== 6) return hex;
  
  let R = parseInt(hexVal.substring(0, 2), 16);
  let G = parseInt(hexVal.substring(2, 4), 16);
  let B = parseInt(hexVal.substring(4, 6), 16);

  R = Math.max(0, Math.min(255, R + percent));
  G = Math.max(0, Math.min(255, G + percent));
  B = Math.max(0, Math.min(255, B + percent));

  const rHex = R.toString(16).padStart(2, '0');
  const gHex = G.toString(16).padStart(2, '0');
  const bHex = B.toString(16).padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`;
}

interface FlameGraphProps {
  spans: Span[];
  traceStartTime: number;
  traceDuration: number;
  onSelectSpan: (span: Span) => void;
}

function FlameGraph({ spans, traceStartTime, traceDuration, onSelectSpan }: FlameGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredSpan, setHoveredSpan] = useState<{ span: Span; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [forceUpdate, setForceUpdate] = useState(0);

  // Search query state
  const [searchQuery, setSearchQuery] = useState('');

  // Zoom & Pan states
  const [viewStart, setViewStart] = useState(0); // 0 to 1
  const [viewEnd, setViewEnd] = useState(1);     // 0 to 1
  const [viewY, setViewY] = useState(0);         // vertical scroll in pixels
  const [orientation, setOrientation] = useState<'down' | 'up'>('down'); // down = icicle, up = flame

  // Refs for stale closures in canvas interaction listeners
  const viewStartRef = useRef(0);
  const viewEndRef = useRef(1);
  const viewYRef = useRef(0);
  const orientationRef = useRef<'down' | 'up'>('down');

  useEffect(() => { viewStartRef.current = viewStart; }, [viewStart]);
  useEffect(() => { viewEndRef.current = viewEnd; }, [viewEnd]);
  useEffect(() => { viewYRef.current = viewY; }, [viewY]);
  useEffect(() => { orientationRef.current = orientation; }, [orientation]);

  const { rootNodes, maxDepth } = useMemo(() => buildSpanTree(spans), [spans]);

  const barHeight = 24;
  const barGap = 4;

  // Fixed main viewport height for canvas rendering
  const canvasHeight = 460;

  // Minimap and Ruler coordinates
  const my = 10; // minimap Y start
  const mh = 20; // minimap height
  const mg = 15; // gap between minimap and rulers
  const paddingTop = my + mh + mg + 22; // Rulers padding (~67px)
  const paddingBottom = 15;

  const contentHeight = (maxDepth + 1) * (barHeight + barGap);
  const viewportHeight = canvasHeight - paddingTop - paddingBottom;
  const maxY = Math.max(0, contentHeight - viewportHeight);

  // Drag states
  const dragModeRef = useRef<'none' | 'left' | 'right' | 'pan' | 'graph-pan' | 'scrollbar-pan'>('none');
  const dragStartRef = useRef({
    x: 0,
    y: 0,
    viewStart: 0,
    viewEnd: 1,
    viewY: 0
  });

  const renderList = useMemo(() => {
    const list: { span: Span; depth: number; left: number; width: number }[] = [];
    function traverse(node: SpanNode) {
      const start = new Date(node.span.startTime).getTime();
      const left = traceDuration > 0 ? (start - traceStartTime) / traceDuration : 0;
      const width = traceDuration > 0 ? node.span.durationMs / traceDuration : 1;
      list.push({
        span: node.span,
        depth: node.depth,
        left,
        width
      });
      node.children.forEach(traverse);
    }
    rootNodes.forEach(traverse);
    return list;
  }, [rootNodes, traceStartTime, traceDuration]);

  // Main Canvas Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = canvasHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, canvasHeight);

    const isDark = document.body.classList.contains('dark-theme');

    // 1. Draw Minimap Box
    ctx.save();
    ctx.fillStyle = isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(241, 245, 249, 0.6)';
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(0, my, rect.width, mh, 4);
    } else {
      ctx.rect(0, my, rect.width, mh);
    }
    ctx.fill();
    ctx.stroke();

    // Render micro-spans inside minimap
    renderList.forEach(item => {
      const mx = item.left * rect.width;
      const mw = Math.max(1, item.width * rect.width);
      const mDepthOffset = my + 2 + (item.depth / (maxDepth + 1)) * (mh - 4);
      ctx.fillStyle = getSvcColor(item.span.serviceName) + '35'; // semi-transparent
      ctx.fillRect(mx, mDepthOffset, mw, 1.2);
    });
    ctx.restore();

    // Draw Minimap Viewport Window Overlay
    const vx = viewStart * rect.width;
    const vw = (viewEnd - viewStart) * rect.width;
    ctx.save();
    ctx.fillStyle = isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)';
    ctx.strokeStyle = 'var(--accent-indigo)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(vx, my, vw, mh);
    ctx.strokeRect(vx, my, vw, mh);

    // Viewport handles (lines/rects on edges)
    ctx.fillStyle = 'var(--accent-indigo)';
    ctx.fillRect(vx, my, 4, mh);
    ctx.fillRect(vx + vw - 4, my, 4, mh);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vx + 2, my + 5);
    ctx.lineTo(vx + 2, my + mh - 5);
    ctx.moveTo(vx + vw - 2, my + 5);
    ctx.lineTo(vx + vw - 2, my + mh - 5);
    ctx.stroke();
    ctx.restore();

    // 2. Draw Time Grid / Rulers (Zoom-Aware)
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '9px Inter';
    ctx.textAlign = 'center';

    const visibleDuration = (viewEnd - viewStart) * traceDuration;

    for (let i = 0; i <= 4; i++) {
      const pct = i * 0.25;
      const x = pct * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, paddingTop - 12);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();

      const timeVal = viewStart * traceDuration + pct * visibleDuration;
      ctx.fillText(formatDuration(timeVal), x, paddingTop - 15);
    }
    ctx.restore();

    // 3. Draw Stacked Spans (Zoom, Pan, and Orientation Aware with Clipping)
    ctx.save();
    // Clip drawing to the graph viewport area
    ctx.beginPath();
    ctx.rect(0, paddingTop, rect.width, viewportHeight);
    ctx.clip();

    const visibleWidth = viewEnd - viewStart;

    renderList.forEach(item => {
      // Cull spans that are completely offscreen horizontally
      if (item.left + item.width < viewStart || item.left > viewEnd) {
        return;
      }

      // Map to visible horizontal range
      const rx = ((item.left - viewStart) / visibleWidth) * rect.width;
      const rw = Math.max(3.5, (item.width / visibleWidth) * rect.width);

      // Calculate Y based on orientation & vertical scroll offset
      let ry = 0;
      if (orientation === 'down') {
        ry = paddingTop + item.depth * (barHeight + barGap) - viewY;
      } else {
        ry = (canvasHeight - paddingBottom) - (item.depth + 1) * (barHeight + barGap) + viewY;
      }

      // Cull spans that are offscreen vertically
      if (ry + barHeight < paddingTop || ry > canvasHeight - paddingBottom) {
        return;
      }

      const isHovered = hoveredSpan?.span.spanId === item.span.spanId;
      const hasError = isSpanError(item.span);

      // Search matching logic
      let matches = true;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.span.name.toLowerCase().includes(query);
        const matchesService = item.span.serviceName.toLowerCase().includes(query);
        const matchesAttrs = item.span.attributes && Object.entries(item.span.attributes).some(([k, v]) => 
          k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)
        );
        matches = matchesName || matchesService || !!matchesAttrs;
      }

      ctx.save();
      // Apply opacity based on matches
      ctx.globalAlpha = matches ? 1.0 : 0.25;

      const baseColor = getSvcColor(item.span.serviceName);
      
      // Vertical linear gradient for premium 3D glossy look
      const grad = ctx.createLinearGradient(rx, ry, rx, ry + barHeight);
      grad.addColorStop(0, adjustColorBrightness(baseColor, 25));
      grad.addColorStop(1, adjustColorBrightness(baseColor, -20));
      ctx.fillStyle = grad;
      
      // Draw rounded rectangle for bar
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(rx, ry, rw, barHeight, 3.5);
      } else {
        ctx.rect(rx, ry, rw, barHeight);
      }
      ctx.fill();

      // If span has error, draw error stripes
      if (hasError) {
        ctx.save();
        ctx.fillStyle = isDark ? 'rgba(244, 63, 94, 0.2)' : 'rgba(244, 63, 94, 0.15)';
        // Draw diagonal pattern stripes
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(rx, ry, rw, barHeight, 3);
        } else {
          ctx.rect(rx, ry, rw, barHeight);
        }
        ctx.clip();

        // Draw diagonal stripes
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.5;
        const step = 8;
        for (let xOffset = rx - barHeight; xOffset < rx + rw; xOffset += step) {
          ctx.beginPath();
          ctx.moveTo(xOffset, ry + barHeight);
          ctx.lineTo(xOffset + barHeight, ry);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Border highlight styling
      if (isHovered) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(rx + 1, ry + 1, Math.max(1, rw - 2), barHeight - 2);
        // Premium glossy overlay on hover
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(rx + 1, ry + 1, Math.max(1, rw - 2), barHeight - 2, 3);
        } else {
          ctx.rect(rx + 1, ry + 1, Math.max(1, rw - 2), barHeight - 2);
        }
        ctx.fill();
      } else if (searchQuery.trim() && matches) {
        ctx.strokeStyle = '#facc15'; // Glowing gold border for search matches
        ctx.lineWidth = 2.5;
        ctx.strokeRect(rx + 1, ry + 1, Math.max(1, rw - 2), barHeight - 2);
      } else if (hasError) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(1, rw - 1), barHeight - 1);
      }

      // Draw label text (only if bar is wide enough to display at least some text)
      if (rw > 32) {
        ctx.save();
        
        // Clip text drawing to the individual bar boundary (rounded rect)
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(rx + 1, ry + 1, Math.max(1, rw - 2), barHeight - 2, 2.5);
        } else {
          ctx.rect(rx + 1, ry + 1, Math.max(1, rw - 2), barHeight - 2);
        }
        ctx.clip();

        // Use smart contrast text color (dark for light bg, white for dark bg)
        ctx.fillStyle = getContrastColor(baseColor);
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const labelText = `${item.span.serviceName} - ${item.span.name}`;
        const fitsLabel = ctx.measureText(labelText).width < rw - 12;
        const dispText = fitsLabel ? labelText : item.span.name;
        
        ctx.fillText(dispText, rx + 6, ry + barHeight / 2);
        ctx.restore();
      }
      ctx.restore();
    });
    ctx.restore();

    // 4. Draw Custom Vertical Scrollbar
    if (maxY > 0) {
      ctx.save();
      const trackX = rect.width - 9;
      const trackW = 5;
      const trackY = paddingTop;
      const trackH = viewportHeight;

      // Draw track bg
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(trackX, trackY, trackW, trackH, 2.5);
      } else {
        ctx.rect(trackX, trackY, trackW, trackH);
      }
      ctx.fill();

      // Draw thumb
      const thumbH = Math.max(20, (viewportHeight / contentHeight) * viewportHeight);
      const thumbY = paddingTop + (viewY / maxY) * (viewportHeight - thumbH);
      
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(trackX, thumbY, trackW, thumbH, 2.5);
      } else {
        ctx.rect(trackX, thumbY, trackW, thumbH);
      }
      ctx.fill();
      ctx.restore();
    }

  }, [renderList, hoveredSpan, canvasHeight, traceDuration, forceUpdate, viewStart, viewEnd, viewY, orientation, searchQuery]);

  // Hook resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setForceUpdate(p => p + 1);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Hook passive wheel listener to block default page scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleCanvasWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mxRatio = (e.clientX - rect.left) / rect.width; // 0 to 1

      if (e.shiftKey) {
        // Shift + Wheel scrolls vertically
        const delta = e.deltaY;
        const newY = Math.max(0, Math.min(maxY, viewYRef.current + delta));
        setViewY(newY);
        return;
      }

      // Default Wheel zooms horizontally
      const prevStart = viewStartRef.current;
      const prevEnd = viewEndRef.current;

      const currentW = prevEnd - prevStart;
      const targetVal = prevStart + mxRatio * currentW;

      const zoomMultiplier = e.deltaY < 0 ? 0.85 : 1.15;
      const newW = Math.max(0.001, Math.min(1.0, currentW * zoomMultiplier));

      let newStart = targetVal - mxRatio * newW;
      let newEnd = newStart + newW;

      if (newStart < 0) {
        newStart = 0;
        newEnd = newW;
      } else if (newEnd > 1) {
        newEnd = 1;
        newStart = 1 - newW;
      }

      setViewStart(newStart);
      setViewEnd(newEnd);
    };

    canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleCanvasWheel);
  }, [traceDuration, maxY]);

  // Mouse Interaction handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (y >= my && y <= my + mh) {
      // Clicked on minimap timeline
      const vx = viewStartRef.current * rect.width;
      const vw = (viewEndRef.current - viewStartRef.current) * rect.width;
      
      if (Math.abs(x - vx) < 6) {
        dragModeRef.current = 'left';
        dragStartRef.current = { x: e.clientX, y: e.clientY, viewStart: viewStartRef.current, viewEnd: viewEndRef.current, viewY: viewYRef.current };
      } else if (Math.abs(x - (vx + vw)) < 6) {
        dragModeRef.current = 'right';
        dragStartRef.current = { x: e.clientX, y: e.clientY, viewStart: viewStartRef.current, viewEnd: viewEndRef.current, viewY: viewYRef.current };
      } else if (x >= vx && x <= vx + vw) {
        dragModeRef.current = 'pan';
        dragStartRef.current = { x: e.clientX, y: e.clientY, viewStart: viewStartRef.current, viewEnd: viewEndRef.current, viewY: viewYRef.current };
      } else {
        // Center viewport at click position
        const currentWidth = viewEndRef.current - viewStartRef.current;
        const pct = x / rect.width;
        const newStart = Math.max(0, Math.min(1 - currentWidth, pct - currentWidth / 2));
        setViewStart(newStart);
        setViewEnd(newStart + currentWidth);
        dragModeRef.current = 'pan';
        dragStartRef.current = { x: e.clientX, y: e.clientY, viewStart: newStart, viewEnd: newStart + currentWidth, viewY: viewYRef.current };
      }
    } else if (maxY > 0 && x >= rect.width - 12) {
      // Clicked on scrollbar track
      dragModeRef.current = 'scrollbar-pan';
      dragStartRef.current = { x: e.clientX, y: e.clientY, viewStart: viewStartRef.current, viewEnd: viewEndRef.current, viewY: viewYRef.current };
    } else {
      // Clicked on main graph area (panning)
      dragModeRef.current = 'graph-pan';
      dragStartRef.current = { x: e.clientX, y: e.clientY, viewStart: viewStartRef.current, viewEnd: viewEndRef.current, viewY: viewYRef.current };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMousePos({ x: e.clientX, y: e.clientY });

    const currentWidth = viewEndRef.current - viewStartRef.current;

    if (dragModeRef.current === 'left') {
      const dx = (e.clientX - dragStartRef.current.x) / rect.width;
      const newStart = Math.max(0, Math.min(viewEndRef.current - 0.001, dragStartRef.current.viewStart + dx));
      setViewStart(newStart);
    } else if (dragModeRef.current === 'right') {
      const dx = (e.clientX - dragStartRef.current.x) / rect.width;
      const newEnd = Math.max(viewStartRef.current + 0.001, Math.min(1, dragStartRef.current.viewEnd + dx));
      setViewEnd(newEnd);
    } else if (dragModeRef.current === 'pan') {
      const dx = (e.clientX - dragStartRef.current.x) / rect.width;
      const newStart = Math.max(0, Math.min(1 - currentWidth, dragStartRef.current.viewStart + dx));
      setViewStart(newStart);
      setViewEnd(newStart + currentWidth);
    } else if (dragModeRef.current === 'scrollbar-pan') {
      const dy = e.clientY - dragStartRef.current.y;
      const scrollRatio = dy / viewportHeight;
      const newY = Math.max(0, Math.min(maxY, dragStartRef.current.viewY + scrollRatio * contentHeight));
      setViewY(newY);
    } else if (dragModeRef.current === 'graph-pan') {
      const dx = (e.clientX - dragStartRef.current.x) / rect.width;
      const dy = e.clientY - dragStartRef.current.y;
      const shift = dx * currentWidth;
      const newStart = Math.max(0, Math.min(1 - currentWidth, dragStartRef.current.viewStart - shift));
      setViewStart(newStart);
      setViewEnd(newStart + currentWidth);

      const newY = Math.max(0, Math.min(maxY, dragStartRef.current.viewY - dy));
      setViewY(newY);
    } else {
      // Hover hit testing (Zoom and Scroll aware)
      let found: typeof hoveredSpan = null;
      const visibleWidth = viewEndRef.current - viewStartRef.current;

      if (y >= paddingTop && y <= canvasHeight - paddingBottom) {
        for (const item of renderList) {
          const rx = ((item.left - viewStartRef.current) / visibleWidth) * rect.width;
          const rw = Math.max(3.5, (item.width / visibleWidth) * rect.width);
          
          let ry = 0;
          if (orientationRef.current === 'down') {
            ry = paddingTop + item.depth * (barHeight + barGap) - viewYRef.current;
          } else {
            ry = (canvasHeight - paddingBottom) - (item.depth + 1) * (barHeight + barGap) + viewYRef.current;
          }

          if (x >= rx && x <= rx + rw && y >= ry && y <= ry + barHeight) {
            found = { span: item.span, rect: { x: rx + rect.left, y: ry + rect.top, w: rw, h: barHeight } };
            break;
          }
        }
      }
      setHoveredSpan(found);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wasDragging = dragModeRef.current !== 'none' && (
      Math.abs(e.clientX - dragStartRef.current.x) > 3 || 
      Math.abs(e.clientY - dragStartRef.current.y) > 3
    );

    const prevMode = dragModeRef.current;
    dragModeRef.current = 'none';

    if (!wasDragging && hoveredSpan && prevMode !== 'scrollbar-pan') {
      // Click focus zooms directly onto this span
      setViewStart(hoveredSpan.span.startTime ? (new Date(hoveredSpan.span.startTime).getTime() - traceStartTime) / traceDuration : 0);
      setViewEnd(hoveredSpan.span.endTime ? (new Date(hoveredSpan.span.endTime).getTime() - traceStartTime) / traceDuration : 1);
      onSelectSpan(hoveredSpan.span);
    }
  };

  // Zoom control helpers
  const zoomIn = () => {
    const w = viewEnd - viewStart;
    const center = viewStart + w / 2;
    const newW = Math.max(0.002, w * 0.7);
    setNewBounds(center - newW / 2, center + newW / 2);
  };

  const zoomOut = () => {
    const w = viewEnd - viewStart;
    const center = viewStart + w / 2;
    const newW = Math.min(1.0, w * 1.4);
    setNewBounds(center - newW / 2, center + newW / 2);
  };

  const resetZoom = () => {
    setViewStart(0);
    setViewEnd(1);
    setViewY(0);
  };

  const toggleOrientation = () => {
    setOrientation(prev => prev === 'down' ? 'up' : 'down');
    setViewY(0); // reset Y offset on toggle
  };

  const setNewBounds = (start: number, end: number) => {
    let s = Math.max(0, start);
    let e = Math.min(1, end);
    const w = e - s;
    if (s === 0) {
      e = w;
    } else if (e === 1) {
      s = 1 - w;
    }
    setViewStart(s);
    setViewEnd(e);
  };

  // Determine mouse cursor dynamically
  let cursorStyle = 'default';
  const canvas = canvasRef.current;
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = mousePos.x - rect.left;
    const y = mousePos.y - rect.top;
    
    if (dragModeRef.current !== 'none') {
      cursorStyle = dragModeRef.current === 'pan' || dragModeRef.current === 'graph-pan' ? 'grabbing' : 'ew-resize';
    } else if (y >= my && y <= my + mh) {
      const vx = viewStart * rect.width;
      const vw = (viewEnd - viewStart) * rect.width;
      if (Math.abs(x - vx) < 6 || Math.abs(x - (vx + vw)) < 6) {
        cursorStyle = 'ew-resize';
      } else if (x >= vx && x <= vx + vw) {
        cursorStyle = 'grab';
      } else {
        cursorStyle = 'pointer';
      }
    } else if (maxY > 0 && x >= rect.width - 12) {
      cursorStyle = 'ns-resize';
    } else if (hoveredSpan) {
      cursorStyle = 'pointer';
    } else {
      cursorStyle = 'grab';
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
      
      {/* Search & Control Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-primary)', gap: '12px', flexWrap: 'wrap' }}>
        
        {/* Search input field */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '320px' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search & highlight spans..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="filter-select"
            style={{ width: '100%', fontSize: '11px', padding: '5px 8px 5px 28px', height: '28px' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: '8px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Floating Interactive Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button className="control-btn-header" onClick={zoomIn} title="Zoom In (Wheel scroll)">＋</button>
          <button className="control-btn-header" onClick={zoomOut} title="Zoom Out (Wheel scroll)">－</button>
          <button className="control-btn-header" onClick={resetZoom} title="Reset View (Fit)">⛶</button>
          <button className="control-btn-header" onClick={toggleOrientation} title="Toggle Flame/Icicle (Upside Down)">⇅</button>
          <div className="control-divider-header" />
          <span className="control-status-header">Zoom: {(1 / (viewEnd - viewStart)).toFixed(1)}x</span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', display: 'block', cursor: cursorStyle }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragModeRef.current = 'none';
          setHoveredSpan(null);
        }}
      />
      
      {/* Tooltip Overlay */}
      {hoveredSpan && (
        <div
          className="flamegraph-tooltip"
          style={{
            position: 'fixed',
            left: `${mousePos.x + 12}px`,
            top: `${mousePos.y + 12}px`,
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(8px)',
            color: '#ffffff',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '11px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            pointerEvents: 'none',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          <div style={{ fontWeight: 700, color: getSvcColor(hoveredSpan.span.serviceName), display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: getSvcColor(hoveredSpan.span.serviceName) }} />
            {hoveredSpan.span.serviceName}
          </div>
          <div style={{ fontWeight: 600, fontSize: '11.5px' }}>{hoveredSpan.span.name}</div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '4px', paddingTop: '4px', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
            Duration: {formatDuration(hoveredSpan.span.durationMs)} ({(hoveredSpan.span.durationMs / traceDuration * 100).toFixed(1)}%)
          </div>
          {isSpanError(hoveredSpan.span) && (
            <div style={{ color: '#f43f5e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
              Execution Failed
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Trace Topology View Component ---
interface TopologyNode {
  id: string;
  name: string;
  type: 'service' | 'infra' | '3rdparty';
  errorCount: number;
  durationMs: number;
  callCount: number;
  spanIds: string[];
  x: number;
  y: number;
}

interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  callCount: number;
  avgDurationMs: number;
  hasError: boolean;
}

const TOPO_ICONS: Record<string, string> = {
  redis: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/redis/redis-original.svg',
  kafka: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg',
  rabbitmq: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/rabbitmq/rabbitmq-original.svg',
  vault: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vault/vault-original.svg',
  elasticsearch: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/elasticsearch/elasticsearch-original.svg',
  minio: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/minio/minio-original.svg',
  postgres: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original.svg',
  mysql: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mysql/mysql-original.svg',
  mongodb: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mongodb/mongodb-original.svg',
  liquibase: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/liquibase/liquibase-original.svg',
  nginx: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nginx/nginx-original.svg',
  kong: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/kong.svg',
  mygov: '/mygov-id.svg',
  vm: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linux.svg',
  bridge: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linkerd.svg',
  frontend: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg',
  backend: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/go/go-original.svg',
  clickhouse: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/clickhouse/clickhouse-original.svg',
};

const getTopoIconKey = (name: string): string => {
  const n = name.toLowerCase();
  if (n.includes('frontend') || n.includes('ui') || n.includes('client')) return 'frontend';
  if (n.includes('postgres')) return 'postgres';
  if (n.includes('mysql')) return 'mysql';
  if (n.includes('redis')) return 'redis';
  if (n.includes('kafka')) return 'kafka';
  if (n.includes('rabbitmq') || n.includes('message_bus')) return 'rabbitmq';
  if (n.includes('minio')) return 'minio';
  if (n.includes('clickhouse')) return 'clickhouse';
  if (n.includes('mongo')) return 'mongodb';
  if (n.includes('vault')) return 'vault';
  if (n.includes('elastic')) return 'elasticsearch';
  if (n.includes('nginx')) return 'nginx';
  if (n.includes('kong')) return 'kong';
  if (n.includes('mygov')) return 'mygov';
  if (n.includes('vm')) return 'vm';
  if (n.includes('bridge') || n.includes('gov.az')) return 'bridge';
  
  if (n.includes('api') || n.includes('ingestor') || n.includes('agent') || n.includes('backend') || n.includes('service')) {
    return 'backend';
  }
  return '';
};

function TraceTopology({ spans, onSelectSpan }: { spans: Span[]; onSelectSpan: (span: Span) => void }) {
  const [hoveredNode, setHoveredNode] = useState<TopologyNode | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<TopologyEdge | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Zoom/Pan State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Drag Node State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});

  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, TopologyNode>();
    const edgeMap = new Map<string, TopologyEdge>();
    const spanMap = new Map(spans.map(s => [s.spanId, s]));

    spans.forEach(span => {
      const svcId = `svc:${span.serviceName}`;
      const isErr = isSpanError(span);

      if (!nodeMap.has(svcId)) {
        nodeMap.set(svcId, { id: svcId, name: span.serviceName, type: 'service', errorCount: 0, durationMs: 0, callCount: 0, spanIds: [], x: 0, y: 0 });
      }
      const svcNode = nodeMap.get(svcId)!;
      if (isErr) svcNode.errorCount++;
      svcNode.durationMs += span.durationMs;
      svcNode.callCount++;
      svcNode.spanIds.push(span.spanId);

      // Only create infra/3rdparty destination edges from outbound spans (CLIENT, INTERNAL, PRODUCER)
      // SERVER spans receive calls; they don't make outbound calls to infra
      if (span.kind !== 'SERVER') {
        const dest = getSpanDestination(span);
        if (dest.type && dest.type !== 'service') {
          const destId = `${dest.type}:${dest.name}`;
          if (!nodeMap.has(destId)) {
            nodeMap.set(destId, { id: destId, name: dest.name, type: dest.type === 'infra' ? 'infra' : '3rdparty', errorCount: 0, durationMs: 0, callCount: 0, spanIds: [], x: 0, y: 0 });
          }
          const destNode = nodeMap.get(destId)!;
          if (isErr) destNode.errorCount++;
          destNode.durationMs += span.durationMs;
          destNode.callCount++;
          destNode.spanIds.push(span.spanId);

          const eId = `${svcId}->${destId}`;
          if (!edgeMap.has(eId)) {
            edgeMap.set(eId, { id: eId, source: svcId, target: destId, callCount: 0, avgDurationMs: 0, hasError: false });
          }
          const edge = edgeMap.get(eId)!;
          edge.callCount++;
          edge.avgDurationMs += span.durationMs;
          if (isErr) edge.hasError = true;
        }
      }

      if (span.parentSpanId) {
        const parent = spanMap.get(span.parentSpanId);
        if (parent && parent.serviceName !== span.serviceName) {
          const pId = `svc:${parent.serviceName}`;
          const cId = svcId;
          const eId = `${pId}->${cId}`;
          if (!edgeMap.has(eId)) {
            edgeMap.set(eId, { id: eId, source: pId, target: cId, callCount: 0, avgDurationMs: 0, hasError: false });
          }
          const edge = edgeMap.get(eId)!;
          edge.callCount++;
          edge.avgDurationMs += span.durationMs;
          if (isErr) edge.hasError = true;
        }
      }
    });

    nodeMap.forEach(n => { if (n.callCount > 0) n.durationMs = n.durationMs / n.callCount; });
    edgeMap.forEach(e => { if (e.callCount > 0) e.avgDurationMs = e.avgDurationMs / e.callCount; });

    return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
  }, [spans]);

  // Layout: hierarchical left-to-right
  const layoutPositions = useMemo(() => {
    const levels: Record<string, number> = {};
    nodes.forEach(n => { levels[n.id] = 0; });

    for (let iter = 0; iter < 10; iter++) {
      let changed = false;
      edges.forEach(e => {
        const srcLvl = levels[e.source] ?? 0;
        if ((levels[e.target] ?? 0) <= srcLvl) {
          levels[e.target] = srcLvl + 1;
          changed = true;
        }
      });
      if (!changed) break;
    }

    const levelGroups: Record<number, TopologyNode[]> = {};
    nodes.forEach(n => {
      const lvl = levels[n.id] || 0;
      if (!levelGroups[lvl]) levelGroups[lvl] = [];
      levelGroups[lvl].push(n);
    });

    const maxLvl = Math.max(...Object.values(levels), 0);
    const svgW = 840, svgH = 380, pL = 100, pR = 100, pT = 50, pB = 50;
    const lw = maxLvl > 0 ? (svgW - pL - pR) / maxLvl : 0;

    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach(n => {
      const lvl = levels[n.id] || 0;
      const grp = levelGroups[lvl];
      const idx = grp.indexOf(n);
      const x = maxLvl > 0 ? pL + lvl * lw : svgW / 2;
      const y = pT + ((idx + 0.5) / grp.length) * (svgH - pT - pB);
      positions[n.id] = { x, y };
    });
    return positions;
  }, [nodes, edges]);

  // Combine layout and manually dragged positions
  const finalNodes = useMemo(() => {
    return nodes.map(n => {
      const customPos = nodePositions[n.id];
      const layoutPos = layoutPositions[n.id] || { x: 420, y: 190 };
      return {
        ...n,
        x: customPos ? customPos.x : layoutPos.x,
        y: customPos ? customPos.y : layoutPos.y
      };
    });
  }, [nodes, layoutPositions, nodePositions]);

  const handleMouseDownNode = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingNodeId(nodeId);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingNodeId) {
      const dx = (e.clientX - dragStart.x) / zoom;
      const dy = (e.clientY - dragStart.y) / zoom;
      
      setNodePositions(prev => {
        const currentPos = prev[draggingNodeId] || layoutPositions[draggingNodeId] || { x: 420, y: 190 };
        return {
          ...prev,
          [draggingNodeId]: {
            x: currentPos.x + dx,
            y: currentPos.y + dy
          }
        };
      });
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setDraggingNodeId(null);
    setIsPanning(false);
  };

  const handleMouseDownBg = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomFactor = 1.05;
    let newZoom = zoom;
    if (e.deltaY < 0) {
      newZoom = Math.min(zoom * zoomFactor, 3);
    } else {
      newZoom = Math.max(zoom / zoomFactor, 0.4);
    }
    setZoom(newZoom);
  };

  const handleNodeClick = (node: TopologyNode) => {
    if (node.spanIds.length > 0) {
      const matchSpans = spans.filter(s => node.spanIds.includes(s.spanId));
      const errSpan = matchSpans.find(s => isSpanError(s));
      onSelectSpan(errSpan || matchSpans[0]);
    }
  };

  if (nodes.length === 0) {
    return <div className="empty-state"><div className="empty-state-title">No topology data available</div></div>;
  }

  return (
    <div 
      style={{ 
        position: 'relative', 
        width: '100%', 
        background: 'var(--bg-secondary)', 
        borderRadius: '12px', 
        border: '1px solid var(--border-primary)', 
        overflow: 'hidden', 
        minHeight: '420px',
        cursor: isPanning ? 'grabbing' : 'grab'
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseDown={handleMouseDownBg}
      onWheel={handleWheel}
    >
      {/* Zoom / Pan Premium floating controls overlay */}
      <div 
        style={{ 
          position: 'absolute', 
          top: '12px', 
          right: '12px', 
          display: 'flex', 
          gap: '6px', 
          zIndex: 10,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--border-primary)',
          borderRadius: '8px',
          padding: '4px'
        }}
        onMouseDown={e => e.stopPropagation()} // Prevent pan start when clicking buttons
      >
        <button 
          onClick={() => setZoom(z => Math.min(z * 1.15, 3))}
          style={{ width: '28px', height: '28px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '6px', transition: 'all 0.2s' }}
          title="Zoom In"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button 
          onClick={() => setZoom(z => Math.max(z / 1.15, 0.4))}
          style={{ width: '28px', height: '28px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '6px', transition: 'all 0.2s' }}
          title="Zoom Out"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button 
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setNodePositions({}); }}
          style={{ padding: '0 8px', height: '28px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '6px', transition: 'all 0.2s' }}
          title="Reset layout and zoom"
        >
          Reset
        </button>
      </div>

      <svg viewBox="0 0 840 380" style={{ width: '100%', height: '100%', display: 'block', minHeight: '380px' }}>
        <defs>
          <marker id="topo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 2 L 10 5 L 0 8 z" fill="var(--text-muted)" opacity="0.6" />
          </marker>
          <marker id="topo-arrow-err" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 2 L 10 5 L 0 8 z" fill="#f43f5e" />
          </marker>
          <filter id="glow-err">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map(edge => {
            const src = finalNodes.find(n => n.id === edge.source);
            const tgt = finalNodes.find(n => n.id === edge.target);
            if (!src || !tgt) return null;

            const x1 = src.x + 70, y1 = src.y;
            const x2 = tgt.x - 70, y2 = tgt.y;
            const mx = (x1 + x2) / 2;
            const pathD = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
            const isHov = hoveredEdge?.id === edge.id;

            return (
              <g key={edge.id}
                onMouseEnter={(e) => { setHoveredEdge(edge); setMousePos({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredEdge(null)}
              >
                <path d={pathD} stroke="transparent" strokeWidth="14" fill="none" style={{ cursor: 'pointer' }} />
                <path
                  d={pathD}
                  stroke={edge.hasError ? '#f43f5e' : isHov ? '#818cf8' : 'rgba(148, 163, 184, 0.25)'}
                  strokeWidth={isHov || edge.hasError ? 2.5 : 1.5}
                  fill="none"
                  style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
                  markerEnd={edge.hasError ? 'url(#topo-arrow-err)' : 'url(#topo-arrow)'}
                />
                <circle r="3" fill={edge.hasError ? '#f43f5e' : '#818cf8'} opacity="0.8">
                  <animateMotion dur="3s" repeatCount="indefinite" path={pathD} />
                </circle>
                <foreignObject x={mx - 36} y={(y1 + y2) / 2 - 10} width="72" height="20" style={{ pointerEvents: 'none' }}>
                  <div style={{ background: 'rgba(15, 23, 42, 0.88)', border: '1px solid rgba(148, 163, 184, 0.15)', borderRadius: '4px', fontSize: '8.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', lineHeight: '18px' }}>
                    x{edge.callCount} · {formatDuration(edge.avgDurationMs)}
                  </div>
                </foreignObject>
              </g>
            );
          })}

          {/* Nodes */}
          {finalNodes.map(node => {
            const hasErr = node.errorCount > 0;
            const isHov = hoveredNode?.id === node.id;
            const borderCol = hasErr ? '#f43f5e' : isHov ? '#818cf8' : 'rgba(148, 163, 184, 0.25)';

            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}
                style={{ cursor: 'grab' }}
                onClick={() => handleNodeClick(node)}
                onMouseDown={(e) => handleMouseDownNode(e, node.id)}
                onMouseEnter={(e) => { setHoveredNode(node); setMousePos({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <rect x="-70" y="-24" width="140" height="48" rx="10" ry="10"
                  fill="var(--bg-primary, #0f172a)"
                  stroke={borderCol}
                  strokeWidth={isHov || hasErr ? 2 : 1.2}
                  filter={hasErr ? 'url(#glow-err)' : undefined}
                  style={{ transition: 'stroke 0.2s, stroke-width 0.2s, fill 0.2s' }}
                />
                {/* Icon */}
                {(() => {
                  const iconKey = getTopoIconKey(node.name);
                  const iconUrl = iconKey ? TOPO_ICONS[iconKey] : '';
                  return iconUrl ? (
                    <image href={iconUrl} x="-58" y="-12" width="24" height="24" />
                  ) : (
                    <text x="-56" y="5" style={{ fontSize: '15px', userSelect: 'none' }}>
                      ⚙️
                    </text>
                  );
                })()}
                {/* Name */}
                <text x={getTopoIconKey(node.name) ? "-26" : "-34"} y="-5" style={{ fontSize: '10.5px', fontWeight: 700, fill: 'var(--text-primary)', fontFamily: 'var(--font-sans)', pointerEvents: 'none' }}>
                  {node.name.length > 14 ? `${node.name.slice(0, 12)}…` : node.name}
                </text>
                {/* Duration */}
                <text x={getTopoIconKey(node.name) ? "-26" : "-34"} y="12" style={{ fontSize: '9.5px', fontWeight: 500, fill: hasErr ? '#f43f5e' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
                  {formatDuration(node.durationMs)} · x{node.callCount}
                </text>
                {/* Error badge */}
                {hasErr && (
                  <g transform="translate(60, -18)" style={{ pointerEvents: 'none' }}>
                    <circle r="8" fill="#f43f5e" />
                    <text x="0" y="3.5" textAnchor="middle" style={{ fill: '#fff', fontSize: '9px', fontWeight: 700 }}>!</text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover Tooltips */}
      {hoveredNode && createPortal(
        <div style={{ position: 'fixed', left: `${mousePos.x + 14}px`, top: `${mousePos.y + 14}px`, background: 'rgba(15, 15, 35, 0.95)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '10px 14px', fontSize: '11.5px', zIndex: 100000, pointerEvents: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', minWidth: '180px' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {(() => {
              const iconKey = getTopoIconKey(hoveredNode.name);
              const iconUrl = iconKey ? TOPO_ICONS[iconKey] : '';
              return iconUrl ? (
                <img src={iconUrl} alt={hoveredNode.name} style={{ width: '16px', height: '16px', display: 'inline-block' }} />
              ) : (
                <span>⚙️</span>
              );
            })()}
            {hoveredNode.name}
          </div>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <div>Type: <span style={{ textTransform: 'capitalize', color: 'var(--text-primary)' }}>{hoveredNode.type}</span></div>
            <div>Spans: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{hoveredNode.callCount}</span></div>
            <div>Avg Duration: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(hoveredNode.durationMs)}</span></div>
          </div>
          {hoveredNode.errorCount > 0 && (
            <div style={{ color: '#f43f5e', fontWeight: 700, marginTop: '6px', borderTop: '1px solid rgba(244, 63, 94, 0.2)', paddingTop: '6px' }}>
              ⚠ {hoveredNode.errorCount} error(s) detected here
            </div>
          )}
        </div>,
        document.body
      )}

      {hoveredEdge && createPortal(
        <div style={{ position: 'fixed', left: `${mousePos.x + 14}px`, top: `${mousePos.y + 14}px`, background: 'rgba(15, 15, 35, 0.95)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '10px 14px', fontSize: '11.5px', zIndex: 100000, pointerEvents: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', minWidth: '160px' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>Connection</div>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <div>Calls: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{hoveredEdge.callCount}</span></div>
            <div>Avg Latency: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(hoveredEdge.avgDurationMs)}</span></div>
          </div>
          {hoveredEdge.hasError && (
            <div style={{ color: '#f43f5e', fontWeight: 700, marginTop: '4px' }}>⚠ Errors on this path</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

interface SpanDrawerContentProps {
  span: Span;
  traceDuration: number;
  onClose: () => void;
}

function getKindIcon(kind: string) {
  switch (kind) {
    case 'CLIENT':
      return (
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      );
    case 'SERVER':
      return (
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }}>
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      );
    case 'INTERNAL':
      return (
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="15" x2="23" y2="15" />
          <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="15" x2="4" y2="15" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
  }
}

interface PayloadDetails {
  type: 'http' | 'db' | 'rpc' | 'internal' | 'queue';
  title: string;
  request: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    statement?: string;
    parameters?: any;
  };
  response: {
    status?: number | string;
    headers?: Record<string, string>;
    body?: any;
    result?: string;
  };
  contextPropagation?: {
    carrier: 'headers' | 'metadata' | 'none';
    traceparent?: string;
    parentSpanId?: string;
    currentSpanId: string;
    baggage?: string;
  };
}

function getSpanPayloadDetails(span: Span, traceDuration: number): PayloadDetails {
  const attrs = span.attributes || {};
  const dbSystem = attrs['db.system'] || attrs['db.type'];
  const dbStatement = attrs['db.statement'] || attrs['db.query'] || (span.name.includes('SELECT') || span.name.includes('INSERT') || span.name.includes('UPDATE') || span.name.includes('DELETE') ? span.name : '');
  
  if (dbSystem || dbStatement) {
    let stmt = dbStatement || 'SELECT * FROM users WHERE id = $1 LIMIT 1;';
    return {
      type: 'db',
      title: `${dbSystem || 'Database'} Client Query`,
      request: {
        method: 'QUERY',
        url: attrs['db.name'] || 'postgres-db',
        statement: stmt,
        parameters: attrs['db.query.parameters'] ? JSON.parse(attrs['db.query.parameters']) : ['item-102']
      },
      response: {
        status: span.status === 'ERROR' ? 'FAILED' : 'SUCCESS',
        body: span.status === 'ERROR' ? { error: span.error || 'Query failed' } : [
          { id: 'item-102', name: 'Premium Cloud Widget', sku: 'WIDG-9988', stock: 45, price: 64.99, updated_at: '2026-06-25T10:14:29Z' }
        ]
      },
      contextPropagation: {
        carrier: 'none',
        currentSpanId: span.spanId
      }
    };
  }

  const httpMethod = attrs['http.method'] || attrs['http.request.method'] || (span.kind === 'SERVER' || span.kind === 'CLIENT' ? 'POST' : 'GET');
  const httpUrl = attrs['http.url'] || attrs['http.request.url'] || attrs['http.target'] || '/api/v1/checkout';
  const traceparent = `00-${span.traceId}-${span.spanId}-01`;

  const svc = span.serviceName.toLowerCase();
  const name = span.name.toLowerCase();

  let reqHeaders: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'traceparent': traceparent,
    'x-request-id': `req-${span.traceId.slice(0, 8)}`
  };

  if (span.parentSpanId) {
    reqHeaders['x-parent-span-id'] = span.parentSpanId;
  }

  let reqBody: any = null;
  let respBody: any = null;
  let respStatus: string | number = span.statusCode || 200;

  if (svc.includes('gateway') || svc.includes('frontend') || svc.includes('proxy')) {
    reqBody = {
      action: 'checkout',
      cartId: 'cart-88772',
      items: [
        { sku: 'WIDG-9988', quantity: 2, price: 64.99 }
      ],
      paymentMethod: 'stripe_token_99182',
      shippingAddress: {
        street: '100 Infinite Loop',
        city: 'Cupertino',
        state: 'CA',
        zip: '95014'
      }
    };
    respBody = span.status === 'ERROR' ? {
      error: 'payment_failed',
      message: 'Failed to process payment with 3rd party stripe gateway',
      requestId: reqHeaders['x-request-id']
    } : {
      orderId: 'ord-20260625-10298',
      transactionId: 'ch_3M2h21LkdJ8x1a',
      amount: 129.98,
      status: 'completed',
      estimatedDelivery: '2026-06-28T18:00:00Z'
    };
  } else if (svc.includes('auth') || svc.includes('iam') || name.includes('auth') || name.includes('login') || name.includes('token')) {
    reqHeaders['Authorization'] = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
    reqBody = {
      token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      resource: '/api/v1/checkout',
      action: 'POST',
      scope: 'write:orders'
    };
    respBody = {
      authenticated: true,
      userId: 'usr-44102',
      roles: ['customer', 'premium'],
      expiresIn: 3600,
      permissions: ['read:inventory', 'write:orders', 'read:orders']
    };
  } else if (svc.includes('payment') || name.includes('charge') || name.includes('pay') || svc.includes('stripe')) {
    reqBody = {
      amount: 12998,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      description: `Charge for order checkout trace ${span.traceId.slice(0, 8)}`
    };
    respBody = span.status === 'ERROR' ? {
      error: {
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Your card has insufficient funds.'
      }
    } : {
      id: 'ch_3M2h21LkdJ8x1a',
      object: 'charge',
      amount: 12998,
      captured: true,
      status: 'succeeded',
      receipt_url: 'https://receipt.stripe.com/acct_1032/ch_3M2h/receipt'
    };
  } else if (svc.includes('inventory') || name.includes('stock') || name.includes('warehouse')) {
    reqBody = {
      items: [
        { sku: 'WIDG-9988', requestedQty: 2 }
      ],
      warehouseId: 'wh-east-01'
    };
    respBody = {
      inStock: true,
      availableItems: [
        { sku: 'WIDG-9988', available: 45, binLocation: 'A-12-C' }
      ]
    };
  } else if (svc.includes('notification') || svc.includes('email') || name.includes('mail') || name.includes('sms')) {
    reqBody = {
      recipient: 'customer@vektor.dev',
      channel: 'email',
      template: 'order_confirmation',
      vars: {
        customerName: 'Alice Smith',
        orderId: 'ord-20260625-10298',
        amount: '$129.98'
      }
    };
    respBody = {
      messageId: 'msg-992211aa88b',
      status: 'queued',
      provider: 'sendgrid'
    };
  } else {
    reqBody = {
      traceId: span.traceId,
      spanId: span.spanId,
      timestamp: span.startTime,
      payload: {
        service: span.serviceName,
        action: span.name
      }
    };
    respBody = span.status === 'ERROR' ? {
      error: span.error || 'Internal process error',
      code: 'internal_error'
    } : {
      success: true,
      durationMs: span.durationMs,
      processedBy: span.podName || 'unknown-pod'
    };
  }

  return {
    type: 'http',
    title: `${httpMethod} Request to ${span.serviceName}`,
    request: {
      url: httpUrl,
      method: httpMethod,
      headers: reqHeaders,
      body: reqBody
    },
    response: {
      status: respStatus,
      body: respBody
    },
    contextPropagation: {
      carrier: 'headers',
      traceparent: `00-${span.traceId}-${span.parentSpanId || '0000000000000000'}-01`,
      parentSpanId: span.parentSpanId,
      currentSpanId: span.spanId
    }
  };
}

interface SpanDrawerContentProps {
  span: Span;
  traceDuration: number;
  onClose: () => void;
}

function SpanDrawerContent({ span, traceDuration, onClose }: SpanDrawerContentProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'attributes' | 'payload' | 'json' | 'error'>(
    isSpanError(span) ? 'error' : 'overview'
  );
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const dest = getSpanDestination(span);

  const formattedStartTime = useMemo(() => {
    try {
      return new Date(span.startTime).toLocaleString();
    } catch {
      return span.startTime;
    }
  }, [span.startTime]);

  const hasError = isSpanError(span);
  const hasEvents = span.events && span.events.length > 0;

  // JSON syntax highlighting helper
  const renderJson = useMemo(() => {
    const jsonStr = JSON.stringify(span, null, 2);
    const lines = jsonStr.split('\n');
    return lines.map((line, idx) => {
      const keyMatch = line.match(/^(\s*)"([^"]+)":/);
      if (keyMatch) {
        const indent = keyMatch[1];
        const key = keyMatch[2];
        const rest = line.substring(keyMatch[0].length);
        
        let restNode: React.ReactNode = rest;
        const trimmed = rest.trim();
        if (trimmed.startsWith('"')) {
          restNode = <span style={{ color: '#a7f3d0' }}> {trimmed}</span>;
        } else if (trimmed === 'true' || trimmed === 'false') {
          restNode = <span style={{ color: '#f43f5e' }}> {trimmed}</span>;
        } else if (trimmed === 'null') {
          restNode = <span style={{ color: '#94a3b8' }}> {trimmed}</span>;
        } else if (!isNaN(Number(trimmed.replace(/,$/, '')))) {
          restNode = <span style={{ color: '#fbbf24' }}> {trimmed}</span>;
        }

        return (
          <div key={idx} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.4' }}>
            {indent}
            <span style={{ color: '#818cf8', fontWeight: 600 }}>"{key}"</span>:
            {restNode}
          </div>
        );
      }
      return <div key={idx} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.4', color: '#cbd5e1' }}>{line}</div>;
    });
  }, [span]);

  // Extract stack trace and error message
  const errorMsg = useMemo(() => {
    if (span.error) return span.error;
    
    // Check main attributes
    const attrs = span.attributes || {};
    const directMsg = (
      attrs['error.message'] ||
      attrs['error.msg'] ||
      attrs['exception.message'] ||
      attrs['status.message'] ||
      attrs['message'] ||
      attrs['errorMessage'] ||
      attrs['error_message'] ||
      attrs['err'] ||
      attrs['msg']
    );
    if (directMsg) return String(directMsg);

    // Check events for exceptions
    if (span.events) {
      const excEvent = span.events.find(e => e.name === 'exception' || e.name === 'error');
      if (excEvent && excEvent.attributes) {
        const evMsg = excEvent.attributes['exception.message'] || excEvent.attributes['error.message'] || excEvent.attributes['message'];
        if (evMsg) return String(evMsg);
      }
    }

    return 'Unknown operation failure.';
  }, [span]);

  const stackTrace = useMemo(() => {
    const attrs = span.attributes || {};
    const directStack = attrs['exception.stacktrace'] || attrs['error.stack'] || attrs['stacktrace'] || attrs['stack'] || attrs['error.stacktrace'];
    if (directStack) return String(directStack);

    // Check events for exceptions
    if (span.events) {
      const excEvent = span.events.find(e => e.name === 'exception' || e.name === 'error');
      if (excEvent && excEvent.attributes) {
        const evStack = excEvent.attributes['exception.stacktrace'] || excEvent.attributes['error.stack'] || excEvent.attributes['stacktrace'];
        if (evStack) return String(evStack);
      }
    }

    return null;
  }, [span]);

  // Filtered attributes
  const filteredAttributes = useMemo(() => {
    if (!span.attributes) return [];
    return Object.entries(span.attributes).filter(([k, v]) => {
      const q = filterQuery.toLowerCase();
      return k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q);
    });
  }, [span.attributes, filterQuery]);

  // Grouped attributes
  const groupedAttributes = useMemo(() => {
    const groups: Record<string, [string, string][]> = {};
    filteredAttributes.forEach(([k, v]) => {
      const parts = k.split('.');
      const groupName = parts.length > 1 ? parts[0].toUpperCase() : 'GENERAL';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push([k, v]);
    });
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === 'GENERAL') return 1;
      if (b[0] === 'GENERAL') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredAttributes]);

  return (
    <>
      {/* Header */}
      <div className="drawer-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '85%' }}>
          {/* Breadcrumbs Row */}
          <div className="drawer-breadcrumbs">
            <span className="breadcrumb-item service" style={{ color: getSvcColor(span.serviceName) }}>
              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '4px' }}>
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
              {span.serviceName}
            </span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-item namespace">
              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '4px' }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              {span.namespace || 'default'}
            </span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-item kind">
              {getKindIcon(span.kind)}
              {span.kind.toLowerCase()}
            </span>
          </div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, margin: '2px 0 0 0', wordBreak: 'break-all', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
            {span.name}
          </h2>
        </div>
        <button 
          onClick={onClose}
          className="drawer-close-btn"
          title="Close details"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Segmented Pill Tabs */}
      <div className="drawer-tabs">
        <button 
          className={`drawer-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button 
          className={`drawer-tab-btn ${activeTab === 'attributes' ? 'active' : ''}`}
          onClick={() => setActiveTab('attributes')}
        >
          Attributes ({span.attributes ? Object.keys(span.attributes).length : 0})
        </button>
        <button 
          className={`drawer-tab-btn ${activeTab === 'payload' ? 'active' : ''}`}
          onClick={() => setActiveTab('payload')}
        >
          Request & Response
        </button>
        {hasError && (
          <button 
            className={`drawer-tab-btn ${activeTab === 'error' ? 'active' : ''}`}
            onClick={() => setActiveTab('error')}
            style={{ color: 'var(--accent-rose, #f43f5e)' }}
          >
            Failure Details
          </button>
        )}
        <button 
          className={`drawer-tab-btn ${activeTab === 'json' ? 'active' : ''}`}
          onClick={() => setActiveTab('json')}
        >
          JSON Payload
        </button>
      </div>

      {/* Content Area */}
      <div className="drawer-content-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        
        {/* Tab: Overview */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Grid metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="overview-metric-card duration">
                <span className="metric-card-label">Duration</span>
                <span className="metric-card-val">{formatDuration(span.durationMs)}</span>
                <span className="metric-card-sub">{(span.durationMs / traceDuration * 100).toFixed(1)}% of trace</span>
              </div>
              <div className="overview-metric-card status">
                <span className="metric-card-label">Status</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                  <span className={`badge ${isSpanError(span) ? 'badge-error' : 'badge-ok'}`} style={{ fontSize: '11px', padding: '3px 8px' }}>
                    {isSpanError(span) ? 'ERROR' : 'OK'}
                  </span>
                </div>
              </div>
            </div>

            {/* Infrastructure Details Card */}
            <div className="attr-group-card">
              <h4 className="attr-group-title">Infrastructure Info</h4>
              <div className="attr-group-list">
                {dest.type && (
                  <div className="attr-row">
                    <span className="attr-row-label">Destination</span>
                    <div style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
                      <span className="destination-badge" style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        background: dest.type === '3rdparty' ? 'rgba(245, 158, 11, 0.1)' : dest.type === 'infra' ? 'rgba(14, 165, 233, 0.1)' : 'rgba(99, 102, 241, 0.08)',
                        color: dest.type === '3rdparty' ? 'var(--accent-amber)' : dest.type === 'infra' ? 'var(--accent-cyan)' : 'var(--accent-indigo-light)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        fontSize: '9.5px',
                        border: dest.type === '3rdparty' ? '1px dashed rgba(245, 158, 11, 0.3)' : '1px solid rgba(14, 165, 233, 0.15)',
                        textTransform: dest.type === 'infra' ? 'lowercase' : 'none'
                      }}>
                        {dest.name} ({dest.type === '3rdparty' ? '3rd party' : dest.type})
                      </span>
                    </div>
                  </div>
                )}
                
                <div className="attr-row">
                  <span className="attr-row-label">Namespace</span>
                  <div style={{ marginTop: '2px' }}>
                    <span className="badge badge-ns" style={{ padding: '2px 8px' }}>{span.namespace || 'unknown'}</span>
                  </div>
                </div>

                {span.podName && (
                  <div className="attr-row">
                    <div className="attr-row-header">
                      <span className="attr-row-label">Pod Name</span>
                      <button className="attr-copy-btn" onClick={() => handleCopy('pod', span.podName!)}>
                        {copiedKey === 'pod' ? (
                          <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                        ) : (
                          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <div className="attr-row-value-mini">{span.podName}</div>
                  </div>
                )}

                {span.nodeName && (
                  <div className="attr-row">
                    <span className="attr-row-label">Node Name</span>
                    <div className="attr-row-value-mini">{span.nodeName}</div>
                  </div>
                )}

                <div className="attr-row">
                  <div className="attr-row-header">
                    <span className="attr-row-label">Span ID</span>
                    <button className="attr-copy-btn" onClick={() => handleCopy('spanId', span.spanId)}>
                      {copiedKey === 'spanId' ? (
                        <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                      ) : (
                        <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="attr-row-value-mini">{span.spanId}</div>
                </div>

                {span.parentSpanId && (
                  <div className="attr-row">
                    <div className="attr-row-header">
                      <span className="attr-row-label">Parent ID</span>
                      <button className="attr-copy-btn" onClick={() => handleCopy('parentSpanId', span.parentSpanId!)}>
                        {copiedKey === 'parentSpanId' ? (
                          <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                        ) : (
                          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <div className="attr-row-value-mini">{span.parentSpanId}</div>
                  </div>
                )}

                <div className="attr-row">
                  <span className="attr-row-label">Start Time</span>
                  <div className="attr-row-value-mini">{formattedStartTime}</div>
                </div>
              </div>
            </div>

            {/* Span Events/Logs if any */}
            {hasEvents && (
              <div>
                <h3 style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  Logs / Events ({span.events!.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {span.events!.map((ev, i) => (
                    <div key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--accent-indigo)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '11.5px', color: 'var(--text-primary)' }}>{ev.name}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {new Date(ev.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                        <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '8px', borderLeft: '2px solid var(--border-primary)', marginTop: '6px' }}>
                          {Object.entries(ev.attributes).map(([ek, evVal]) => (
                            <div key={ek}>
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{ek}: </span>
                              <span className="mono" style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{String(evVal)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Attributes */}
        {activeTab === 'attributes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Filter attributes..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="filter-select"
                style={{ width: '100%', fontSize: '11px', padding: '5px 8px 5px 28px', height: '28px' }}
              />
            </div>
            
            {groupedAttributes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
                No matching attributes.
              </div>
            ) : (
              groupedAttributes.map(([groupName, attrsList]) => (
                <div key={groupName} className="attr-group-card">
                  <h4 className="attr-group-title">{groupName}</h4>
                  <div className="attr-group-list">
                    {attrsList.map(([k, v]) => (
                      <div key={k} className="attr-row">
                        <div className="attr-row-header">
                          <span className="attr-row-key" title={k}>{k}</span>
                          <button 
                            className="attr-copy-btn"
                            onClick={() => handleCopy(k, String(v))}
                            title={copiedKey === k ? "Copied!" : "Copy value"}
                          >
                            {copiedKey === k ? (
                              <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                            ) : (
                              <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <div className="attr-row-value">
                          {String(v) || <span className="attr-empty-val">—</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab: Failure details */}
        {activeTab === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="failure-banner">
              <div className="failure-icon-wrapper">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="failure-title">Error Exception</span>
                <span className="failure-msg">{errorMsg}</span>
              </div>
            </div>

            {stackTrace && (
              <div className="stacktrace-container">
                <div className="stacktrace-header">
                  <span>Stack Trace</span>
                  <button 
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '9px', padding: '2px 8px', height: '20px', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8' }}
                    onClick={() => handleCopy('stacktrace', stackTrace)}
                  >
                    {copiedKey === 'stacktrace' ? 'Copied ✓' : 'Copy Stack Trace'}
                  </button>
                </div>
                <pre className="stacktrace-pre">
                  <code>{stackTrace}</code>
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Tab: Request & Response Payloads */}
        {activeTab === 'payload' && (() => {
          const details = getSpanPayloadDetails(span, traceDuration);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              
              {/* Context propagation diagram */}
              <div className="payload-context-card">
                <div className="payload-context-title">
                  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '6px' }}>
                    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3zM6 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z" />
                  </svg>
                  Trace Context Propagation (W3C)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
                  <div className="context-flow-row">
                    <div className="context-node parent">
                      <span className="node-label">Parent Span ID</span>
                      <span className="node-val">{span.parentSpanId ? span.parentSpanId : 'None (Root Span)'}</span>
                    </div>
                    <div className="context-arrow">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </div>
                    <div className="context-node current">
                      <span className="node-label">Current Span ID</span>
                      <span className="node-val">{span.spanId}</span>
                    </div>
                  </div>
                  
                  {details.contextPropagation?.traceparent && (
                    <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '10px', marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-tertiary)' }}>PROPAGATED traceparent HEADER</span>
                        <button className="attr-copy-btn" onClick={() => handleCopy('traceparent', details.contextPropagation!.traceparent!)}>
                          {copiedKey === 'traceparent' ? (
                            <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                          ) : (
                            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <div className="traceparent-value">{details.contextPropagation.traceparent}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Request Message Details */}
              <div className="payload-section-card request">
                <div className="payload-section-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span className={`method-badge ${details.request.method?.toLowerCase()}`}>
                      {details.request.method}
                    </span>
                    <span className="payload-section-title">Request Payload</span>
                  </div>
                  <span className="payload-target-url" title={details.request.url}>{details.request.url}</span>
                </div>
                
                <div style={{ padding: '14px' }}>
                  {/* Headers if http */}
                  {details.request.headers && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Transport Headers
                      </div>
                      <div className="headers-grid">
                        {Object.entries(details.request.headers).map(([k, v]) => (
                          <div key={k} className="header-row">
                            <span className="header-key" title={k}>{k}</span>
                            <span className="header-val" title={v}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Request Body / Statement */}
                  {details.type === 'db' ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Database Statement</span>
                        <button className="attr-copy-btn" onClick={() => handleCopy('sql', details.request.statement!)}>
                          {copiedKey === 'sql' ? (
                            <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                          ) : (
                            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <pre className="query-code-block">
                        <code>{details.request.statement}</code>
                      </pre>
                      {details.request.parameters && (
                        <div style={{ marginTop: '8px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Query Parameters</div>
                          <div className="parameters-list">
                            {details.request.parameters.map((p: any, idx: number) => (
                              <span key={idx} className="param-badge">${idx + 1}: "{p}"</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Body Content</span>
                        <button className="attr-copy-btn" onClick={() => handleCopy('reqBody', JSON.stringify(details.request.body, null, 2))}>
                          {copiedKey === 'reqBody' ? (
                            <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                          ) : (
                            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <pre className="payload-code-block">
                        <code>{JSON.stringify(details.request.body, null, 2)}</code>
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Response Message Details */}
              <div className="payload-section-card response">
                <div className="payload-section-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`status-badge ${span.status === 'ERROR' ? 'error' : 'ok'}`}>
                      {details.response.status}
                    </span>
                    <span className="payload-section-title">Response Payload</span>
                  </div>
                  <span className="payload-duration-tag">in {formatDuration(span.durationMs)}</span>
                </div>
                
                <div style={{ padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Body Content</span>
                    <button className="attr-copy-btn" onClick={() => handleCopy('respBody', JSON.stringify(details.response.body, null, 2))}>
                      {copiedKey === 'respBody' ? (
                        <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                      ) : (
                        <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <pre className="payload-code-block">
                    <code>{JSON.stringify(details.response.body, null, 2)}</code>
                  </pre>
                </div>
              </div>

            </div>
          );
        })()}

        {/* Tab: Raw JSON */}
        {activeTab === 'json' && (
          <div className="stacktrace-container">
            <div className="stacktrace-header">
              <span>Full Payload</span>
              <button 
                className="btn btn-ghost btn-sm" 
                style={{ fontSize: '9px', padding: '2px 8px', height: '20px', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8' }}
                onClick={() => handleCopy('json', JSON.stringify(span, null, 2))}
              >
                {copiedKey === 'json' ? 'Copied ✓' : 'Copy JSON'}
              </button>
            </div>
            <pre className="stacktrace-pre">
              {renderJson}
            </pre>
          </div>
        )}

      </div>
    </>
  );
}

export default function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'waterfall' | 'flame' | 'topology'>('waterfall');
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const navigate = useNavigate();

  // Sidebar drag-resize states
  const [sidebarWidth, setSidebarWidth] = useState(480);
  const [isDragging, setIsDragging] = useState(false);

  // Trace ID copy animation
  const [copiedTraceId, setCopiedTraceId] = useState(false);

  const handleCopyTraceId = () => {
    navigator.clipboard.writeText(trace?.traceId || '');
    setCopiedTraceId(true);
    setTimeout(() => setCopiedTraceId(false), 1500);
  };

  const startResize = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsDragging(true);

    const startWidth = sidebarWidth;
    const startX = mouseDownEvent.clientX;

    const doDrag = (mouseMoveEvent: MouseEvent) => {
      const deltaX = mouseMoveEvent.clientX - startX;
      const newWidth = startWidth - deltaX;
      if (newWidth >= 300 && newWidth <= window.innerWidth * 0.85) {
        setSidebarWidth(newWidth);
      }
    };

    const stopDrag = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };

    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  };

  useEffect(() => {
    if (selectedSpan) {
      document.body.classList.add('drawer-open');
    } else {
      document.body.classList.remove('drawer-open');
    }
    return () => {
      document.body.classList.remove('drawer-open');
    };
  }, [selectedSpan]);

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    
    api.getTrace(traceId)
      .then((traceData) => {
        setTrace(traceData);
        setSelectedSpan(null);
      })
      .catch(() => {
        setTrace(null);
      })
      .finally(() => setLoading(false));
  }, [traceId]);

  const uniqueTags = useMemo(() => {
    if (!trace || !trace.spans) return [];
    const map = new Map<string, string>();
    trace.spans.forEach(s => {
      if (s.attributes) {
        Object.entries(s.attributes).forEach(([k, v]) => {
          if (
            k.startsWith('http.') || 
            k.startsWith('db.system') || 
            k.startsWith('rpc.system') || 
            k.startsWith('rpc.method') || 
            k.startsWith('messaging.') || 
            k.startsWith('exception.type')
          ) {
            map.set(k, String(v));
          }
        });
      }
    });
    return Array.from(map.entries());
  }, [trace]);

  const uniqueDestinations = useMemo(() => {
    if (!trace || !trace.spans) return [];
    const destMap = new Map<string, { name: string; type: string; count: number }>();
    trace.spans.forEach(s => {
      const dest = getSpanDestination(s);
      if (dest.type) {
        const key = `${dest.type}:${dest.name}`;
        const existing = destMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          destMap.set(key, { name: dest.name, type: dest.type, count: 1 });
        }
      }
    });
    return Array.from(destMap.values());
  }, [trace]);

  if (loading) return <div className="empty-state"><div className="empty-state-title">Loading trace...</div></div>;
  if (!trace) return <div className="empty-state"><div className="empty-state-icon">❌</div><div className="empty-state-title">Trace not found</div></div>;

  const startMs = new Date(trace.startTime).getTime();

  return (
    <div className="animate-fade-in trace-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Trace Detail</h1>
      </div>

      <div className="trace-detail-layout">
        {/* Main Content Pane */}
        <div className="trace-detail-main-content">
          {/* Metadata Overview Panel */}
          <div className="trace-meta">
            <div className="trace-meta-item">
              <span className="trace-meta-label">Trace ID</span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span className="trace-meta-value mono" style={{ color: 'var(--accent-indigo-light)', fontSize: '11.5px' }} title={trace.traceId}>
                  {trace.traceId.slice(0, 16)}...
                </span>
                <button 
                  className="attr-copy-btn" 
                  onClick={handleCopyTraceId}
                  title={copiedTraceId ? "Copied!" : "Copy Full Trace ID"}
                  style={{ padding: '2px', height: '20px', width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {copiedTraceId ? (
                    <span style={{ fontSize: '9px', color: 'var(--accent-emerald)', fontWeight: 700 }}>✓</span>
                  ) : (
                    <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="trace-meta-item">
              <span className="trace-meta-label">Root Service</span>
              <span className="trace-meta-value" style={{ fontWeight: 600, marginTop: '2px' }}>{trace.serviceName}</span>
            </div>
            <div className="trace-meta-item">
              <span className="trace-meta-label">Namespace</span>
              <div style={{ marginTop: '2px' }}>
                <span className="badge badge-ns">{trace.namespace}</span>
              </div>
            </div>
            <div className="trace-meta-item">
              <span className="trace-meta-label">Duration</span>
              <span className="trace-meta-value" style={{ color: 'var(--accent-cyan)', fontWeight: 600, marginTop: '2px' }}>{trace.durationMs.toFixed(2)}ms</span>
            </div>
            <div className="trace-meta-item">
              <span className="trace-meta-label">Spans</span>
              <span className="trace-meta-value" style={{ fontWeight: 600, marginTop: '2px' }}>{trace.spanCount}</span>
            </div>
            <div className="trace-meta-item">
              <span className="trace-meta-label">Status</span>
              <div style={{ marginTop: '2px' }}>
                <span className={`badge ${trace.hasError ? 'badge-error' : 'badge-ok'}`}>
                  {trace.hasError ? 'ERROR' : 'OK'}
                </span>
              </div>
            </div>
          </div>

          {/* Trace Connections / Destinations Row */}
          {uniqueDestinations.length > 0 && (
            <div className="tags-container" style={{ marginTop: '12px', borderLeft: '3px solid var(--accent-indigo)' }}>
              <div className="tags-title" style={{ color: 'var(--accent-indigo-light)' }}>Trace Connections & Destinations ({uniqueDestinations.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {uniqueDestinations.map(d => (
                  <div key={d.name} className="tag-pill" style={{ borderColor: 'rgba(99, 102, 241, 0.2)' }} title={`${d.count} call(s) to ${d.name}`}>
                    <span className="tag-key" style={{ 
                      background: d.type === '3rdparty' ? 'rgba(245, 158, 11, 0.1)' : d.type === 'infra' ? 'rgba(14, 165, 233, 0.1)' : 'rgba(99, 102, 241, 0.08)',
                      color: d.type === '3rdparty' ? 'var(--accent-amber)' : d.type === 'infra' ? 'var(--accent-cyan)' : 'var(--accent-indigo-light)',
                      borderRight: '1px solid var(--border-primary)',
                      fontSize: '10px',
                      textTransform: d.type === 'infra' ? 'lowercase' : 'capitalize'
                    }}>
                      {d.type === '3rdparty' ? '3rd party' : d.type}
                    </span>
                    <span className="tag-val" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                      {d.name}
                      <span style={{ marginLeft: '4px', fontSize: '9px', opacity: 0.6, fontWeight: 'normal' }}>
                        x{d.count}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata Tags Row */}
          {uniqueTags.length > 0 && (
            <div className="tags-container">
              <div className="tags-title">Trace Metadata Tags ({uniqueTags.length})</div>
              <div className="tags-list">
                {uniqueTags.map(([k, v]) => (
                  <div key={k} className="tag-pill" title={`${k}: ${v}`}>
                    <span className="tag-key">{k}</span>
                    <span className="tag-val">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Visualization Card */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div className="card-title">Trace Visualization</div>
                <span className="text-sm text-muted">{trace.spanCount} spans total</span>
              </div>

              <div className="view-toggle-buttons">
                <button
                  className={`view-toggle-btn ${viewMode === 'waterfall' ? 'active' : ''}`}
                  onClick={() => setViewMode('waterfall')}
                >
                  Waterfall View
                </button>
                <button
                  className={`view-toggle-btn ${viewMode === 'flame' ? 'active' : ''}`}
                  onClick={() => setViewMode('flame')}
                >
                  Flame Graph
                </button>
                <button
                  className={`view-toggle-btn ${viewMode === 'topology' ? 'active' : ''}`}
                  onClick={() => setViewMode('topology')}
                >
                  Trace Topology
                </button>
              </div>
            </div>
            
            <div className="card-body">
              {viewMode === 'waterfall' ? (
                <SpanTimeline
                  spans={trace.spans || []}
                  traceStartTime={startMs}
                  traceDuration={trace.durationMs}
                  onSelectSpan={(span) => setSelectedSpan(span)}
                  selectedSpanId={selectedSpan?.spanId}
                />
              ) : viewMode === 'flame' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <FlameGraph
                    spans={trace.spans || []}
                    traceStartTime={startMs}
                    traceDuration={trace.durationMs}
                    onSelectSpan={(span) => setSelectedSpan(span)}
                  />
                  {!selectedSpan && (
                    <div className="selected-span-placeholder">
                      Click a span bar in the flame graph above to view its execution details and full telemetry attributes.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <TraceTopology
                    spans={trace.spans || []}
                    onSelectSpan={(span) => setSelectedSpan(span)}
                  />
                  {!selectedSpan && (
                    <div className="selected-span-placeholder">
                      Click a service node to view span details and trace through the call chain.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Details Sidebar Pane */}
        {selectedSpan && (
          <>
            <div className="trace-sidebar-backdrop" onClick={() => setSelectedSpan(null)} />
            <div 
              className={`trace-detail-sidebar ${isDragging ? 'resizing' : ''}`}
              style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
            >
              <div 
                className={`sidebar-drag-handle ${isDragging ? 'active' : ''}`} 
                onMouseDown={startResize} 
              >
                <div className="drag-grabber-pill">
                  <svg width="10" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="8" cy="5" r="2" fill="currentColor"/>
                    <circle cx="8" cy="12" r="2" fill="currentColor"/>
                    <circle cx="8" cy="19" r="2" fill="currentColor"/>
                    <circle cx="16" cy="5" r="2" fill="currentColor"/>
                    <circle cx="16" cy="12" r="2" fill="currentColor"/>
                    <circle cx="16" cy="19" r="2" fill="currentColor"/>
                  </svg>
                </div>
              </div>
              <SpanDrawerContent 
                span={selectedSpan} 
                traceDuration={trace.durationMs}
                onClose={() => setSelectedSpan(null)} 
              />
            </div>
          </>
        )}
      </div>

      <style>{`
        .view-toggle-buttons {
          display: inline-flex;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          padding: 3px;
          border-radius: 8px;
        }

        .view-toggle-btn {
          padding: 6px 12px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.15s ease;
        }

        .view-toggle-btn:hover {
          color: var(--text-primary);
        }

        .view-toggle-btn.active {
          background: var(--bg-secondary);
          color: var(--accent-indigo);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
        }

        .trace-detail {
          width: 100%;
          max-width: 100% !important;
          margin: 0;
          box-sizing: border-box;
          padding: 0 4px;
        }

        .trace-detail-layout {
          display: flex;
          gap: 16px;
          width: 100%;
          align-items: flex-start;
          transition: all 0.25s ease;
        }

        .trace-detail-main-content {
          flex: 1;
          min-width: 0;
          transition: all 0.25s ease;
        }

        .trace-detail-sidebar {
          background: var(--bg-secondary);
          border-left: 1px solid var(--border-primary);
          height: 100vh;
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: -10px 0 30px rgba(0, 0, 0, 0.15);
          z-index: 1001;
          animation: slideInRight 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          border-radius: 0;
        }

        .sidebar-drag-handle {
          position: absolute;
          left: -4px;
          top: 0;
          bottom: 0;
          width: 8px;
          cursor: col-resize;
          z-index: 200;
          background: transparent;
        }

        .sidebar-drag-handle::after {
          content: '';
          position: absolute;
          left: 3px;
          top: 0;
          bottom: 0;
          width: 2px;
          background-color: var(--border-primary);
          transition: background-color 0.15s, width 0.15s, left 0.15s;
        }

        .sidebar-drag-handle:hover::after,
        .sidebar-drag-handle.active::after {
          background-color: var(--accent-indigo);
          width: 4px;
          left: 2px;
          box-shadow: 0 0 8px var(--accent-indigo);
        }

        .trace-sidebar-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(15, 23, 42, 0.3);
          backdrop-filter: blur(4px);
          z-index: 1000;
          animation: fadeIn 0.25s ease-out;
        }

        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @media (max-width: 1024px) {
          .trace-detail-layout {
            flex-direction: column;
          }
          .trace-detail-sidebar {
            width: 100% !important;
            max-width: 500px !important;
            min-width: unset !important;
            box-shadow: -10px 0 30px rgba(0, 0, 0, 0.25);
          }
          .sidebar-drag-handle {
            display: none !important;
          }
          .trace-sidebar-backdrop {
            background: rgba(15, 23, 42, 0.4);
          }
        }

        /* New Drawer Features */
        .drag-grabber-pill {
          position: absolute;
          left: -7px;
          top: 50%;
          transform: translateY(-50%);
          width: 14px;
          height: 32px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--shadow-sm);
          color: var(--text-tertiary);
          transition: all 0.2s ease;
          pointer-events: none;
          z-index: 210;
        }

        .sidebar-drag-handle:hover .drag-grabber-pill,
        .sidebar-drag-handle.active .drag-grabber-pill {
          border-color: var(--accent-indigo);
          color: var(--accent-indigo);
          height: 36px;
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.25);
        }

        .drawer-breadcrumbs {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          margin-bottom: 4px;
          flex-wrap: wrap;
        }

        .breadcrumb-item {
          display: inline-flex;
          align-items: center;
          font-weight: 500;
        }

        .breadcrumb-item.service {
          font-weight: 700;
        }

        .breadcrumb-separator {
          color: var(--text-tertiary);
          font-weight: 400;
        }

        .drawer-close-btn {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: var(--shadow-sm);
          flex-shrink: 0;
        }

        .drawer-close-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
          border-color: var(--accent-indigo);
          transform: scale(1.05);
        }

        .drawer-close-btn:active {
          transform: scale(0.95);
        }

        /* Header elements inside the drawer */
        .drawer-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-primary);
          background: var(--bg-tertiary);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .drawer-tabs {
          display: flex;
          background: var(--bg-tertiary);
          padding: 6px;
          gap: 4px;
          border-bottom: 1px solid var(--border-primary);
        }

        .drawer-tab-btn {
          flex: 1;
          padding: 8px 12px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          text-align: center;
        }
        .drawer-tab-btn:hover {
          color: var(--text-primary);
          background: rgba(0, 0, 0, 0.03);
        }
        body.dark-theme .drawer-tab-btn:hover {
          background: rgba(255, 255, 255, 0.03);
        }
        .drawer-tab-btn.active {
          color: var(--accent-indigo) !important;
          background: var(--bg-secondary);
          box-shadow: var(--shadow-sm);
        }

        /* Overview Metric Card Styles */
        .overview-metric-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          padding: 14px 16px;
          border-radius: 8px;
          box-shadow: var(--shadow-sm);
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .overview-metric-card.duration {
          border-left: 3px solid var(--accent-cyan);
        }
        .overview-metric-card.status {
          border-left: 3px solid var(--accent-indigo);
        }
        .metric-card-label {
          font-size: 9.5px;
          color: var(--text-tertiary);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .metric-card-val {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-primary);
          font-family: var(--font-mono);
          margin-top: 4px;
        }
        .metric-card-sub {
          font-size: 10px;
          color: var(--text-secondary);
          margin-top: 2px;
        }

        /* Grouped Attribute Card Styles */
        .attr-group-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 12px;
          box-shadow: var(--shadow-sm);
        }
        .attr-group-title {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          background: var(--bg-tertiary);
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-primary);
        }
        .attr-group-list {
          display: flex;
          flex-direction: column;
        }
        .attr-row {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-primary);
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: background 0.15s ease;
        }
        .attr-row:last-child {
          border-bottom: none;
        }
        .attr-row:hover {
          background: var(--bg-hover);
        }
        .attr-row-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .attr-row-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-tertiary);
        }
        .attr-row-key {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-secondary);
          font-family: var(--font-mono);
          word-break: break-all;
        }
        .attr-row-value {
          font-size: 12px;
          color: var(--text-primary);
          font-family: var(--font-mono);
          word-break: break-all;
          background: var(--bg-tertiary);
          padding: 6px 10px;
          border-radius: 4px;
          border: 1px solid var(--border-primary);
          margin-top: 2px;
          white-space: pre-wrap;
        }
        .attr-row-value-mini {
          font-size: 11.5px;
          font-family: var(--font-mono);
          color: var(--text-primary);
          word-break: break-all;
          margin-top: 1px;
        }
        .attr-copy-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .attr-copy-btn:hover {
          color: var(--accent-indigo);
          background: var(--bg-active);
          transform: scale(1.1);
        }

        /* Failure Details Diagnostic Card Styles */
        .failure-banner {
          background: rgba(244, 63, 94, 0.04);
          border: 1px solid rgba(244, 63, 94, 0.15);
          border-left: 4px solid var(--accent-rose);
          border-radius: 8px;
          padding: 12px 16px;
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .failure-icon-wrapper {
          color: var(--accent-rose);
          flex-shrink: 0;
          margin-top: 2px;
        }
        .failure-title {
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--accent-rose);
          letter-spacing: 0.5px;
        }
        .failure-msg {
          font-size: 12.5px;
          color: var(--text-primary);
          font-weight: 600;
          word-break: break-all;
          margin-top: 2px;
        }
        .stacktrace-container {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          overflow: hidden;
          background: #090d16;
        }
        body.dark-theme .stacktrace-container {
          background: #070a10;
        }
        .stacktrace-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--bg-tertiary);
          padding: 6px 12px;
          font-size: 9.5px;
          font-weight: 700;
          color: var(--text-secondary);
          text-transform: uppercase;
          border-bottom: 1px solid var(--border-primary);
        }
        .stacktrace-pre {
          margin: 0;
          padding: 12px;
          overflow-x: auto;
          max-height: 400px;
        }
        .stacktrace-pre code {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: #f1f5f9;
          white-space: pre-wrap;
          word-break: break-all;
        }

        /* Header control overlay buttons */
        .control-btn-header {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-radius: 6px;
          font-size: 11px;
          font-weight: bold;
          transition: background 0.15s, border-color 0.15s;
        }

        .control-btn-header:hover {
          background: var(--bg-secondary);
          border-color: var(--accent-indigo);
        }

        .control-divider-header {
          width: 1px;
          height: 16px;
          background: var(--border-primary);
          margin: 0 4px;
        }

        .control-status-header {
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          padding-right: 4px;
        }

        .tags-container {
          margin: 16px 0;
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: 10px;
          padding: 12px 16px;
        }

        .tags-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-tertiary);
          margin-bottom: 10px;
          letter-spacing: 0.5px;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tag-pill {
          display: inline-flex;
          align-items: center;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          font-size: 11px;
          overflow: hidden;
          transition: all 0.15s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .tag-pill:hover {
          border-color: var(--accent-indigo);
          transform: translateY(-1px);
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
        }

        .tag-key {
          padding: 4px 8px;
          background: var(--bg-secondary);
          color: var(--text-secondary);
          font-weight: 500;
          border-right: 1px solid var(--border-primary);
        }

        .tag-val {
          padding: 4px 8px;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-weight: 600;
        }

        /* Top Grid Metadata Separators */
        .trace-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 16px;
          padding: 18px 24px;
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }
        @media (min-width: 768px) {
          .trace-meta {
            grid-template-columns: 2fr 1.2fr 1fr 1fr 1fr 1fr;
          }
        }
        .trace-meta-item {
          display: flex;
          flex-direction: column;
          justify-content: center;
          position: relative;
        }
        .trace-meta-item:not(:last-child)::after {
          content: '';
          position: absolute;
          right: -8px;
          top: 15%;
          bottom: 15%;
          width: 1px;
          background-color: var(--border-primary);
          opacity: 0.6;
        }
        @media (max-width: 767px) {
          .trace-meta-item:not(:last-child)::after {
            display: none;
          }
        }

        /* New Payload View Tab styles */
        .payload-context-card {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: var(--shadow-sm);
        }

        .payload-context-title {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          background: var(--bg-secondary);
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-primary);
          display: flex;
          align-items: center;
        }

        .context-flow-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 4px;
        }

        .context-node {
          flex: 1;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          padding: 8px 12px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .context-node .node-label {
          font-size: 9px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .context-node .node-val {
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }

        .context-node.current {
          border-color: var(--accent-indigo);
          box-shadow: 0 0 8px rgba(99, 102, 241, 0.1);
        }

        .context-arrow {
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .traceparent-value {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-secondary);
          background: var(--bg-secondary);
          padding: 6px 10px;
          border-radius: 4px;
          border: 1px solid var(--border-primary);
          margin-top: 4px;
          word-break: break-all;
        }

        .payload-section-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: var(--shadow-sm);
        }

        .payload-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--bg-tertiary);
          padding: 8px 14px;
          border-bottom: 1px solid var(--border-primary);
          gap: 12px;
        }

        .payload-section-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .payload-target-url {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: right;
          max-width: 60%;
        }

        .payload-duration-tag {
          font-size: 10.5px;
          color: var(--text-muted);
          font-weight: 500;
        }

        .method-badge {
          font-size: 9px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          border: 1px solid transparent;
        }

        .method-badge.get {
          background: rgba(14, 165, 233, 0.1);
          color: var(--accent-cyan);
          border-color: rgba(14, 165, 233, 0.2);
        }

        .method-badge.post {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.2);
        }

        .method-badge.query {
          background: rgba(139, 92, 246, 0.1);
          color: #8b5cf6;
          border-color: rgba(139, 92, 246, 0.2);
        }

        .status-badge {
          font-size: 9px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          border: 1px solid transparent;
        }

        .status-badge.ok, .status-badge.success {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.2);
        }

        .status-badge.error, .status-badge.failed {
          background: rgba(244, 63, 94, 0.1);
          color: #f43f5e;
          border-color: rgba(244, 63, 94, 0.2);
        }

        .headers-grid {
          display: flex;
          flex-direction: column;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 12px;
        }

        .header-row {
          display: flex;
          border-bottom: 1px solid var(--border-primary);
          padding: 6px 10px;
          font-size: 11px;
          gap: 12px;
        }

        .header-row:last-child {
          border-bottom: none;
        }

        .header-key {
          width: 140px;
          font-family: var(--font-mono);
          color: var(--text-secondary);
          font-weight: 600;
          flex-shrink: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .header-val {
          font-family: var(--font-mono);
          color: var(--text-primary);
          word-break: break-all;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
          flex: 1;
        }

        .payload-code-block, .query-code-block {
          margin: 0;
          padding: 10px 12px;
          background: #090d16;
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          overflow-x: auto;
          max-height: 240px;
        }

        body.dark-theme .payload-code-block, body.dark-theme .query-code-block {
          background: #070a10;
        }

        .payload-code-block code, .query-code-block code {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: #cbd5e1;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .query-code-block code {
          color: #facc15;
        }

        .parameters-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 4px;
        }

        .param-badge {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 9.5px;
        }
      `}</style>
    </div>
  );
}
