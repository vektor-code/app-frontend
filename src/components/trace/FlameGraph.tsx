import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Span } from '../../entities';
import { isSpanError as isSpanError } from '../../utils/spanStatus';
import { getSpanOperationLabel } from '../../utils/spanLabels';
import { buildSpanForest } from '../../utils/spanTree';
import { formatDuration as formatDuration, getContrastColor as getContrastColor, getSvcColor as getSvcColor } from '../../utils/traceDisplay';
import { cssColorToRgba, readChartCanvasTheme } from '../../utils/chartTheme';
import { TraceDetailIcon } from './TraceDetailIcon';

interface SpanNode {
  span: Span;
  depth: number;
  children: SpanNode[];
}

function buildSpanTree(spans: Span[]): { rootNodes: SpanNode[]; maxDepth: number } {
  const forest = buildSpanForest(spans);
  const spanMap = new Map<string, SpanNode>();
  spans.forEach(s => {
    spanMap.set(s.spanId, { span: s, depth: 0, children: [] });
  });

  spans.forEach(s => {
    const node = spanMap.get(s.spanId)!;
    for (const child of forest.childrenOf(s.spanId)) {
      const childNode = spanMap.get(child.spanId);
      if (childNode && child.spanId !== s.spanId) {
        node.children.push(childNode);
      }
    }
  });

  const rootNodes: SpanNode[] = forest.roots.map(s => spanMap.get(s.spanId)!).filter(Boolean);
  let maxDepth = 0;

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

export function FlameGraph({ spans, traceStartTime, traceDuration, onSelectSpan }: FlameGraphProps) {
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
    const canvasTheme = readChartCanvasTheme(isDark);
    const errorColor = canvasTheme.critical;

    // 1. Draw Minimap Box
    ctx.save();
    ctx.fillStyle = cssColorToRgba(canvasTheme.elevated, isDark ? 0.45 : 0.7);
    ctx.strokeStyle = cssColorToRgba(canvasTheme.textMuted, 0.22);
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
    ctx.fillStyle = cssColorToRgba(canvasTheme.indigo, isDark ? 0.16 : 0.1);
    ctx.strokeStyle = canvasTheme.indigo;
    ctx.lineWidth = 1.5;
    ctx.fillRect(vx, my, vw, mh);
    ctx.strokeRect(vx, my, vw, mh);

    // Viewport handles (lines/rects on edges)
    ctx.fillStyle = canvasTheme.indigo;
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
    ctx.strokeStyle = canvasTheme.gridDot;
    ctx.lineWidth = 1;
    ctx.fillStyle = canvasTheme.textMuted;
    ctx.font = '500 10px "Plus Jakarta Sans", sans-serif';
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
        const operation = getSpanOperationLabel(item.span).toLowerCase();
        const matchesName = item.span.name.toLowerCase().includes(query) || operation.includes(query);
        const matchesService = item.span.serviceName.toLowerCase().includes(query);
        const matchesAttrs = item.span.attributes && Object.entries(item.span.attributes).some(([k, v]) => 
          k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)
        );
        matches = matchesName || matchesService || !!matchesAttrs;
      }

      ctx.save();
      const baseColor = hasError ? errorColor : getSvcColor(item.span.serviceName);
      ctx.fillStyle = isHovered ? adjustColorBrightness(baseColor, 18) : baseColor;
      ctx.globalAlpha = matches ? (isHovered ? 1 : 0.92) : 0.22;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(rx, ry, rw, barHeight, 3);
      } else {
        ctx.rect(rx, ry, rw, barHeight);
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      if (hasError) {
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(rx, ry, rw, barHeight, 3);
        } else {
          ctx.rect(rx, ry, rw, barHeight);
        }
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1.5;
        const step = 7;
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
        ctx.strokeStyle = errorColor;
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
        ctx.font = '650 10.5px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const operation = getSpanOperationLabel(item.span);
        const labelText = `${item.span.serviceName} · ${operation}`;
        const fitsLabel = ctx.measureText(labelText).width < rw - 12;
        const dispText = fitsLabel ? labelText : operation;
        
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
    <div ref={containerRef} className="trace-flame-panel">
      <div className="trace-flame-toolbar">
        <label className="trace-flame-search">
          <TraceDetailIcon name="search" />
          <input
            type="text"
            placeholder="Search & highlight spans..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} type="button">
              <TraceDetailIcon name="close" />
            </button>
          )}
        </label>

        <div className="trace-flame-controls">
          <button onClick={zoomIn} title="Zoom In"><TraceDetailIcon name="plus" /></button>
          <button onClick={zoomOut} title="Zoom Out"><TraceDetailIcon name="minus" /></button>
          <button onClick={resetZoom} title="Reset View"><TraceDetailIcon name="reset" /></button>
          <button onClick={toggleOrientation} title="Toggle Flame/Icicle"><TraceDetailIcon name="flame" /></button>
          <span>Zoom {(1 / (viewEnd - viewStart)).toFixed(1)}x</span>
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
          <div style={{ fontWeight: 600, fontSize: '11.5px' }}>{getSpanOperationLabel(hoveredSpan.span)}</div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '4px', paddingTop: '4px', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
            Duration: {formatDuration(hoveredSpan.span.durationMs)} ({(hoveredSpan.span.durationMs / traceDuration * 100).toFixed(1)}%)
          </div>
          {isSpanError(hoveredSpan.span) && (
            <div style={{ color: 'var(--chart-rose)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
              Execution Failed
            </div>
          )}
        </div>
      )}
    </div>
  );
}
