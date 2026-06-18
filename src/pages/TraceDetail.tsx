import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Trace, type Span, type DiagnosticReport } from '../api/client';
import SpanTimeline from '../components/SpanTimeline';

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
      const rw = (item.width / visibleWidth) * rect.width;

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
      const hasError = item.span.status === 'ERROR';

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
      ctx.fillStyle = baseColor;
      
      // Draw rounded rectangle for bar
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(rx, ry, rw, barHeight, 3);
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
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, Math.max(1, rw - 2), barHeight - 2);
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
          const rw = (item.width / visibleWidth) * rect.width;
          
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
          {hoveredSpan.span.status === 'ERROR' && (
            <div style={{ color: '#f43f5e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
              ⚠️ Execution Failed
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SpanDrawerContentProps {
  span: Span;
  traceDuration: number;
  onClose: () => void;
}

function SpanDrawerContent({ span, traceDuration, onClose }: SpanDrawerContentProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'attributes' | 'json' | 'error'>(
    span.status === 'ERROR' ? 'error' : 'overview'
  );
  const [filterQuery, setFilterQuery] = useState('');

  const formattedStartTime = useMemo(() => {
    try {
      return new Date(span.startTime).toLocaleString();
    } catch {
      return span.startTime;
    }
  }, [span.startTime]);

  const hasError = span.status === 'ERROR';
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
    const attrs = span.attributes || {};
    return (
      attrs['error.message'] ||
      attrs['error.msg'] ||
      attrs['exception.message'] ||
      attrs['status.message'] ||
      'Unknown operation failure.'
    );
  }, [span]);

  const stackTrace = useMemo(() => {
    const attrs = span.attributes || {};
    return attrs['exception.stacktrace'] || attrs['error.stack'] || null;
  }, [span]);

  // Filtered attributes
  const filteredAttributes = useMemo(() => {
    if (!span.attributes) return [];
    return Object.entries(span.attributes).filter(([k, v]) => {
      const q = filterQuery.toLowerCase();
      return k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q);
    });
  }, [span.attributes, filterQuery]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <>
      {/* Header */}
      <div className="drawer-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '85%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span 
              className="badge" 
              style={{ 
                background: getSvcColor(span.serviceName) + '20', 
                color: getSvcColor(span.serviceName), 
                fontWeight: 700, 
                fontSize: '11px',
                border: `1px solid ${getSvcColor(span.serviceName)}50`
              }}
            >
              {span.serviceName}
            </span>
            <span className="panel-span-name" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Kind: {span.kind}
            </span>
          </div>
          <h2 style={{ fontSize: '15px', fontWeight: 700, margin: '4px 0 0 0', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {span.name}
          </h2>
        </div>
        <button 
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px'
          }}
          title="Close details"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
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
        {hasError && (
          <button 
            className={`drawer-tab-btn ${activeTab === 'error' ? 'active' : ''}`}
            onClick={() => setActiveTab('error')}
            style={{ color: 'var(--accent-rose, #f43f5e)', borderBottomColor: activeTab === 'error' ? 'var(--accent-rose)' : 'transparent' }}
          >
            ⚠️ Failure Details
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Duration</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent-cyan)' }}>{formatDuration(span.durationMs)}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{(span.durationMs / traceDuration * 100).toFixed(1)}% of trace</div>
              </div>
              <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Status</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                  <span className={`badge ${span.status === 'ERROR' ? 'badge-error' : 'badge-ok'}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                    {span.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Infrastructure Details */}
            <div>
              <h3 style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px', borderBottom: '1px solid var(--border-primary)', paddingBottom: '4px' }}>
                Infrastructure Info
              </h3>
              <table className="attr-table">
                <tbody>
                  <tr>
                    <td className="attr-key">Namespace</td>
                    <td className="attr-val">
                      <span className="badge badge-ns">{span.namespace || 'unknown'}</span>
                    </td>
                  </tr>
                  {span.podName && (
                    <tr>
                      <td className="attr-key">Pod Name</td>
                      <td className="attr-val">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', wordBreak: 'break-all' }}>{span.podName}</span>
                          <button className="copy-btn-cell" onClick={() => copyToClipboard(span.podName!)}>📋</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {span.nodeName && (
                    <tr>
                      <td className="attr-key">Node Name</td>
                      <td className="attr-val">{span.nodeName}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="attr-key">Span ID</td>
                    <td className="attr-val">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-mono)' }}>
                        <span style={{ fontSize: '11px' }}>{span.spanId}</span>
                        <button className="copy-btn-cell" onClick={() => copyToClipboard(span.spanId)}>📋</button>
                      </div>
                    </td>
                  </tr>
                  {span.parentSpanId && (
                    <tr>
                      <td className="attr-key">Parent ID</td>
                      <td className="attr-val">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-mono)' }}>
                          <span style={{ fontSize: '11px' }}>{span.parentSpanId}</span>
                          <button className="copy-btn-cell" onClick={() => copyToClipboard(span.parentSpanId!)}>📋</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="attr-key">Start Time</td>
                    <td className="attr-val">{formattedStartTime}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Span Events/Logs if any */}
            {hasEvents && (
              <div>
                <h3 style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px', borderBottom: '1px solid var(--border-primary)', paddingBottom: '4px' }}>
                  Logs / Events ({span.events!.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {span.events!.map((ev, i) => (
                    <div key={i} style={{ background: 'var(--bg-tertiary)', padding: '8px 10px', borderRadius: '6px', borderLeft: '3px solid var(--accent-indigo)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text-primary)' }}>{ev.name}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {new Date(ev.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                        <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '4px', borderLeft: '1px solid var(--border-primary)' }}>
                          {Object.entries(ev.attributes).map(([ek, evVal]) => (
                            <div key={ek}>
                              <span style={{ color: 'var(--text-muted)' }}>{ek}: </span>
                              <span className="mono" style={{ color: 'var(--text-secondary)' }}>{String(evVal)}</span>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              type="text"
              placeholder="Filter attributes..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="filter-select"
              style={{ width: '100%', fontSize: '12px', padding: '6px 10px', marginBottom: '6px' }}
            />
            {filteredAttributes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
                No matching attributes.
              </div>
            ) : (
              <table className="attr-table">
                <tbody>
                  {filteredAttributes.map(([k, v]) => (
                    <tr key={k}>
                      <td className="attr-key" style={{ width: '160px', wordBreak: 'break-all' }}>{k}</td>
                      <td className="attr-val">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ wordBreak: 'break-all' }}>{String(v)}</span>
                          <button 
                            className="copy-btn-cell" 
                            style={{ flexShrink: 0 }}
                            onClick={() => copyToClipboard(String(v))}
                            title="Copy Value"
                          >
                            📋
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab: Failure details */}
        {activeTab === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(244, 63, 94, 0.08)', border: '1px solid rgba(244, 63, 94, 0.3)', padding: '12px 14px', borderRadius: '8px', borderLeft: '4px solid var(--accent-rose)' }}>
              <div style={{ color: 'var(--accent-rose)', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                ⚠️ Error Summary
              </div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{errorMsg}</div>
            </div>

            {stackTrace && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Execution Stack Trace
                </div>
                <pre style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', overflowX: 'auto', border: '1px solid rgba(255,255,255,0.05)', margin: 0 }}>
                  <code style={{ fontSize: '10.5px', fontFamily: 'var(--font-mono)', color: '#f1f5f9', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {stackTrace}
                  </code>
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Tab: Raw JSON */}
        {activeTab === 'json' && (
          <div style={{ background: '#0f172a', padding: '14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
              <button 
                className="btn btn-ghost btn-sm" 
                style={{ fontSize: '10px', padding: '2px 8px', color: '#cbd5e1', borderColor: 'rgba(255,255,255,0.2)' }}
                onClick={() => copyToClipboard(JSON.stringify(span, null, 2))}
              >
                Copy Full JSON
              </button>
            </div>
            <pre style={{ margin: 0 }}>
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
  const [viewMode, setViewMode] = useState<'waterfall' | 'flame'>('waterfall');
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const navigate = useNavigate();

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

  if (loading) return <div className="empty-state"><div className="empty-state-title">Loading trace...</div></div>;
  if (!trace) return <div className="empty-state"><div className="empty-state-icon">❌</div><div className="empty-state-title">Trace not found</div></div>;

  const startMs = new Date(trace.startTime).getTime();

  return (
    <div className="animate-fade-in trace-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Trace Detail</h1>
      </div>

      {/* Metadata Overview Panel */}
      <div className="trace-meta">
        <div className="trace-meta-item">
          <span className="trace-meta-label">Trace ID</span>
          <span className="trace-meta-value mono" style={{ color: 'var(--accent-indigo-light)' }}>{trace.traceId}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Root Service</span>
          <span className="trace-meta-value" style={{ fontWeight: 600 }}>{trace.serviceName}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Namespace</span>
          <span className="trace-meta-value"><span className="badge badge-ns">{trace.namespace}</span></span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Duration</span>
          <span className="trace-meta-value" style={{ color: 'var(--accent-cyan)' }}>{trace.durationMs.toFixed(2)}ms</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Spans</span>
          <span className="trace-meta-value">{trace.spanCount}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Status</span>
          <span className={`badge ${trace.hasError ? 'badge-error' : 'badge-ok'}`} style={{ marginTop: '2px' }}>
            {trace.hasError ? 'ERROR' : 'OK'}
          </span>
        </div>
      </div>

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
          </div>
        </div>
        
        <div className="card-body">
          {viewMode === 'waterfall' ? (
            <SpanTimeline
              spans={trace.spans || []}
              traceStartTime={startMs}
              traceDuration={trace.durationMs}
            />
          ) : (
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
          )}
        </div>
      </div>

      {/* Sliding Span Details Drawer Backdrop */}
      <div className={`drawer-backdrop ${selectedSpan ? 'open' : ''}`} onClick={() => setSelectedSpan(null)} />
      
      {/* Sliding Span Details Drawer Panel */}
      <div className={`span-drawer ${selectedSpan ? 'open' : ''}`}>
        {selectedSpan && (
          <SpanDrawerContent 
            span={selectedSpan} 
            traceDuration={trace.durationMs}
            onClose={() => setSelectedSpan(null)} 
          />
        )}
      </div>

      <style>{`
        .trace-detail {
          max-width: 1400px;
          margin: 0 auto;
        }

        .tags-container {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 20px;
        }
        
        .tags-title {
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          margin-bottom: 8px;
        }
        
        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        
        .tag-pill {
          display: inline-flex;
          align-items: center;
          font-size: 10.5px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          overflow: hidden;
          font-family: var(--font-mono);
        }
        
        .tag-key {
          padding: 2px 6px;
          background: rgba(99, 102, 241, 0.05);
          color: var(--accent-indigo-light);
          border-right: 1px solid var(--border-primary);
          font-weight: 500;
        }
        
        .tag-val {
          padding: 2px 6px;
          color: var(--text-primary);
          max-width: 600px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* View Toggle Buttons */
        .view-toggle-buttons {
          display: flex;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          padding: 4px;
          border-radius: 8px;
          gap: 4px;
        }
        
        .view-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
        }
        
        .view-toggle-btn:hover {
          color: var(--text-primary);
          background: var(--bg-tertiary);
        }
        
        .view-toggle-btn.active {
          background: var(--accent-indigo);
          color: #ffffff !important;
        }

        .selected-span-placeholder {
          text-align: center;
          padding: 24px;
          color: var(--text-muted);
          font-size: 12px;
          border: 1px dashed var(--border-primary);
          border-radius: 8px;
          background: var(--bg-secondary);
        }

        /* Reusable table helpers */
        .attr-table {
          width: 100%;
          border-collapse: collapse;
          background: var(--bg-secondary);
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid var(--border-primary);
        }
        .attr-table tr {
          border-bottom: 1px solid var(--border-primary);
        }
        .attr-table tr:last-child {
          border-bottom: none;
        }
        .attr-key {
          padding: 6px 12px;
          font-weight: 600;
          color: var(--accent-indigo-light);
          white-space: nowrap;
          background: rgba(99, 102, 241, 0.03);
          border-right: 1px solid var(--border-primary);
          font-size: 11px;
        }
        .attr-val {
          padding: 6px 12px;
          color: var(--text-primary);
          font-size: 11px;
        }

        /* Drawer backdrop overlay */
        .drawer-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(4px);
          z-index: 999;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .drawer-backdrop.open {
          opacity: 1;
          pointer-events: auto;
        }

        /* Span drawer container sliding from the right */
        .span-drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 520px;
          background: var(--bg-secondary);
          border-left: 1px solid var(--border-primary);
          box-shadow: -10px 0 30px rgba(0, 0, 0, 0.25);
          z-index: 1000;
          transform: translateX(100%);
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .span-drawer.open {
          transform: translateX(0);
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
          border-bottom: 1px solid var(--border-primary);
          background: var(--bg-secondary);
        }

        .drawer-tab-btn {
          flex: 1;
          padding: 12px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: color 0.15s, border-color 0.15s;
          text-align: center;
        }
        .drawer-tab-btn:hover {
          color: var(--text-primary);
        }
        .drawer-tab-btn.active {
          color: var(--accent-indigo);
          border-bottom-color: var(--accent-indigo);
        }

        /* Small copy button inside table cells */
        .copy-btn-cell {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 11px;
          padding: 2px 4px;
          border-radius: 4px;
          transition: transform 0.1s, background 0.1s;
        }
        .copy-btn-cell:hover {
          background: var(--bg-tertiary);
          transform: scale(1.15);
        }
        .copy-btn-cell:active {
          transform: scale(0.95);
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
      `}</style>
    </div>
  );
}
