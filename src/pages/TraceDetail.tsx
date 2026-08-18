import React, { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUpRight,
  Box,
  Braces,
  Check,
  Clock3,
  Copy,
  EyeOff,
  Folder,
  Inbox,
  LayoutDashboard,
  Radio,
  Search,
  Server,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../api/client';
import type { DiagnosticReport, Span, Trace, TraceInvestigation } from '../entities';
import { isSpanError } from '../utils/spanStatus';
import { useTranslation } from '../utils/i18n';
import { createPortal } from 'react-dom';
import SpanTimeline, { getSpanDestination } from '../components/SpanTimeline';
import { explainSpanError } from '../utils/errorAnalysis';
import { isHttpMethodAttribute, normalizeHttpMethod } from '../utils/httpTelemetry';
import { analyzeTraceFailure, classificationLabel } from '../utils/traceFailureAnalyzer';
import { buildSpanForest } from '../utils/spanTree';
import { LANG_ICONS } from '../components/LanguageIcon';
import { TECH_LOGOS } from '../components/TechIcon';
import { getSpanDependency, getQueryText, getQuerySummary } from '../utils/dependency';
import { formatInvestigationState, formatObservationMessage, observationMark, observationTone } from '../utils/investigationDisplay';

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
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

type TraceViewMode = 'waterfall' | 'flame' | 'topology';
type TraceTone = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';
type TraceDetailIconName =
  | 'activity'
  | 'alert'
  | 'arrow'
  | 'back'
  | 'check'
  | 'close'
  | 'copy'
  | 'database'
  | 'flame'
  | 'focus'
  | 'graph'
  | 'latency'
  | 'minus'
  | 'network'
  | 'plus'
  | 'reset'
  | 'search'
  | 'server'
  | 'tags'
  | 'topology'
  | 'waterfall';

interface TraceServiceSummary {
  serviceName: string;
  namespace: string;
  spanCount: number;
  errorCount: number;
  durationMs: number;
  avgDurationMs: number;
}

function getTraceServiceSummary(spans: Span[]): TraceServiceSummary[] {
  const map = new Map<string, TraceServiceSummary>();
  spans.forEach(span => {
    const key = `${span.namespace || 'default'}/${span.serviceName}`;
    const item = map.get(key) || {
      serviceName: span.serviceName,
      namespace: span.namespace || 'default',
      spanCount: 0,
      errorCount: 0,
      durationMs: 0,
      avgDurationMs: 0,
    };
    item.spanCount += 1;
    item.durationMs += span.durationMs;
    if (isSpanError(span)) item.errorCount += 1;
    map.set(key, item);
  });
  return Array.from(map.values())
    .map(item => ({ ...item, avgDurationMs: item.spanCount > 0 ? item.durationMs / item.spanCount : 0 }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function getCriticalSpans(spans: Span[], limit = 5) {
  return [...spans]
    .sort((a, b) => {
      const errorDelta = Number(isSpanError(b)) - Number(isSpanError(a));
      if (errorDelta !== 0) return errorDelta;
      return b.durationMs - a.durationMs;
    })
    .slice(0, limit);
}

function getSpanKindSummary(spans: Span[]) {
  return spans.reduce<Record<string, number>>((acc, span) => {
    acc[span.kind] = (acc[span.kind] || 0) + 1;
    return acc;
  }, {});
}

function formatTraceNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function formatTracePercent(value: number) {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatTraceDate(value: string) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleString();
}

function getTraceHealthTone(trace: Trace): TraceTone {
  if (trace.hasError) return 'critical';
  if (trace.durationMs > 1500) return 'warning';
  return 'healthy';
}

function getSpanTone(span: Span): TraceTone {
  if (isSpanError(span)) return 'critical';
  if (span.durationMs > 1000) return 'warning';
  return 'neutral';
}

function getSpanOperationLabel(span: Span) {
  const attrs = span.attributes || {};
  const method = normalizeHttpMethod(attrs['http.request.method'] || attrs['http.method']);
  const path = attrs['http.route'] || attrs['url.path'] || attrs['http.target'] || attrs['url.full'] || attrs['http.url'];
  if (method && path) return `${method} ${path}`;
  if (method) return method;

  const dbSummary = getQuerySummary(attrs);
  if (dbSummary) return dbSummary;

  const rpcMethod = attrs['rpc.method'];
  if (rpcMethod) return String(rpcMethod);

  return span.name;
}

function getErrorCategoryLabel(category: string) {
  switch (category) {
    case 'http':
      return 'HTTP response';
    case 'db':
      return 'Database';
    case 'messaging':
      return 'Messaging';
    case 'timeout':
      return 'Timeout';
    case 'connection':
      return 'Connection';
    case 'exception':
      return 'Exception';
    default:
      return 'Application';
  }
}

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
  namespace?: string;
  type: 'service' | 'infra' | '3rdparty';
  errorCount: number;
  durationMs: number;
  callCount: number;
  spanIds: string[];
  x: number;
  y: number;
  iconKey?: string;
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
  ...TECH_LOGOS,
  ...LANG_ICONS,
  frontend: LANG_ICONS.javascript,
  backend: LANG_ICONS.go,
};

const getServiceLanguage = (serviceName: string, serviceSpans: Span[]): string => {
  const sName = serviceName.toLowerCase();
  if (sName.includes('php')) return 'php';
  if (
    sName.includes('java') || 
    sName.includes('spring') || 
    sName.includes('boot')
  ) return 'java';
  if (sName.includes('go') || sName.includes('golang') || sName.includes('gopkg')) return 'go';
  if (sName.includes('node') || sName.includes('express') || sName.includes('nestjs') || sName.includes('javascript') || sName.includes('typescript') || sName.includes('external')) return 'node';
  if (sName.includes('python') || sName.includes('django') || sName.includes('flask') || sName.includes('fastapi') || sName.includes('adapter')) return 'python';
  if (sName.includes('dotnet') || sName.includes('csharp') || sName.includes('aspnet')) return 'dotnet';
  if (sName.includes('ruby') || sName.includes('rails')) return 'ruby';
  if (sName.includes('rust')) return 'rust';

  for (const span of serviceSpans) {
    if (span.serviceName === serviceName && span.attributes) {
      const lang = span.attributes['telemetry.sdk.language'] || span.attributes['process.runtime.name'];
      if (lang) {
        const l = lang.toLowerCase();
        if (l.includes('php')) return 'php';
        if (l.includes('java') || l.includes('jvm') || l.includes('kotlin') || l.includes('scala')) return 'java';
        if (l.includes('go')) return 'go';
        if (l.includes('node') || l.includes('javascript') || l.includes('typescript') || l.includes('js')) return 'node';
        if (l.includes('python')) return 'python';
        if (l.includes('dotnet') || l.includes('c#') || l.includes('csharp')) return 'dotnet';
        if (l.includes('ruby')) return 'ruby';
        if (l.includes('rust')) return 'rust';
      }
    }
  }
  return 'unknown';
};

const getTopoIconKey = (name: string, spans: Span[] = []): string => {
  const n = name.toLowerCase();

  // 1. Check if it's a frontend service
  if (n.includes('frontend') || n.includes('ui') || n.includes('client')) {
    return 'frontend';
  }

  // 2. Check if it's a known database / infrastructure system
  if (n.includes('mygov')) return 'mygov';
  if (n.includes('redis')) return 'redis';
  if (n.includes('kafka')) return 'kafka';
  if (n.includes('rabbitmq') || n.includes('message_bus')) return 'rabbitmq';
  if (n.includes('apm')) return 'apm';
  if (n.includes('vault')) return 'vault';
  if (n.includes('ldap') || n.includes('active-directory') || n.includes('active directory')) return 'ldap';
  if (n.includes('prometheus')) return 'prometheus';
  if (n.includes('grafana')) return 'grafana';
  if (n.includes('elastic')) return 'elasticsearch';
  if (n.includes('minio')) return 'minio';
  if (n.includes('postgres') || n.includes('postgresql')) return 'postgres';
  if (n.includes('mysql')) return 'mysql';
  if (n.includes('mongo') || n.includes('mongodb')) return 'mongodb';
  if (n.includes('liqui') || n.includes('liquid') || n.includes('liquibase')) return 'liquibase';
  if (n.includes('nginx')) return 'nginx';
  if (n.includes('kong')) return 'kong';
  if (n.includes('clickhouse')) return 'clickhouse';
  if (n.includes('dns')) return 'dns';
  if (n.includes('database') || n.includes('db')) return 'database';
  if (n.includes('vm') || n.includes('virtual machine') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(n)) return 'vm';
  if (n.includes('bridge') || n.includes('gov.az')) return 'bridge';

  // 3. Dynamic lookup: Scan spans of this service to find dynamic language
  let detectedLang = '';
  for (const span of spans) {
    if (span.serviceName === name && span.attributes) {
      const lang = span.attributes['telemetry.sdk.language'] || span.attributes['process.runtime.name'];
      if (lang) {
        const l = lang.toLowerCase();
        if (l.includes('go') || l.includes('golang')) detectedLang = 'go';
        else if (l.includes('php')) detectedLang = 'php';
        else if (l.includes('java') || l.includes('jvm')) detectedLang = 'java';
        else if (l.includes('node') || l.includes('javascript') || l.includes('typescript') || l.includes('js')) detectedLang = 'node';
        else if (l.includes('python')) detectedLang = 'python';
        else if (l.includes('dotnet') || l.includes('c#') || l.includes('csharp')) detectedLang = 'dotnet';
        else if (l.includes('ruby')) detectedLang = 'ruby';
        else if (l.includes('rust')) detectedLang = 'rust';
      }
    }
  }

  if (detectedLang) {
    return detectedLang;
  }

  // 4. Name-based heuristics fallback
  if (n.includes('php')) return 'php';
  if (n.includes('java') || n.includes('spring') || n.includes('boot')) return 'java';
  if (n.includes('go') || n.includes('golang') || n.includes('gopkg')) return 'go';
  if (n.includes('node') || n.includes('express') || n.includes('nestjs') || n.includes('javascript') || n.includes('typescript') || n.includes('external')) return 'node';
  if (n.includes('python') || n.includes('django') || n.includes('flask') || n.includes('fastapi') || n.includes('adapter')) return 'python';
  if (n.includes('dotnet') || n.includes('csharp') || n.includes('aspnet')) return 'dotnet';
  if (n.includes('ruby') || n.includes('rails')) return 'ruby';
  if (n.includes('rust')) return 'rust';

  // 5. Default fallback to backend (go) as in ServiceMap
  return 'backend';
};

const getNamespaceColor = (namespace: string): string => {
  const colors = [
    '#6366f1', // Indigo
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#06b6d4', // Cyan
    '#f43f5e', // Rose
    '#3b82f6', // Blue
  ];
  let hash = 0;
  for (let i = 0; i < namespace.length; i++) {
    hash = namespace.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
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
      const namespace = span.namespace || 'default';
      const svcId = `svc:${namespace}/${span.serviceName}`;
      const isErr = isSpanError(span);

      if (!nodeMap.has(svcId)) {
        nodeMap.set(svcId, { 
          id: svcId, 
          name: span.serviceName, 
          namespace: namespace,
          type: 'service', 
          errorCount: 0, 
          durationMs: 0, 
          callCount: 0, 
          spanIds: [], 
          x: 0, 
          y: 0, 
          iconKey: getTopoIconKey(span.serviceName, spans)
        });
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
          const destId = `${dest.type}:${namespace}/${dest.name}`;
           if (!nodeMap.has(destId)) {
            nodeMap.set(destId, { 
              id: destId, 
              name: dest.name, 
              namespace: namespace,
              type: dest.type === 'infra' ? 'infra' : '3rdparty', 
              errorCount: 0, 
              durationMs: 0, 
              callCount: 0, 
              spanIds: [], 
              x: 0, 
              y: 0,
              iconKey: getTopoIconKey(dest.name, spans)
            });
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
        if (parent && (parent.serviceName !== span.serviceName || parent.namespace !== span.namespace)) {
          const pNs = parent.namespace || 'default';
          const pId = `svc:${pNs}/${parent.serviceName}`;
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

  // Compute bounding boxes for each namespace zone
  const namespaceZones = useMemo(() => {
    const groups: Record<string, typeof finalNodes> = {};
    finalNodes.forEach(node => {
      const ns = node.namespace || 'default';
      if (!groups[ns]) groups[ns] = [];
      groups[ns].push(node);
    });

    return Object.entries(groups).map(([ns, nsNodes]) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      nsNodes.forEach(node => {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
      });

      // Bounding box padding
      const paddingX = 90;
      const paddingY = 40;

      return {
        namespace: ns,
        x: minX - paddingX,
        y: minY - paddingY,
        width: (maxX - minX) + paddingX * 2,
        height: (maxY - minY) + paddingY * 2,
      };
    });
  }, [finalNodes]);

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
      className="trace-topology-panel"
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseDown={handleMouseDownBg}
      onWheel={handleWheel}
    >
      <div 
        className="trace-topology-controls"
        onMouseDown={e => e.stopPropagation()} // Prevent pan start when clicking buttons
      >
        <button 
          onClick={() => setZoom(z => Math.min(z * 1.15, 3))}
          title="Zoom In"
        >
          <TraceDetailIcon name="plus" />
        </button>
        <button 
          onClick={() => setZoom(z => Math.max(z / 1.15, 0.4))}
          title="Zoom Out"
        >
          <TraceDetailIcon name="minus" />
        </button>
        <button 
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setNodePositions({}); }}
          title="Reset layout and zoom"
        >
          <TraceDetailIcon name="reset" />
          Reset
        </button>
      </div>

      <svg viewBox="0 0 840 380" style={{ width: '100%', height: '100%', display: 'block', minHeight: '380px' }}>
        <defs>
          <pattern id="topo-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="rgba(255, 255, 255, 0.08)" />
          </pattern>
          <marker id="topo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 2 L 10 5 L 0 8 z" fill="#6366f1" opacity="0.8" />
          </marker>
          <marker id="topo-arrow-err" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 2 L 10 5 L 0 8 z" fill="#f43f5e" />
          </marker>
          <filter id="glow-err">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="topo-node-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e293b" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="0.98" />
          </linearGradient>
          <filter id="topo-card-shadow" x="-20%" y="-40%" width="140%" height="180%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#020617" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* Dynamic Grid Background */}
        <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#topo-grid)" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Namespace Zones */}
          {namespaceZones.map(zone => {
            const nsColor = getNamespaceColor(zone.namespace);
            return (
              <g key={`zone-${zone.namespace}`}>
                <rect
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  rx="12"
                  ry="12"
                  fill={`${nsColor}05`}
                  stroke={nsColor}
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <text
                  x={zone.x + 12}
                  y={zone.y + 22}
                  style={{
                    fontSize: '10px',
                    fontWeight: 'bold',
                    fill: nsColor,
                    fontFamily: 'var(--font-mono, monospace)',
                    letterSpacing: '0.5px',
                    opacity: 0.85
                  }}
                >
                  {zone.namespace.toUpperCase()} ZONE
                </text>
              </g>
            );
          })}

          {/* Edges */}
          {edges.map(edge => {
            const src = finalNodes.find(n => n.id === edge.source);
            const tgt = finalNodes.find(n => n.id === edge.target);
            if (!src || !tgt) return null;

            const x1 = src.x + 76, y1 = src.y;
            const x2 = tgt.x - 76, y2 = tgt.y;
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
                <foreignObject x={mx - 50} y={(y1 + y2) / 2 - 11} width="100" height="22" style={{ pointerEvents: 'none' }}>
                  <div style={{ 
                    background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                    border: `1px solid ${edge.hasError ? 'rgba(244, 63, 94, 0.55)' : 'rgba(129, 140, 248, 0.38)'}`,
                    borderRadius: '999px',
                    fontSize: '9.5px', 
                    fontFamily: 'var(--font-mono, monospace)', 
                    fontWeight: 'bold',
                    color: edge.hasError ? '#fb7185' : '#cbd5e1',
                    textAlign: 'center', 
                    lineHeight: '20px',
                    boxShadow: '0 8px 20px rgba(2, 6, 23, 0.32)'
                  }}>
                    x{edge.callCount} / {formatDuration(edge.avgDurationMs)}
                  </div>
                </foreignObject>
              </g>
            );
          })}

          {/* Nodes */}
          {finalNodes.map(node => {
            const hasErr = node.errorCount > 0;
            const isHov = hoveredNode?.id === node.id;
            const nodeCol = hasErr ? '#f43f5e' : node.durationMs >= 1000 ? '#f59e0b' : '#10b981';
            const nodeStatus = hasErr ? 'ERR' : node.durationMs >= 1000 ? 'SLOW' : 'OK';
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
                <rect x="-76" y="-30" width="152" height="60" rx="12" ry="12"
                  fill={hasErr ? 'rgba(244, 63, 94, 0.10)' : isHov ? 'rgba(129, 140, 248, 0.12)' : 'rgba(15, 23, 42, 0.32)'}
                  filter={hasErr || isHov ? 'url(#topo-card-shadow)' : undefined}
                  style={{ transition: 'fill 0.2s' }}
                />
                <rect x="-74" y="-28" width="148" height="56" rx="11" ry="11"
                  fill="url(#topo-node-fill)"
                  stroke={borderCol}
                  strokeWidth={isHov || hasErr ? 2 : 1.2}
                  filter={hasErr ? 'url(#glow-err)' : undefined}
                  style={{ transition: 'stroke 0.2s, stroke-width 0.2s, fill 0.2s' }}
                />
                <rect x="-74" y="-28" width="4" height="56" rx="2" ry="2" fill={nodeCol} />
                <rect x="-64" y="8" width="128" height="1" fill="rgba(148, 163, 184, 0.14)" />
                <g transform="translate(43, -21)" style={{ pointerEvents: 'none' }}>
                  <rect width="26" height="14" rx="7" fill={`${nodeCol}22`} stroke={`${nodeCol}55`} />
                  <text x="13" y="9.5" textAnchor="middle" style={{ fill: nodeCol, fontSize: '6.5px', fontWeight: 800, fontFamily: 'var(--font-sans)' }}>
                    {nodeStatus}
                  </text>
                </g>
                {/* Icon */}
                {(() => {
                  const iconKey = node.iconKey || getTopoIconKey(node.name, spans);
                  const iconUrl = iconKey ? TOPO_ICONS[iconKey] : '';
                  return iconUrl ? (
                    <foreignObject x="-62" y="-15" width="30" height="30">
                      <div style={{ width: '30px', height: '30px', borderRadius: '8px', border: `1px solid ${nodeCol}44`, background: `${nodeCol}16`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={iconUrl} alt={node.name} style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
                      </div>
                    </foreignObject>
                  ) : (
                    <text x="-51" y="5" textAnchor="middle" style={{ fontSize: '13px', fontWeight: 800, fill: nodeCol, userSelect: 'none' }}>
                      S
                    </text>
                  );
                })()}
                {/* Name */}
                <text x={node.iconKey || getTopoIconKey(node.name, spans) ? "-24" : "-34"} y="-6" style={{ fontSize: '10.5px', fontWeight: 800, fill: '#f8fafc', fontFamily: 'var(--font-sans)', pointerEvents: 'none' }}>
                  {node.name.length > 13 ? `${node.name.slice(0, 10)}...` : node.name}
                </text>
                {/* Duration */}
                <text x={node.iconKey || getTopoIconKey(node.name, spans) ? "-24" : "-34"} y="13" style={{ fontSize: '9.5px', fontWeight: 600, fill: hasErr ? '#fb7185' : '#94a3b8', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
                  {formatDuration(node.durationMs)} / x{node.callCount}
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
              const iconKey = hoveredNode.iconKey || getTopoIconKey(hoveredNode.name, spans);
              const iconUrl = iconKey ? TOPO_ICONS[iconKey] : '';
              return iconUrl ? (
                <img src={iconUrl} alt={hoveredNode.name} style={{ width: '16px', height: '16px', display: 'inline-block' }} />
              ) : (
                <span className="trace-topology-tooltip-icon">S</span>
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
              {hoveredNode.errorCount} error(s) detected here
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
            <div style={{ color: '#f43f5e', fontWeight: 700, marginTop: '4px' }}>Errors on this path</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

const SPAN_KIND_ICON: Record<string, LucideIcon> = {
  SERVER: Server,
  CLIENT: ArrowUpRight,
  INTERNAL: Box,
  PRODUCER: Radio,
  CONSUMER: Inbox,
};

function spanKindIcon(kind: string): LucideIcon {
  return SPAN_KIND_ICON[kind] || Clock3;
}

interface SpanDrawerContentProps {
  span: Span;
  traceDuration: number;
  onClose: () => void;
}

function DrawerCopyButton({ copied, onCopy, label }: { copied: boolean; onCopy: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="span-drawer-copy"
      title={copied ? 'Copied' : (label || 'Copy')}
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
      }}
    >
      {copied ? <Check size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={2.2} />}
    </button>
  );
}

function DrawerKvRow({
  label,
  value,
  mono = true,
  copied,
  onCopy,
  children,
}: {
  label: string;
  value?: ReactNode;
  mono?: boolean;
  copied?: boolean;
  onCopy?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="span-drawer-kv">
      <span className="span-drawer-kv-label">{label}</span>
      <div className="span-drawer-kv-value">
        {children || <span className={mono ? 'is-mono' : undefined}>{value ?? '—'}</span>}
        {onCopy && <DrawerCopyButton copied={!!copied} onCopy={onCopy} />}
      </div>
    </div>
  );
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

// getSpanPayloadDetails extracts ONLY real, captured telemetry from the span
// attributes — no fabricated payloads. When instrumentation did not record a
// body (the common case for auto-instrumentation), the UI says so honestly.
function getSpanPayloadDetails(span: Span, _traceDuration: number): PayloadDetails {
  const attrs = span.attributes || {};
  const dep = getSpanDependency(attrs);
  const dbSystem = (dep.kind === 'database' || dep.kind === 'cache') ? dep.system : '';
  const dbStatement = getQueryText(attrs) || attrs['db.query'] || '';

  const parseMaybeJson = (raw: string | undefined | null): any => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  };

  if (dbSystem || dbStatement) {
    let parameters: any = null;
    if (attrs['db.query.parameters']) {
      parameters = parseMaybeJson(attrs['db.query.parameters']);
    }
    const rows = attrs['db.response.returned_rows'] || attrs['db.rows_affected'] || '';
    return {
      type: 'db',
      title: `${dbSystem || 'Database'} Client Query`,
      request: {
        method: (attrs['db.operation'] || attrs['db.operation.name'] || 'QUERY').toUpperCase(),
        url: attrs['db.name'] || attrs['db.namespace'] || String(dbSystem || 'database'),
        statement: dbStatement || undefined,
        parameters,
      },
      response: {
        status: span.status === 'ERROR' ? 'FAILED' : 'SUCCESS',
        body: span.status === 'ERROR' && span.error ? { error: span.error } : null,
        result: rows ? `${rows} rows` : undefined,
      },
      contextPropagation: {
        carrier: 'none',
        currentSpanId: span.spanId,
      },
    };
  }

  const httpMethod = normalizeHttpMethod(attrs['http.request.method'] || attrs['http.method']);
  let httpUrl = attrs['url.full'] || attrs['http.url'] || '';
  if (!httpUrl) {
    const host = attrs['server.address'] || attrs['net.peer.name'] || attrs['http.host'] || '';
    const target = attrs['url.path'] || attrs['http.target'] || attrs['http.route'] || '';
    httpUrl = host ? `${attrs['url.scheme'] || 'http'}://${host}${target}` : (target || span.name);
  }

  // Real headers only: OTel-captured header attributes plus metadata the
  // instrumentation actually recorded.
  const reqHeaders: Record<string, string> = {};
  Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith('http.request.header.')) {
      reqHeaders[k.slice('http.request.header.'.length).replace(/_/g, '-')] = String(v);
    }
  });
  const ua = attrs['user_agent.original'] || attrs['http.user_agent'];
  if (ua && !reqHeaders['user-agent']) reqHeaders['user-agent'] = ua;
  const reqSize = attrs['http.request.body.size'] || attrs['http.request_content_length'];
  if (reqSize && !reqHeaders['content-length']) reqHeaders['content-length'] = `${reqSize} bytes`;

  // The W3C trace context this span actually carries/propagates.
  const traceparent = `00-${span.traceId}-${span.spanId}-01`;
  reqHeaders['traceparent'] = traceparent;

  // Bodies only when the instrumentation actually captured them (rare).
  const reqBody = parseMaybeJson(attrs['http.request.body'] || attrs['request.body']);
  let respBody = parseMaybeJson(attrs['http.response.body'] || attrs['response.body']);
  if (respBody === null && span.status === 'ERROR' && span.error) {
    respBody = { error: span.error };
  }

  const respStatus = attrs['http.response.status_code'] || attrs['http.status_code'] || (span.status === 'ERROR' ? 'ERROR' : 'OK');
  const respSize = attrs['http.response.body.size'] || attrs['http.response_content_length'] || '';

  return {
    type: 'http',
    title: `${httpMethod || 'HTTP'} Request to ${span.serviceName}`,
    request: {
      url: httpUrl,
      method: httpMethod || 'HTTP',
      headers: reqHeaders,
      body: reqBody,
    },
    response: {
      status: respStatus,
      body: respBody,
      result: respSize ? `${respSize} bytes` : undefined,
    },
    contextPropagation: {
      carrier: 'headers',
      traceparent,
      parentSpanId: span.parentSpanId,
      currentSpanId: span.spanId,
    },
  };
}

// Honest placeholder for payloads the instrumentation did not record.
function NotCaptured({ label }: { label: string }) {
  return (
    <div className="span-drawer-empty">
      <EyeOff size={14} strokeWidth={2.2} />
      <span>{label}</span>
    </div>
  );
}

function TraceDetailIcon({ name }: { name: TraceDetailIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'activity':
      return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
    case 'alert':
      return <svg {...common}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.6 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /></svg>;
    case 'arrow':
      return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case 'back':
      return <svg {...common}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>;
    case 'check':
      return <svg {...common}><path d="m20 6-11 11-5-5" /></svg>;
    case 'close':
      return <svg {...common}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
    case 'copy':
      return <svg {...common}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v10c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
    case 'flame':
      return <svg {...common}><path d="M12 22c4 0 7-2.7 7-6.7 0-2.6-1.4-4.6-3.4-6.8-.6 2-1.8 3.1-3.1 3.8.4-3.5-1.1-6.1-4-8.3.2 4.5-3.5 6.1-3.5 10.9C5 19 8 22 12 22Z" /></svg>;
    case 'focus':
      return <svg {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3" /><path d="M16 4h3a1 1 0 0 1 1 1v3" /><path d="M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'graph':
      return <svg {...common}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15v-4" /><path d="M12 15V8" /><path d="M16 15v-6" /></svg>;
    case 'latency':
      return <svg {...common}><path d="M9 2h6" /><path d="M12 6v5l3 2" /><circle cx="12" cy="14" r="8" /></svg>;
    case 'minus':
      return <svg {...common}><path d="M5 12h14" /></svg>;
    case 'network':
      return <svg {...common}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><path d="m8.4 8.2 2.4 6.1" /><path d="m15.6 8.2-2.4 6.1" /><path d="M9 6h6" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case 'reset':
      return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v6h6" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case 'server':
      return <svg {...common}><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01" /><path d="M7 17h.01" /></svg>;
    case 'tags':
      return <svg {...common}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><path d="M7.5 7.5h.01" /></svg>;
    case 'topology':
      return <svg {...common}><path d="M12 3v5" /><path d="M12 16v5" /><rect x="8" y="8" width="8" height="8" rx="2" /><path d="M3 12h5" /><path d="M16 12h5" /></svg>;
    case 'waterfall':
      return <svg {...common}><path d="M4 6h6" /><path d="M4 12h12" /><path d="M4 18h16" /></svg>;
    default:
      return <svg {...common}><path d="M4 12h16" /></svg>;
  }
}

function TraceMetricCard({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: TraceDetailIconName;
  label: string;
  value: string;
  detail: string;
  tone?: TraceTone;
}) {
  return (
    <div className={`trace-detail-metric-card ${tone}`}>
      <div className="trace-detail-metric-icon">
        <TraceDetailIcon name={icon} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

function TraceViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: TraceDetailIconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`trace-detail-view-button ${active ? 'active' : ''}`} onClick={onClick}>
      <TraceDetailIcon name={icon} />
      {label}
    </button>
  );
}

function TraceServiceCard({
  item,
  totalDuration,
}: {
  item: TraceServiceSummary;
  totalDuration: number;
}) {
  const color = getSvcColor(item.serviceName);
  const share = totalDuration > 0 ? (item.durationMs / totalDuration) * 100 : 0;
  return (
    <div className={`trace-service-card ${item.errorCount > 0 ? 'critical' : ''}`}>
      <div className="trace-service-card-top">
        <span style={{ background: color }} />
        <div>
          <strong title={item.serviceName}>{item.serviceName}</strong>
          <em>{item.namespace}</em>
        </div>
        <b>{formatTracePercent(share)}</b>
      </div>
      <div className="trace-service-card-bar">
        <i style={{ width: `${Math.max(3, share)}%`, background: color }} />
      </div>
      <div className="trace-service-card-meta">
        <span>{formatTraceNumber(item.spanCount)} spans</span>
        <span>{formatDuration(item.avgDurationMs)} avg</span>
        <span>{formatTraceNumber(item.errorCount)} errors</span>
      </div>
    </div>
  );
}

function TraceSpanChip({ span, onClick }: { span: Span; onClick: () => void }) {
  const tone = getSpanTone(span);
  return (
    <button className={`trace-span-chip ${tone}`} onClick={onClick}>
      <div>
        <strong title={span.name}>{span.name}</strong>
        <span>{span.serviceName}</span>
      </div>
      <em>{formatDuration(span.durationMs)}</em>
    </button>
  );
}

function payloadStatusTone(status: number | string | undefined, isError: boolean): 'ok' | 'error' {
  const n = Number(status);
  if (Number.isFinite(n) && n >= 400) return 'error';
  return isError ? 'error' : 'ok';
}

function SpanDrawerContent({ span, traceDuration, onClose }: SpanDrawerContentProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'attributes' | 'payload' | 'json' | 'error'>(
    isSpanError(span) ? 'error' : 'overview'
  );
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const KindIcon = spanKindIcon(span.kind);
  const attrCount = span.attributes ? Object.keys(span.attributes).length : 0;
  const hasError = isSpanError(span);
  const hasEvents = Boolean(span.events && span.events.length > 0);
  const dest = getSpanDestination(span);
  const serviceColor = getSvcColor(span.serviceName);
  const shareOfTrace = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 0;

  useEffect(() => {
    setActiveTab(prev => (prev === 'error' && !isSpanError(span) ? 'overview' : prev));
    setFilterQuery('');
  }, [span.spanId]);

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const formattedStartTime = useMemo(() => {
    try {
      return new Date(span.startTime).toLocaleString();
    } catch {
      return span.startTime;
    }
  }, [span.startTime]);

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

  const stackTrace = useMemo(() => {
    const attrs = span.attributes || {};
    const directStack = attrs['exception.stacktrace'] || attrs['error.stack'] || attrs['stacktrace'] || attrs['stack'] || attrs['error.stacktrace'];
    if (directStack) return String(directStack);
    if (span.events) {
      const excEvent = span.events.find(e => e.name === 'exception' || e.name === 'error');
      if (excEvent && excEvent.attributes) {
        const evStack = excEvent.attributes['exception.stacktrace'] || excEvent.attributes['error.stack'] || excEvent.attributes['stacktrace'];
        if (evStack) return String(evStack);
      }
    }
    return null;
  }, [span]);

  const filteredAttributes = useMemo(() => {
    if (!span.attributes) return [];
    return Object.entries(span.attributes).filter(([k, v]) => {
      const q = filterQuery.toLowerCase();
      return k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q);
    });
  }, [span.attributes, filterQuery]);

  const groupedAttributes = useMemo(() => {
    const groups: Record<string, [string, string][]> = {};
    filteredAttributes.forEach(([k, v]) => {
      const parts = k.split('.');
      const groupName = parts.length > 1 ? parts[0].toUpperCase() : 'GENERAL';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push([k, v]);
    });
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === 'GENERAL') return 1;
      if (b[0] === 'GENERAL') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredAttributes]);

  const tabs: { id: typeof activeTab; label: string; Icon: LucideIcon; badge?: number; tone?: 'error' }[] = [
    { id: 'overview', label: t('Overview'), Icon: LayoutDashboard },
    { id: 'attributes', label: t('Attributes'), Icon: Tags, badge: attrCount },
    { id: 'payload', label: t('Request'), Icon: ArrowLeftRight },
    ...(hasError ? [{ id: 'error' as const, label: t('Failure'), Icon: AlertCircle, tone: 'error' as const }] : []),
    { id: 'json', label: t('JSON'), Icon: Braces },
  ];

  return (
    <>
      <div className="span-drawer-header">
        <div className="span-drawer-title-row">
          <span
            className={`span-drawer-kind-tile ${hasError ? 'is-error' : ''}`}
            style={hasError ? undefined : { color: serviceColor, background: `color-mix(in srgb, ${serviceColor} 14%, var(--bg-secondary))`, borderColor: `color-mix(in srgb, ${serviceColor} 28%, var(--border-primary))` }}
          >
            <KindIcon size={18} strokeWidth={2.1} />
          </span>
          <div className="span-drawer-heading">
            <span className="span-drawer-kicker">{t('Span')} · {span.kind.toLowerCase()}</span>
            <h2 title={span.name}>{span.name}</h2>
            <p className="span-drawer-subtitle">
              <span style={{ color: serviceColor }}>{span.serviceName}</span>
              <span className="span-drawer-dot">·</span>
              <Folder size={11} strokeWidth={2.2} />
              {span.namespace || 'default'}
            </p>
          </div>
          <button type="button" className="span-drawer-close" onClick={onClose} title={t('Close details')}>
            <X size={15} strokeWidth={2.3} />
          </button>
        </div>
        <div className="span-drawer-chips">
          <span className={`span-drawer-chip ${hasError ? 'is-error' : 'is-ok'}`}>
            {hasError ? t('Error') : t('OK')}
          </span>
          <span className="span-drawer-chip">
            <Clock3 size={11} strokeWidth={2.2} />
            {formatDuration(span.durationMs)}
          </span>
          <span className="span-drawer-chip">{shareOfTrace.toFixed(1)}% {t('of trace')}</span>
        </div>
      </div>

      <nav className="span-drawer-tabs" aria-label={t('Span sections')}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`${activeTab === tab.id ? 'active' : ''} ${tab.tone === 'error' ? 'is-error' : ''}`}
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.Icon size={14} strokeWidth={activeTab === tab.id ? 2.4 : 2} />
            <span>{tab.label}</span>
            {tab.badge != null ? <em>{tab.badge}</em> : null}
          </button>
        ))}
      </nav>

      <div className="span-drawer-body">
        {activeTab === 'overview' && (
          <div className="span-drawer-stack">
            <div className="span-drawer-metrics">
              <article>
                <small>{t('Duration')}</small>
                <strong>{formatDuration(span.durationMs)}</strong>
                <em>{shareOfTrace.toFixed(1)}% {t('of trace')}</em>
              </article>
              <article className={hasError ? 'is-error' : 'is-ok'}>
                <small>{t('Status')}</small>
                <strong>{hasError ? t('Error') : t('OK')}</strong>
                <em>{span.kind.toLowerCase()}</em>
              </article>
              <article>
                <small>{t('Kind')}</small>
                <strong className="is-row">
                  <KindIcon size={16} strokeWidth={2.2} />
                  {span.kind.toLowerCase()}
                </strong>
                <em>{span.serviceName}</em>
              </article>
            </div>

            <section className="span-drawer-card">
              <h3>{t('Identity')}</h3>
              <div className="span-drawer-kv-list">
                {dest.type && (
                  <DrawerKvRow label={t('Destination')} mono={false}>
                    <span className={`span-drawer-dest is-${dest.type}`}>
                      {dest.name}
                      <em>{dest.type === '3rdparty' ? t('3rd party') : dest.type}</em>
                    </span>
                  </DrawerKvRow>
                )}
                <DrawerKvRow label={t('Namespace')} value={span.namespace || t('unknown')} />
                {span.podName && (
                  <DrawerKvRow label={t('Pod')} value={span.podName} copied={copiedKey === 'pod'} onCopy={() => handleCopy('pod', span.podName!)} />
                )}
                {span.nodeName && <DrawerKvRow label={t('Node')} value={span.nodeName} />}
                <DrawerKvRow label={t('Span ID')} value={span.spanId} copied={copiedKey === 'spanId'} onCopy={() => handleCopy('spanId', span.spanId)} />
                {span.parentSpanId && (
                  <DrawerKvRow label={t('Parent ID')} value={span.parentSpanId} copied={copiedKey === 'parentSpanId'} onCopy={() => handleCopy('parentSpanId', span.parentSpanId!)} />
                )}
                <DrawerKvRow label={t('Start')} value={formattedStartTime} mono={false} />
              </div>
            </section>

            {hasEvents && (
              <section className="span-drawer-card">
                <h3>{t('Logs / Events')} <em>{span.events!.length}</em></h3>
                <div className="span-drawer-events">
                  {span.events!.map((ev, i) => (
                    <article key={`${ev.name}-${i}`}>
                      <header>
                        <strong>{ev.name}</strong>
                        <time>{new Date(ev.timestamp).toLocaleTimeString()}</time>
                      </header>
                      {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                        <div className="span-drawer-kv-list nested">
                          {Object.entries(ev.attributes).map(([ek, evVal]) => (
                            <DrawerKvRow key={ek} label={ek} value={String(evVal)} />
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'attributes' && (
          <div className="span-drawer-stack">
            <div className="span-drawer-search">
              <Search size={13} strokeWidth={2.3} />
              <input
                type="text"
                placeholder={t('Filter attributes...')}
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
              />
            </div>
            {groupedAttributes.length === 0 ? (
              <div className="span-drawer-empty">{t('No matching attributes.')}</div>
            ) : (
              groupedAttributes.map(([groupName, attrsList]) => (
                <section key={groupName} className="span-drawer-card">
                  <h3>{groupName} <em>{attrsList.length}</em></h3>
                  <div className="span-drawer-kv-list">
                    {attrsList.map(([k, v]) => (
                      <DrawerKvRow
                        key={k}
                        label={k}
                        value={String(v) || '—'}
                        copied={copiedKey === k}
                        onCopy={() => handleCopy(k, String(v))}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )}

        {activeTab === 'error' && (() => {
          const explanation = explainSpanError(span);
          return (
            <div className="span-drawer-stack">
              <div className="span-drawer-failure">
                <span className="span-drawer-failure-icon"><AlertCircle size={16} strokeWidth={2.2} /></span>
                <div>
                  <div className="span-drawer-failure-title">
                    <strong>{explanation.title}</strong>
                    <em>{t(getErrorCategoryLabel(explanation.category))}</em>
                  </div>
                  <p>{explanation.what}</p>
                </div>
              </div>
              <div className="span-drawer-metrics">
                <article>
                  <small>{t('Operation')}</small>
                  <strong title={getSpanOperationLabel(span)}>{getSpanOperationLabel(span)}</strong>
                </article>
                <article>
                  <small>{t('Service')}</small>
                  <strong>{span.serviceName}</strong>
                </article>
                <article>
                  <small>{t('Duration')}</small>
                  <strong>{formatDuration(span.durationMs)}</strong>
                  <em>{explanation.target || dest.name || t('not captured')}</em>
                </article>
              </div>
              {explanation.evidence.length > 0 && (
                <section className="span-drawer-card">
                  <h3>{t('Evidence from span')}</h3>
                  <div className="span-drawer-kv-list">
                    {explanation.evidence.map(([k, v]) => (
                      <DrawerKvRow key={k} label={k} value={copiedKey === 'ev-' + k ? t('copied') : v} copied={copiedKey === 'ev-' + k} onCopy={() => handleCopy('ev-' + k, v)} />
                    ))}
                  </div>
                </section>
              )}
              {explanation.rawMessage && explanation.rawMessage !== explanation.title && (
                <section className="span-drawer-card">
                  <h3>{t('Raw error message')}</h3>
                  <pre className="span-drawer-pre">{explanation.rawMessage}</pre>
                </section>
              )}
              {stackTrace && (
                <section className="span-drawer-card">
                  <h3>
                    {t('Stack Trace')}
                    <DrawerCopyButton copied={copiedKey === 'stacktrace'} onCopy={() => handleCopy('stacktrace', stackTrace)} label={t('Copy Stack Trace')} />
                  </h3>
                  <pre className="span-drawer-pre is-code"><code>{stackTrace}</code></pre>
                </section>
              )}
            </div>
          );
        })()}

        {activeTab === 'payload' && (() => {
          const details = getSpanPayloadDetails(span, traceDuration);
          const responseTone = payloadStatusTone(details.response.status, hasError);
          return (
            <div className="span-drawer-stack">
              <section className="span-drawer-card">
                <h3>{t('Trace context')}</h3>
                <div className="span-drawer-kv-list">
                  <DrawerKvRow
                    label={t('Parent span')}
                    value={span.parentSpanId || t('None (Root Span)')}
                    copied={copiedKey === 'parentSpanId'}
                    onCopy={span.parentSpanId ? () => handleCopy('parentSpanId', span.parentSpanId!) : undefined}
                  />
                  <DrawerKvRow
                    label={t('This span')}
                    value={span.spanId}
                    copied={copiedKey === 'spanId'}
                    onCopy={() => handleCopy('spanId', span.spanId)}
                  />
                  {details.contextPropagation?.traceparent && (
                    <DrawerKvRow
                      label="traceparent"
                      value={details.contextPropagation.traceparent}
                      copied={copiedKey === 'traceparent'}
                      onCopy={() => handleCopy('traceparent', details.contextPropagation!.traceparent!)}
                    />
                  )}
                </div>
              </section>

              <section className="span-drawer-card">
                <h3>
                  {details.request.method ? (
                    <span className={`method-badge ${details.request.method.toLowerCase()}`}>{details.request.method}</span>
                  ) : null}
                  {t('Request')}
                </h3>
                {details.request.url && (
                  <div className="span-drawer-url">
                    <span title={details.request.url}>{details.request.url}</span>
                    <DrawerCopyButton copied={copiedKey === 'reqUrl'} onCopy={() => handleCopy('reqUrl', details.request.url!)} />
                  </div>
                )}
                {details.request.headers && Object.keys(details.request.headers).length > 0 && (
                  <div className="span-drawer-kv-list nested">
                    {Object.entries(details.request.headers).map(([k, v]) => (
                      <DrawerKvRow key={k} label={k} value={v} />
                    ))}
                  </div>
                )}
                {details.type === 'db' ? (
                  <div className="span-drawer-body-block">
                    <div className="span-drawer-block-label">
                      {t('Database Statement')}
                      {details.request.statement && (
                        <DrawerCopyButton copied={copiedKey === 'sql'} onCopy={() => handleCopy('sql', details.request.statement!)} />
                      )}
                    </div>
                    {details.request.statement ? (
                      <pre className="query-code-block"><code>{details.request.statement}</code></pre>
                    ) : (
                      <NotCaptured label={t("Query text not captured — enable db.statement capture in the client's tracing settings.")} />
                    )}
                    {Array.isArray(details.request.parameters) && details.request.parameters.length > 0 && (
                      <div className="parameters-list">
                        {details.request.parameters.map((p: unknown, idx: number) => (
                          <span key={idx} className="param-badge">${idx + 1}: "{String(p)}"</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="span-drawer-body-block">
                    <div className="span-drawer-block-label">
                      {t('Body')}
                      {details.request.body != null && (
                        <DrawerCopyButton copied={copiedKey === 'reqBody'} onCopy={() => handleCopy('reqBody', JSON.stringify(details.request.body, null, 2))} />
                      )}
                    </div>
                    {details.request.body != null ? (
                      <pre className="payload-code-block">
                        <code>{typeof details.request.body === 'string' ? details.request.body : JSON.stringify(details.request.body, null, 2)}</code>
                      </pre>
                    ) : (
                      <NotCaptured label={t('Body not captured — instrumentation records metadata only (URL, headers, size, timing).')} />
                    )}
                  </div>
                )}
              </section>

              <section className="span-drawer-card">
                <h3>
                  <span className={`status-badge ${responseTone}`}>{details.response.status}</span>
                  {t('Response')}
                  <em className="span-drawer-h3-meta">{t('in')} {formatDuration(span.durationMs)}</em>
                </h3>
                {details.response.result && (
                  <p className="span-drawer-note">{t('Recorded response size:')} <strong>{details.response.result}</strong></p>
                )}
                <div className="span-drawer-body-block">
                  <div className="span-drawer-block-label">
                    {t('Body')}
                    {details.response.body != null && (
                      <DrawerCopyButton copied={copiedKey === 'respBody'} onCopy={() => handleCopy('respBody', JSON.stringify(details.response.body, null, 2))} />
                    )}
                  </div>
                  {details.response.body != null ? (
                    <pre className="payload-code-block">
                      <code>{typeof details.response.body === 'string' ? details.response.body : JSON.stringify(details.response.body, null, 2)}</code>
                    </pre>
                  ) : (
                    <NotCaptured label={t('Body not captured — the status, size and timing above are real.')} />
                  )}
                </div>
              </section>
            </div>
          );
        })()}

        {activeTab === 'json' && (
          <section className="span-drawer-card">
            <h3>
              {t('Full payload')}
              <DrawerCopyButton copied={copiedKey === 'json'} onCopy={() => handleCopy('json', JSON.stringify(span, null, 2))} label={t('Copy JSON')} />
            </h3>
            <pre className="span-drawer-pre is-code">{renderJson}</pre>
          </section>
        )}
      </div>
    </>
  );
}

export default function TraceDetail() {
  const { t } = useTranslation();
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [investigation, setInvestigation] = useState<TraceInvestigation | null>(null);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [viewMode, setViewMode] = useState<TraceViewMode>('waterfall');
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const navigate = useNavigate();

  // Sidebar drag-resize states
  const [sidebarWidth, setSidebarWidth] = useState(540);
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
    setInvestigation(null);
    setInvestigationLoading(false);
    
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
            map.set(k, isHttpMethodAttribute(k) ? normalizeHttpMethod(v) : String(v));
          }
        });
      }
    });
    return Array.from(map.entries());
  }, [trace]);

  // All namespaces this trace crosses, in first-seen (time) order
  const traceNamespaces = useMemo(() => {
    if (!trace || !trace.spans) return [];
    const seen = new Set<string>();
    const list: string[] = [];
    [...trace.spans]
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .forEach(s => {
        const ns = s.namespace || 'default';
        if (!seen.has(ns)) { seen.add(ns); list.push(ns); }
      });
    return list;
  }, [trace]);

  // Spans whose parent was never captured (uninstrumented hop / sampling /
  // disabled namespace) — the flow renders but with a visible gap.
  const spanForest = useMemo(() => buildSpanForest(trace?.spans || []), [trace]);
  const brokenLinkSpans = spanForest.midTreeMissing;

  // Error spans with human-readable explanations for the problems panel
  const errorSpans = useMemo(() => {
    if (!trace || !trace.spans) return [];
    return trace.spans
      .filter(s => isSpanError(s))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .map(span => ({ span, explanation: explainSpanError(span) }));
  }, [trace]);

  const failureDiagnosis = useMemo(() => {
    if (!trace) return null;
    return trace.failureDiagnosis ?? analyzeTraceFailure(trace);
  }, [trace]);

  useEffect(() => {
    if (!traceId || !failureDiagnosis) return;
    const plan = failureDiagnosis.live;
    if (plan && !plan.recommended) {
      setInvestigation({
        traceId,
        status: 'skipped',
        levelReached: 0,
        skipReason: plan.reason,
        conclusion: 'Kubernetes verification not required',
      });
      setInvestigationLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setInvestigationLoading(true);
    const poll = () => {
      api.getTraceInvestigation(traceId)
        .then((report) => {
          if (cancelled) return;
          setInvestigation(report);
          if (report.status === 'pending') {
            setInvestigationLoading(true);
            timer = setTimeout(poll, 2000);
            return;
          }
          setInvestigationLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setInvestigation({
            traceId,
            status: 'unavailable',
            levelReached: 0,
            skipReason: 'Live Kubernetes verification is not available for this cluster',
          });
          setInvestigationLoading(false);
        });
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [traceId, failureDiagnosis]);

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

  const serviceSummary = useMemo(() => {
    return trace?.spans ? getTraceServiceSummary(trace.spans) : [];
  }, [trace]);

  const criticalSpans = useMemo(() => {
    return trace?.spans ? getCriticalSpans(trace.spans) : [];
  }, [trace]);

  const spanKindSummary = useMemo(() => {
    return trace?.spans ? getSpanKindSummary(trace.spans) : {};
  }, [trace]);

  const rootOperation = trace?.rootSpan?.name || trace?.spans?.[0]?.name || 'Trace';
  const erroredServiceCount = serviceSummary.filter(item => item.errorCount > 0).length;
  const dominantService = serviceSummary[0];
  const traceTone = trace ? getTraceHealthTone(trace) : 'neutral';

  if (loading) return <div className="empty-state"><div className="empty-state-title">{t('Loading trace...')}</div></div>;
  if (!trace) return <div className="empty-state"><div className="empty-state-title">{t('Trace not found')}</div></div>;

  const startMs = new Date(trace.startTime).getTime();

  return (
    <div className="trace-detail-page animate-fade-in">
      <section className={`trace-detail-hero ${traceTone}`}>
        <div className="trace-detail-hero-main">
          <button className="trace-detail-back-button" onClick={() => navigate(-1)}>
            <TraceDetailIcon name="back" />
            {t('Back to Explorer')}
          </button>
          <span className="trace-detail-eyebrow">
            <TraceDetailIcon name="network" />
            {t('Trace detail')}
          </span>
          <h1 title={rootOperation}>{rootOperation}</h1>
          <div className="trace-detail-id-row">
            <code title={trace.traceId}>{trace.traceId}</code>
            <button onClick={handleCopyTraceId} title={copiedTraceId ? t('Copied!') : t('Copy Full Trace ID')}>
              <TraceDetailIcon name={copiedTraceId ? 'check' : 'copy'} />
            </button>
          </div>
        </div>
        <div className="trace-detail-hero-side">
          <span className={`trace-detail-status ${trace.hasError ? 'critical' : 'healthy'}`}>
            <i />
            {trace.hasError ? 'ERROR' : 'OK'}
          </span>
          <strong>{formatDuration(trace.durationMs)}</strong>
          <em>{formatTraceDate(trace.startTime)}</em>
        </div>
      </section>

      <div className="trace-detail-layout">
        <div className="trace-detail-main-content">
          <section className="trace-detail-metric-grid">
            <TraceMetricCard
              icon="server"
              label={t('Root Service')}
              value={trace.serviceName}
              detail={dominantService ? `${dominantService.namespace} / ${formatTraceNumber(dominantService.spanCount)} spans` : (trace.namespace || 'default')}
              tone="info"
            />
            <TraceMetricCard
              icon="waterfall"
              label={t('Spans')}
              value={formatTraceNumber(trace.spanCount)}
              detail={brokenLinkSpans.length > 0
                ? `${formatTraceNumber(brokenLinkSpans.length)} ${t('broken parent links')}`
                : t('Complete span tree')}
              tone={brokenLinkSpans.length > 0 ? 'warning' : 'healthy'}
            />
            <TraceMetricCard
              icon="latency"
              label={t('Duration')}
              value={formatDuration(trace.durationMs)}
              detail={`${formatTraceNumber(criticalSpans.length)} ${t('slow/error spans')}`}
              tone={trace.durationMs > 1500 ? 'warning' : 'healthy'}
            />
            <TraceMetricCard
              icon="alert"
              label={t('Errors')}
              value={formatTraceNumber(errorSpans.length)}
              detail={`${formatTraceNumber(erroredServiceCount)} ${t('affected services')}`}
              tone={trace.hasError ? 'critical' : 'healthy'}
            />
          </section>

          <section className="trace-detail-context-grid">
            <div className="trace-detail-context-panel">
              <div className="trace-detail-panel-title">
                <span>{t('Namespace Path')}</span>
                <strong>{formatTraceNumber(traceNamespaces.length || 1)}</strong>
              </div>
              <div className="trace-detail-namespace-flow">
                {(traceNamespaces.length > 0 ? traceNamespaces : [trace.namespace]).map((ns, idx) => (
                  <React.Fragment key={ns}>
                    {idx > 0 && <em>{'->'}</em>}
                    <span>{ns}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="trace-detail-context-panel">
              <div className="trace-detail-panel-title">
                <span>{t('Span Kinds')}</span>
                <strong>{Object.keys(spanKindSummary).length}</strong>
              </div>
              <div className="trace-detail-kind-list">
                {Object.entries(spanKindSummary).map(([kind, count]) => (
                  <span key={kind}>{kind.toLowerCase()} <b>{count}</b></span>
                ))}
              </div>
            </div>
          </section>

          {brokenLinkSpans.length > 0 ? (
            <div className="trace-detail-alert warning compact">
              <TraceDetailIcon name="alert" />
              <span>
                <strong>{t('Incomplete flow')}</strong>
                {brokenLinkSpans.length} span{brokenLinkSpans.length > 1 ? 's' : ''} reference{brokenLinkSpans.length > 1 ? '' : 's'} a parent that was not captured
                ({[...new Set(brokenLinkSpans.map(s => `${s.namespace || 'default'}/${s.serviceName}`))].slice(0, 3).join(', ')}).
              </span>
            </div>
          ) : !(failureDiagnosis || errorSpans.length > 0) ? (
            <div className="trace-detail-alert ok compact">
              <TraceDetailIcon name="check" />
              <span>
                <strong>{t('Complete span tree')}</strong>
                {t('Every parent in this trace was captured.')}
              </span>
            </div>
          ) : null}

          {/* Detected Problems Panel — existing error summary, augmented with diagnosis */}
          {(failureDiagnosis || errorSpans.length > 0) && (() => {
            const affectedServices = new Set(errorSpans.map(item => item.span.serviceName)).size;
            const primaryError = errorSpans[0];
            const diagnosisTone = failureDiagnosis?.classification === 'INSTRUMENTATION_ANOMALY'
              ? 'anomaly'
              : failureDiagnosis?.classification === 'UNKNOWN'
                ? 'unknown'
                : 'critical';
            const diagnosisEvidence = (failureDiagnosis?.evidence || []).filter(item => item.code !== 'span_tree_complete');
            const k8sObserved = investigation?.observations?.filter(item => item.kind === 'observed') || [];
            const showK8s = investigation
              ? investigation.status !== 'skipped'
              : investigationLoading;
            return (
              <div className={`trace-detail-problems-panel ${diagnosisTone}`}>
                <div className="problems-panel-header">
                  <div>
                    <TraceDetailIcon name="alert" />
                    <span>{t('Trace Error Summary')}</span>
                  </div>
                  <div className="problems-panel-pills">
                    {failureDiagnosis ? (
                      <>
                        <em>{classificationLabel(failureDiagnosis.classification)}</em>
                        <em className={`conf ${failureDiagnosis.confidence.toLowerCase()}`}>{failureDiagnosis.confidence}</em>
                      </>
                    ) : (
                      <em>{formatTraceNumber(errorSpans.length)} {t('failed spans')} / {formatTraceNumber(affectedServices)} {t('services')}</em>
                    )}
                  </div>
                </div>

                {failureDiagnosis ? (
                  <div className="problems-diagnosis">
                    <h3>{failureDiagnosis.title}</h3>
                    <p>{failureDiagnosis.summary}</p>
                    {diagnosisEvidence.length > 0 && (
                      <ul className="diagnosis-evidence">
                        {diagnosisEvidence.map(item => (
                          <li key={`${item.code}-${item.spanId || ''}`}>{item.message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="problems-diagnosis">
                    <h3>{primaryError.explanation.title}</h3>
                    <p>{primaryError.explanation.what}</p>
                  </div>
                )}

                {showK8s && (
                  <div className="diagnosis-k8s">
                    <div className="diagnosis-k8s-head">
                      <span>{t('Kubernetes verification')}</span>
                      {investigation?.status === 'pending' && investigationLoading && <em>{t('Investigating…')}</em>}
                      {investigation?.cached && <em>{t('Cached')}</em>}
                      {investigation?.referencedBy && investigation.referencedBy > 1 && (
                        <em>{investigation.referencedBy} {t('traces share this result')}</em>
                      )}
                    </div>
                    {(!investigation || investigation.status === 'pending') && investigationLoading && !k8sObserved.length && (
                      <span className="diagnosis-k8s-pending">
                        {investigation?.status === 'pending'
                          ? t('Investigating…')
                          : t('Live verification available')}
                      </span>
                    )}
                    {investigation && investigation.status !== 'pending' && (
                      <>
                        {k8sObserved.map(item => {
                          const tone = observationTone(item);
                          return (
                            <div key={`obs-${item.code}-${item.pod || ''}`} className={`diagnosis-k8s-check ${tone}`}>
                              <b aria-hidden="true">{observationMark(tone)}</b>
                              <span>{formatObservationMessage(item)}</span>
                            </div>
                          );
                        })}
                        {!k8sObserved.length && investigation.checks?.map(check => {
                          const tone = observationTone({ code: check.code, ok: check.ok, message: check.detail });
                          return (
                            <div key={`${check.level}-${check.code}-${check.pod || ''}`} className={`diagnosis-k8s-check ${tone}`}>
                              <b aria-hidden="true">{observationMark(tone)}</b>
                              <span>{formatObservationMessage({ code: check.code, message: check.detail })}</span>
                            </div>
                          );
                        })}
                        {(investigation.originalState || investigation.currentState || investigation.inference || investigation.conclusion) && (
                          <div className="diagnosis-k8s-states">
                            {investigation.originalState && (
                              <span>
                                {t('Original failure')}
                                <strong>{formatInvestigationState(investigation.originalState)}</strong>
                              </span>
                            )}
                            {investigation.currentState && (
                              <span>
                                {t('Current state')}
                                <strong>{formatInvestigationState(investigation.currentState)}</strong>
                              </span>
                            )}
                            {(investigation.inference || investigation.conclusion) && (
                              <span className="wide">
                                {t('Inference')}
                                <strong>
                                  {investigation.inference || investigation.conclusion}
                                  {investigation.confidence ? ` · ${investigation.confidence}` : ''}
                                </strong>
                              </span>
                            )}
                          </div>
                        )}
                        {investigation.status === 'unavailable' && <span className="diagnosis-k8s-pending">{investigation.skipReason}</span>}
                        {investigation.status === 'rate_limited' && <span className="diagnosis-k8s-pending">{investigation.skipReason}</span>}
                        {investigation.status === 'expired' && <span className="diagnosis-k8s-pending">{investigation.skipReason}</span>}
                      </>
                    )}
                  </div>
                )}

                {errorSpans.length > 0 && (
                  <div className="problems-span-list">
                    {errorSpans.length > 1 && (
                      <span className="problems-span-label">{formatTraceNumber(errorSpans.length)} {t('failed spans')}</span>
                    )}
                    {errorSpans.map(({ span, explanation }, index) => (
                      <button
                        key={span.spanId}
                        className={`problem-card ${selectedSpan?.spanId === span.spanId ? 'selected' : ''}`}
                        onClick={() => setSelectedSpan(span)}
                        title={t('Open full failure details')}
                      >
                        <div className="problem-card-top">
                          <span className="problem-severity">#{index + 1}</span>
                          <span className="problem-service" style={{ color: getSvcColor(span.serviceName) }}>
                            <span className="problem-service-dot" style={{ background: getSvcColor(span.serviceName) }} />
                            {span.serviceName}
                          </span>
                          {explanation.target && (
                            <>
                              <span className="problem-arrow">{'->'}</span>
                              <span className="problem-target" title={explanation.target}>{explanation.target}</span>
                            </>
                          )}
                          <span className="problem-title-badge">{t(getErrorCategoryLabel(explanation.category))}</span>
                        </div>
                        <div className="problem-main">
                          <strong>{explanation.title}</strong>
                          <span>{explanation.what}</span>
                        </div>
                        <div className="problem-meta-grid">
                          <span>{t('Operation')} <strong>{getSpanOperationLabel(span)}</strong></span>
                          <span>{t('Duration')} <strong>{formatDuration(span.durationMs)}</strong></span>
                          <span>{t('Kind')} <strong>{span.kind.toLowerCase()}</strong></span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <section className="trace-detail-insights-grid">
            <div className="trace-detail-insight-panel">
              <div className="trace-detail-panel-title">
                <span>{t('Service Contribution')}</span>
                <strong>{formatTraceNumber(serviceSummary.length)}</strong>
              </div>
              <div className="trace-service-card-list">
                {serviceSummary.slice(0, 6).map(item => (
                  <TraceServiceCard key={`${item.namespace}/${item.serviceName}`} item={item} totalDuration={trace.durationMs} />
                ))}
              </div>
            </div>

            <div className="trace-detail-insight-panel">
              <div className="trace-detail-panel-title">
                <span>{t('Critical Spans')}</span>
                <strong>{formatTraceNumber(criticalSpans.length)}</strong>
              </div>
              <div className="trace-span-chip-list">
                {criticalSpans.map(span => (
                  <TraceSpanChip key={span.spanId} span={span} onClick={() => setSelectedSpan(span)} />
                ))}
              </div>
            </div>
          </section>

          {(uniqueDestinations.length > 0 || uniqueTags.length > 0) && (
            <section className="trace-detail-tags-grid">
              {uniqueDestinations.length > 0 && (
                <div className="trace-detail-tag-panel">
                  <div className="trace-detail-panel-title">
                    <span>{t('Connections & Destinations')}</span>
                    <strong>{formatTraceNumber(uniqueDestinations.length)}</strong>
                  </div>
                  <div className="trace-detail-chip-cloud">
                    {uniqueDestinations.map(d => (
                      <div key={`${d.type}:${d.name}`} className={`trace-detail-chip ${d.type === '3rdparty' ? 'external' : d.type || 'neutral'}`} title={`${d.count} call(s) to ${d.name}`}>
                        <span>{d.type === '3rdparty' ? t('3rd party') : d.type}</span>
                        <strong>{d.name}</strong>
                        <em>x{d.count}</em>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uniqueTags.length > 0 && (
                <div className="trace-detail-tag-panel">
                  <div className="trace-detail-panel-title">
                    <span>{t('Trace Metadata Tags')}</span>
                    <strong>{formatTraceNumber(uniqueTags.length)}</strong>
                  </div>
                  <div className="trace-detail-chip-cloud">
                    {uniqueTags.map(([k, v]) => (
                      <div key={k} className={`trace-detail-chip ${isHttpMethodAttribute(k) ? 'method' : ''}`} title={`${k}: ${v}`}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="trace-detail-visualization-panel">
            <div className="trace-detail-visualization-header">
              <div>
                <span>{t('Trace Visualization')}</span>
                <h2>
                  {viewMode === 'waterfall'
                    ? t('Waterfall View')
                    : viewMode === 'flame'
                      ? t('Flame Graph')
                      : t('Trace Topology')}
                </h2>
                <p>{formatTraceNumber(trace.spanCount)} {t('spans total')} / {formatDuration(trace.durationMs)}</p>
              </div>

              <div className="trace-detail-view-toggle">
                <TraceViewButton
                  active={viewMode === 'waterfall'}
                  icon="waterfall"
                  label={t('Waterfall')}
                  onClick={() => setViewMode('waterfall')}
                />
                <TraceViewButton
                  active={viewMode === 'flame'}
                  icon="flame"
                  label={t('Flame')}
                  onClick={() => setViewMode('flame')}
                />
                <TraceViewButton
                  active={viewMode === 'topology'}
                  icon="topology"
                  label={t('Topology')}
                  onClick={() => setViewMode('topology')}
                />
              </div>
            </div>
            
            <div className="trace-detail-visualization-body">
              {viewMode === 'waterfall' ? (
                <SpanTimeline
                  spans={trace.spans || []}
                  traceStartTime={startMs}
                  traceDuration={trace.durationMs}
                  onSelectSpan={(span) => setSelectedSpan(span)}
                  selectedSpanId={selectedSpan?.spanId}
                />
              ) : viewMode === 'flame' ? (
                <div className="trace-detail-view-stack">
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
                <div className="trace-detail-view-stack">
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
          </section>
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
          background: var(--bg-primary);
          border-left: 1px solid var(--border-primary);
          height: 100vh;
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: -18px 0 48px rgba(10, 16, 32, 0.16);
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
          background: rgba(12, 18, 34, 0.38);
          backdrop-filter: blur(3px);
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

        .span-drawer-header {
          padding: 16px 20px 12px;
          border-bottom: 1px solid var(--border-primary);
          background: var(--bg-secondary);
        }

        .span-drawer-title-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .span-drawer-kind-tile {
          width: 36px;
          height: 36px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border-radius: 10px;
          border: 1px solid var(--border-primary);
          background: var(--bg-tertiary);
          color: var(--accent-indigo);
        }

        .span-drawer-kind-tile.is-error {
          color: var(--accent-rose);
          background: color-mix(in srgb, var(--accent-rose) 12%, var(--bg-secondary));
          border-color: color-mix(in srgb, var(--accent-rose) 28%, var(--border-primary));
        }

        .span-drawer-heading {
          min-width: 0;
          flex: 1;
        }

        .span-drawer-kicker {
          display: block;
          margin-bottom: 3px;
          color: var(--text-tertiary);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .span-drawer-heading h2 {
          margin: 0;
          color: var(--text-primary);
          font-size: 16px;
          font-weight: 750;
          line-height: 1.3;
          letter-spacing: -0.02em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .span-drawer-subtitle {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 4px 0 0;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
        }

        .span-drawer-dot {
          color: var(--text-muted);
          font-weight: 500;
        }

        .span-drawer-close {
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          background: var(--bg-primary);
          color: var(--text-secondary);
          cursor: pointer;
        }

        .span-drawer-close:hover {
          color: var(--text-primary);
          border-color: var(--border-secondary);
          background: var(--bg-hover);
        }

        .span-drawer-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 12px;
        }

        .span-drawer-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          border: 1px solid var(--border-primary);
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 700;
        }

        .span-drawer-chip.is-ok {
          color: var(--accent-emerald);
          background: color-mix(in srgb, var(--accent-emerald) 10%, transparent);
          border-color: color-mix(in srgb, var(--accent-emerald) 22%, transparent);
        }

        .span-drawer-chip.is-error {
          color: var(--accent-rose);
          background: color-mix(in srgb, var(--accent-rose) 10%, transparent);
          border-color: color-mix(in srgb, var(--accent-rose) 22%, transparent);
        }

        .span-drawer-tabs {
          display: flex;
          gap: 2px;
          overflow-x: auto;
          padding: 0 12px;
          border-bottom: 1px solid var(--border-primary);
          background: var(--bg-secondary);
        }

        .span-drawer-tabs button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex: 0 0 auto;
          border: 0;
          border-bottom: 2px solid transparent;
          background: transparent;
          color: var(--text-tertiary);
          cursor: pointer;
          padding: 11px 10px;
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
        }

        .span-drawer-tabs button em {
          display: inline-flex;
          align-items: center;
          min-height: 18px;
          padding: 0 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent-indigo) 12%, var(--bg-secondary));
          color: var(--accent-indigo);
          font-size: 10px;
          font-style: normal;
          font-weight: 700;
        }

        .span-drawer-tabs button:hover,
        .span-drawer-tabs button.active {
          color: var(--text-primary);
        }

        .span-drawer-tabs button.active {
          border-bottom-color: var(--accent-indigo);
          color: var(--accent-indigo);
        }

        .span-drawer-tabs button.is-error {
          color: var(--accent-rose);
        }

        .span-drawer-tabs button.is-error.active {
          border-bottom-color: var(--accent-rose);
        }

        .span-drawer-tabs button.is-error em {
          background: color-mix(in srgb, var(--accent-rose) 12%, var(--bg-secondary));
          color: var(--accent-rose);
        }

        .span-drawer-body {
          flex: 1;
          overflow: auto;
          padding: 16px 18px 28px;
        }

        .span-drawer-stack {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .span-drawer-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
          gap: 10px;
        }

        .span-drawer-metrics article {
          min-width: 0;
          padding: 12px;
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--bg-tertiary) 70%, transparent), var(--bg-secondary));
        }

        .span-drawer-metrics small {
          display: block;
          margin-bottom: 6px;
          color: var(--text-tertiary);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .span-drawer-metrics strong {
          display: block;
          overflow: hidden;
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 750;
          letter-spacing: -0.02em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .span-drawer-metrics strong.is-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .span-drawer-metrics em {
          display: block;
          margin-top: 4px;
          color: var(--text-secondary);
          font-size: 11px;
          font-style: normal;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .span-drawer-metrics article.is-ok strong { color: var(--accent-emerald); }
        .span-drawer-metrics article.is-error strong { color: var(--accent-rose); }

        .span-drawer-card {
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          background: var(--bg-secondary);
          overflow: hidden;
        }

        .span-drawer-card > h3 {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-primary);
          background: color-mix(in srgb, var(--bg-tertiary) 80%, var(--bg-secondary));
          color: var(--text-primary);
          font-size: 11px;
          font-weight: 750;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .span-drawer-card > h3 em {
          margin-left: auto;
          color: var(--text-muted);
          font-size: 10px;
          font-style: normal;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: none;
        }

        .span-drawer-h3-meta {
          margin-left: auto;
          color: var(--text-muted);
          font-size: 11px;
          font-style: normal;
          font-weight: 650;
          letter-spacing: 0;
          text-transform: none;
        }

        .span-drawer-kv-list {
          display: flex;
          flex-direction: column;
        }

        .span-drawer-kv-list.nested {
          margin: 0 12px 12px;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          overflow: hidden;
        }

        .span-drawer-kv {
          display: grid;
          grid-template-columns: minmax(92px, 34%) 1fr;
          gap: 10px;
          align-items: start;
          padding: 8px 12px;
          border-bottom: 1px solid color-mix(in srgb, var(--border-primary) 75%, transparent);
        }

        .span-drawer-kv:last-child { border-bottom: 0; }
        .span-drawer-kv:hover { background: var(--bg-hover); }

        .span-drawer-kv-label {
          color: var(--text-tertiary);
          font-size: 11px;
          font-weight: 650;
          word-break: break-word;
        }

        .span-drawer-kv-value {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          min-width: 0;
          color: var(--text-primary);
          font-size: 12px;
          line-height: 1.45;
          word-break: break-word;
        }

        .span-drawer-kv-value .is-mono,
        .span-drawer-kv-value > span {
          min-width: 0;
          flex: 1;
        }

        .span-drawer-kv-value .is-mono {
          font-family: var(--font-mono);
          font-size: 11.5px;
        }

        .span-drawer-copy {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
        }

        .span-drawer-copy:hover {
          color: var(--accent-indigo);
          background: var(--bg-active);
        }

        .span-drawer-dest {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: 100%;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
        }

        .span-drawer-dest em {
          font-style: normal;
          font-weight: 650;
          opacity: 0.75;
        }

        .span-drawer-dest.is-3rdparty {
          color: var(--accent-amber);
          background: color-mix(in srgb, var(--accent-amber) 12%, transparent);
        }

        .span-drawer-dest.is-infra {
          color: var(--accent-cyan);
          background: color-mix(in srgb, var(--accent-cyan) 12%, transparent);
        }

        .span-drawer-dest.is-service {
          color: var(--accent-indigo);
          background: color-mix(in srgb, var(--accent-indigo) 10%, transparent);
        }

        .span-drawer-search {
          position: relative;
          display: flex;
          align-items: center;
        }

        .span-drawer-search svg {
          position: absolute;
          left: 10px;
          color: var(--text-muted);
          pointer-events: none;
        }

        .span-drawer-search input {
          width: 100%;
          height: 34px;
          padding: 0 12px 0 30px;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          background: var(--bg-secondary);
          color: var(--text-primary);
          font-size: 12px;
          outline: none;
        }

        .span-drawer-search input:focus {
          border-color: color-mix(in srgb, var(--accent-indigo) 50%, var(--border-primary));
          box-shadow: var(--shadow-glow);
        }

        .span-drawer-empty {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.45;
        }

        .span-drawer-empty svg {
          flex-shrink: 0;
          margin-top: 1px;
          opacity: 0.7;
        }

        .span-drawer-url {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin: 0 12px 10px;
          padding: 8px 10px;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          background: var(--bg-tertiary);
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 11.5px;
          line-height: 1.45;
          word-break: break-all;
        }

        .span-drawer-url span { flex: 1; min-width: 0; }

        .span-drawer-body-block {
          padding: 10px 12px 12px;
        }

        .span-drawer-block-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 6px;
          color: var(--text-tertiary);
          font-size: 10px;
          font-weight: 750;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .span-drawer-note {
          margin: 0 12px 8px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        .span-drawer-note strong {
          font-family: var(--font-mono);
          color: var(--text-primary);
        }

        .span-drawer-events {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px 12px 12px;
        }

        .span-drawer-events article {
          border: 1px solid var(--border-primary);
          border-left: 3px solid var(--accent-indigo);
          border-radius: 8px;
          background: var(--bg-primary);
        }

        .span-drawer-events header {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
        }

        .span-drawer-events strong {
          color: var(--text-primary);
          font-size: 12px;
        }

        .span-drawer-events time {
          color: var(--text-muted);
          font-size: 11px;
        }

        .span-drawer-failure {
          display: flex;
          gap: 10px;
          padding: 12px;
          border: 1px solid color-mix(in srgb, var(--accent-rose) 28%, var(--border-primary));
          border-radius: 12px;
          background: color-mix(in srgb, var(--accent-rose) 7%, var(--bg-secondary));
        }

        .span-drawer-failure-icon {
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 8px;
          background: color-mix(in srgb, var(--accent-rose) 14%, transparent);
          color: var(--accent-rose);
        }

        .span-drawer-failure-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .span-drawer-failure-title strong {
          color: var(--text-primary);
          font-size: 14px;
        }

        .span-drawer-failure-title em {
          padding: 1px 7px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent-rose) 12%, transparent);
          color: var(--accent-rose);
          font-size: 10px;
          font-style: normal;
          font-weight: 750;
        }

        .span-drawer-failure p {
          margin: 6px 0 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.5;
        }

        .span-drawer-pre {
          margin: 0;
          padding: 10px 12px;
          overflow: auto;
          max-height: 320px;
          color: var(--text-primary);
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .span-drawer-pre.is-code {
          background: #090d16;
          color: #cbd5e1;
          font-family: var(--font-mono);
          font-size: 11px;
        }

        body.dark-theme .span-drawer-pre.is-code {
          background: #070a10;
        }

        /* Detected Problems Panel */

        .problems-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          color: var(--accent-rose, #e93d62);
          font-size: 12px;
          font-weight: 750;
          letter-spacing: 0.01em;
        }
        .problems-panel-header > div {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .problems-panel-header svg {
          width: 15px;
          height: 15px;
          flex-shrink: 0;
        }
        .problems-panel-pills {
          display: inline-flex;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 6px;
        }
        .problems-panel-pills em {
          display: inline-flex;
          align-items: center;
          color: var(--accent-rose, #e93d62);
          background: color-mix(in srgb, var(--accent-rose, #e93d62) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent-rose, #e93d62) 22%, transparent);
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 10.5px;
          font-style: normal;
          font-weight: 750;
          letter-spacing: 0.01em;
        }
        .problems-panel-pills em.conf {
          color: var(--text-secondary);
          background: var(--bg-tertiary);
          border-color: var(--border-primary);
        }
        .problems-panel-pills em.conf.high {
          color: var(--accent-rose, #e93d62);
          background: color-mix(in srgb, var(--accent-rose, #e93d62) 10%, transparent);
          border-color: color-mix(in srgb, var(--accent-rose, #e93d62) 22%, transparent);
        }
        .problems-panel-pills em.conf.medium {
          color: var(--accent-amber, #e07a0a);
          background: color-mix(in srgb, var(--accent-amber, #e07a0a) 12%, transparent);
          border-color: color-mix(in srgb, var(--accent-amber, #e07a0a) 24%, transparent);
        }
        .problems-diagnosis {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .problems-diagnosis h3 {
          margin: 0;
          color: var(--text-primary);
          font-size: 16px;
          line-height: 1.3;
          font-weight: 750;
        }
        .problems-diagnosis p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.5;
        }
        .trace-detail-problems-panel.anomaly {
          border-color: color-mix(in srgb, var(--accent-amber, #d97706) 35%, var(--border-primary));
          border-left-color: var(--accent-amber, #d97706);
        }
        .trace-detail-problems-panel.anomaly .problems-panel-header,
        .trace-detail-problems-panel.anomaly .problems-panel-pills em {
          color: var(--accent-amber, #d97706);
        }
        .trace-detail-problems-panel.anomaly .problems-panel-pills em:not(.conf) {
          background: color-mix(in srgb, var(--accent-amber, #d97706) 12%, transparent);
          border-color: color-mix(in srgb, var(--accent-amber, #d97706) 24%, transparent);
        }
        .trace-detail-problems-panel.unknown {
          border-color: color-mix(in srgb, var(--text-muted) 35%, var(--border-primary));
          border-left-color: var(--text-muted);
        }
        .trace-detail-problems-panel.unknown .problems-panel-header,
        .trace-detail-problems-panel.unknown .problems-panel-pills em {
          color: var(--text-secondary);
        }
        .diagnosis-evidence {
          margin: 2px 0 0;
          padding-left: 18px;
          color: var(--text-secondary);
          font-size: 12.5px;
          line-height: 1.5;
        }
        .diagnosis-evidence li {
          margin: 3px 0;
        }
        .diagnosis-k8s {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 2px;
          padding: 10px 12px;
          border: 1px solid color-mix(in srgb, var(--accent-emerald, #0d9f6e) 22%, var(--border-primary));
          border-radius: 8px;
          background: color-mix(in srgb, var(--accent-emerald, #0d9f6e) 6%, var(--bg-tertiary));
        }
        .diagnosis-k8s-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 2px;
        }
        .diagnosis-k8s-head span {
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 750;
        }
        .diagnosis-k8s-head em {
          color: var(--text-tertiary);
          font-size: 10.5px;
          font-style: normal;
          font-weight: 650;
        }
        .diagnosis-k8s-head em + em::before {
          content: '·';
          margin-right: 8px;
          color: var(--text-muted);
        }
        .problems-diagnosis p,
        .diagnosis-evidence,
        .diagnosis-k8s-check span {
          overflow-wrap: anywhere;
        }
        .diagnosis-k8s-pending {
          color: var(--text-tertiary);
          font-size: 12px;
          font-style: italic;
        }
        .diagnosis-k8s-check {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--text-secondary);
        }
        .diagnosis-k8s-check.ok b { color: var(--accent-emerald, #0d9f6e); }
        .diagnosis-k8s-check.warn {
          color: var(--text-tertiary);
        }
        .diagnosis-k8s-check.warn b { color: var(--text-muted); }
        .diagnosis-k8s-check.info {
          color: var(--text-secondary);
        }
        .diagnosis-k8s-check.info b { color: var(--text-muted); font-weight: 700; }
        .diagnosis-k8s-states {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 6px;
          padding-top: 8px;
          border-top: 1px solid color-mix(in srgb, var(--accent-emerald, #0d9f6e) 16%, var(--border-primary));
        }
        .diagnosis-k8s-states span {
          min-width: 0;
          color: var(--text-tertiary);
          font-size: 10px;
          font-weight: 750;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .diagnosis-k8s-states span.wide {
          grid-column: 1 / -1;
        }
        .diagnosis-k8s-states strong {
          display: block;
          margin-top: 3px;
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0;
          text-transform: none;
          line-height: 1.45;
        }
        .problems-span-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .problems-span-label {
          color: var(--text-tertiary);
          font-size: 11px;
          font-weight: 750;
        }
        .problem-card {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 10px 12px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          color: inherit;
          text-align: left;
          box-shadow: var(--shadow-sm);
        }
        .problem-card:hover, .problem-card.selected {
          border-color: color-mix(in srgb, var(--accent-rose, #e93d62) 45%, var(--border-primary));
          background: color-mix(in srgb, var(--accent-rose, #e93d62) 5%, var(--bg-secondary));
        }
        .problem-card-top {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .problem-severity {
          min-width: 26px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid color-mix(in srgb, var(--accent-rose, #e93d62) 25%, transparent);
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent-rose, #e93d62) 10%, transparent);
          color: var(--accent-rose);
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 850;
        }
        .problem-service {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 700;
          font-size: 12px;
        }
        .problem-service-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          display: inline-block;
        }
        .problem-arrow { color: var(--text-muted); font-size: 12px; }
        .problem-target {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-secondary);
          max-width: 340px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .problem-title-badge {
          margin-left: auto;
          background: color-mix(in srgb, var(--accent-rose, #e93d62) 10%, transparent);
          color: var(--accent-rose, #e93d62);
          border: 1px solid color-mix(in srgb, var(--accent-rose, #e93d62) 28%, transparent);
          font-size: 10.5px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 5px;
          white-space: nowrap;
        }
        .problem-main {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .problem-main strong {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 850;
        }
        .problem-main span {
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
        }
        .problem-meta-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
        }
        .problem-meta-grid span {
          min-width: 0;
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          background: var(--bg-tertiary);
          color: var(--text-tertiary);
          padding: 6px 7px;
          font-size: 9.5px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .problem-meta-grid strong {
          display: block;
          margin-top: 3px;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 850;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-transform: none;
        }
        .problem-what {
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-primary);
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
        .failure-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
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
        .failure-category {
          border: 1px solid rgba(244, 63, 94, 0.28);
          border-radius: 999px;
          background: rgba(244, 63, 94, 0.10);
          color: var(--accent-rose);
          padding: 2px 7px;
          font-size: 9.5px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .failure-msg {
          font-size: 12.5px;
          color: var(--text-primary);
          font-weight: 600;
          word-break: normal;
          margin-top: 2px;
        }
        .failure-summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .failure-summary-grid div {
          min-width: 0;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          background: var(--bg-secondary);
          padding: 10px;
        }
        .failure-summary-grid span {
          display: block;
          color: var(--text-tertiary);
          font-size: 9.5px;
          font-weight: 850;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .failure-summary-grid strong {
          display: block;
          margin-top: 5px;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .failure-evidence-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .failure-evidence-row {
          display: grid;
          grid-template-columns: 120px minmax(0, 1fr);
          gap: 10px;
          align-items: baseline;
          width: 100%;
          border: 1px solid var(--border-primary);
          border-radius: 7px;
          background: var(--bg-tertiary);
          color: inherit;
          padding: 8px 9px;
          text-align: left;
          cursor: pointer;
        }
        .failure-evidence-row:hover {
          border-color: var(--border-secondary);
          background: var(--bg-hover);
        }
        .failure-evidence-row span {
          color: var(--text-tertiary);
          font-size: 10px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .failure-evidence-row strong {
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          word-break: break-word;
        }
        .failure-raw-message {
          margin: 0;
          border: 1px solid rgba(244, 63, 94, 0.16);
          border-radius: 7px;
          background: rgba(244, 63, 94, 0.06);
          color: var(--accent-rose);
          padding: 9px 10px;
          font-family: var(--font-mono);
          font-size: 11px;
          white-space: pre-wrap;
          word-break: break-word;
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

        .method-badge {
          min-width: 38px;
          min-height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 9.5px;
          font-weight: 800;
          padding: 0 8px;
          border-radius: 6px;
          text-transform: uppercase;
          border: 1px solid transparent;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }

        .span-drawer-card > h3 .method-badge,
        .span-drawer-card > h3 .status-badge {
          letter-spacing: 0.04em;
          text-transform: uppercase;
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

        .method-badge.delete {
          background: rgba(244, 63, 94, 0.12);
          color: #f43f5e;
          border-color: rgba(244, 63, 94, 0.26);
        }

        .method-badge.put,
        .method-badge.patch {
          background: rgba(245, 158, 11, 0.12);
          color: #f59e0b;
          border-color: rgba(245, 158, 11, 0.26);
        }

        .method-badge.head,
        .method-badge.options,
        .method-badge.http {
          background: rgba(99, 102, 241, 0.10);
          color: var(--accent-indigo);
          border-color: rgba(99, 102, 241, 0.22);
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
