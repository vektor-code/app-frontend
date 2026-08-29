import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Span } from '../../entities';
import { isSpanError as isSpanError } from '../../utils/spanStatus';
import { getSpanDestination as getSpanDestination } from '../SpanTimeline';
import { LANG_ICONS, stackIconKey } from '../LanguageIcon';
import { TECH_LOGOS } from '../TechIcon';
import { formatDuration as formatDuration, getSvcColor as getSvcColor } from '../../utils/traceDisplay';
import { TraceDetailIcon } from './TraceDetailIcon';

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
  for (const span of serviceSpans) {
    if (span.serviceName === serviceName && span.attributes) {
      const lang = span.attributes['telemetry.sdk.language'] || span.attributes['process.runtime.name'];
      if (lang) {
        return stackIconKey(lang) || lang.toLowerCase();
      }
    }
  }
  return 'unknown';
};

const getTopoIconKey = (name: string, spans: Span[] = []): string => {
  const n = name.toLowerCase();

  // Known infrastructure / datastore peers (not application classification).
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

  // Scan spans of this service for the SDK language (assigned stack / runtime).
  for (const span of spans) {
    if (span.serviceName === name && span.attributes) {
      const lang = span.attributes['telemetry.sdk.language'] || span.attributes['process.runtime.name'];
      const key = stackIconKey(lang);
      if (key) {
        return key;
      }
    }
  }

  return 'backend';
};

const getNamespaceColor = (namespace: string): string => {
  const colors = [
    '#6366f1', // Indigo
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#818cf8', // Periwinkle
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

export function TraceTopology({ spans, onSelectSpan }: { spans: Span[]; onSelectSpan: (span: Span) => void }) {
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
