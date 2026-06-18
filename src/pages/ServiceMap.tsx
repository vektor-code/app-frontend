import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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

// Helper to check if a service is an infrastructure component
const isInfraNode = (node: ServiceStats) => {
  if (node.isInfrastructure) return true;
  const name = node.serviceName.toLowerCase();
  return (
    name.includes('redis') ||
    name.includes('kafka') ||
    name.includes('rabbitmq') ||
    name.includes('postgres') ||
    name.includes('mysql') ||
    name.includes('mongo') ||
    name.includes('database') ||
    name.includes('db-') ||
    name.endsWith('-db') ||
    name.includes('nosql') ||
    name.includes('cassandra') ||
    name.includes('elasticsearch') ||
    name.includes('clickhouse') ||
    name.includes('vault') ||
    name.includes('minio')
  );
};

// Helper to get node dimensions based on its type and custom resize settings
const getNodeSize = (
  nodeName: string,
  nodesList?: ServiceStats[],
  posSize?: { w?: number; h?: number }
) => {
  const node = nodesList?.find(n => n.serviceName === nodeName);
  const isInfra = node ? isInfraNode(node) : false;
  const defaultW = isInfra ? 190 : NODE_W;
  const defaultH = isInfra ? 80 : NODE_H;
  return {
    w: posSize?.w || defaultW,
    h: posSize?.h || defaultH,
  };
};

// Helper to parse infrastructure details from name (e.g. system (host/detail))
const parseInfraName = (name: string): { system: string; host?: string; detail?: string } => {
  const match = name.match(/^([^(]+)\(([^)]+)\)$/);
  if (!match) {
    return { system: name };
  }
  const system = match[1].trim();
  const inner = match[2].trim();
  const slashIndex = inner.indexOf('/');
  if (slashIndex !== -1) {
    return {
      system,
      host: inner.slice(0, slashIndex).trim(),
      detail: inner.slice(slashIndex + 1).trim(),
    };
  }
  return {
    system,
    host: inner,
  };
};

// Vector canvas drawer for different infrastructure types
const drawInfraIcon = (
  ctx: CanvasRenderingContext2D,
  system: string,
  x: number,
  y: number,
  size: number,
  isDark: boolean,
  iconImages?: Map<string, HTMLImageElement>
) => {
  const sys = system.toLowerCase();

  let matchedKey = '';
  if (sys.includes('redis')) matchedKey = 'redis';
  else if (sys.includes('kafka')) matchedKey = 'kafka';
  else if (sys.includes('rabbitmq')) matchedKey = 'rabbitmq';
  else if (sys.includes('vault')) matchedKey = 'vault';
  else if (sys.includes('elastic')) matchedKey = 'elasticsearch';
  else if (sys.includes('minio')) matchedKey = 'minio';
  else if (sys.includes('postgres')) matchedKey = 'postgres';
  else if (sys.includes('mysql')) matchedKey = 'mysql';
  else if (sys.includes('mongo')) matchedKey = 'mongodb';

  const img = (iconImages && matchedKey) ? iconImages.get(matchedKey) : null;
  if (img && img.complete && img.naturalWidth !== 0) {
    ctx.save();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.shadowBlur = 0;

  if (sys.includes('redis')) {
    // Redis: Crimson stacked slabs
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const sy = y + i * 6;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, sy + 2, size, 4, 1.5);
      } else {
        ctx.rect(x, sy + 2, size, 4);
      }
      ctx.fill();
      ctx.stroke();
    }
  } else if (sys.includes('kafka')) {
    // Kafka: 3 connected broker circles
    const strokeColor = isDark ? '#38bdf8' : '#0284c7';
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = isDark ? '#0284c7' : '#bae6fd';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(x + 3, y + size / 2);
    ctx.lineTo(x + size - 3, y + 4);
    ctx.moveTo(x + 3, y + size / 2);
    ctx.lineTo(x + size - 3, y + size - 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + 4, y + size / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + size - 4, y + 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + size - 4, y + size - 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (sys.includes('rabbitmq')) {
    // RabbitMQ: Orange bunny outline
    ctx.strokeStyle = '#ea580c';
    ctx.fillStyle = isDark ? 'rgba(234, 88, 12, 0.15)' : 'rgba(234, 88, 12, 0.08)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(x + 4, y + size - 4);
    ctx.quadraticCurveTo(x + 2, y + 2, x + 6, y + 2);
    ctx.quadraticCurveTo(x + 8, y + 8, x + 9, y + size - 6);
    
    ctx.moveTo(x + size - 4, y + size - 4);
    ctx.quadraticCurveTo(x + size - 2, y + 2, x + size - 6, y + 2);
    ctx.quadraticCurveTo(x + size - 8, y + 8, x + size - 9, y + size - 6);

    ctx.moveTo(x + 5, y + size - 6);
    ctx.bezierCurveTo(x + 2, y + size - 2, x + size - 2, y + size - 2, x + size - 5, y + size - 6);
    ctx.stroke();
    
    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size - 4, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (sys.includes('vault')) {
    // Vault: Safe box with keyhole/combination lock dial
    ctx.strokeStyle = isDark ? '#e2e8f0' : '#475569';
    ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
    ctx.lineWidth = 1.5;

    ctx.strokeRect(x, y, size, size);

    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, 4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + size / 2, y + size / 2);
    ctx.lineTo(x + size / 2, y + size / 2 - 4);
    ctx.stroke();
  } else if (sys.includes('elastic')) {
    // Elasticsearch: Magnifying glass
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#059669';
    ctx.beginPath();
    ctx.moveTo(x + 11, y + 11);
    ctx.lineTo(x + size - 2, y + size - 2);
    ctx.stroke();
  } else if (sys.includes('minio')) {
    // MinIO: 3D isometric storage cube
    ctx.strokeStyle = '#c2410c';
    ctx.fillStyle = isDark ? '#ea580c' : '#ffedd5';
    ctx.lineWidth = 1.2;

    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size / 2;

    ctx.beginPath();
    ctx.moveTo(cx, y + 1);
    ctx.lineTo(x + size - 1, cy - r / 2);
    ctx.lineTo(cx, y + size - 1);
    ctx.lineTo(x + 1, cy - r / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, y + size - 1);
    ctx.lineTo(cx, cy - r / 2);
    ctx.moveTo(x + 1, cy - r / 2);
    ctx.lineTo(cx, y + 1);
    ctx.moveTo(x + size - 1, cy - r / 2);
    ctx.lineTo(cx, y + 1);
    ctx.stroke();
  } else {
    // Default standard database cylinder
    const iw = size * 0.8;
    const ih = size;
    const ix = x + (size - iw) / 2;
    const iy = y;

    ctx.strokeStyle = isDark ? '#fbbf24' : '#d97706';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.ellipse(ix + iw / 2, iy + ih - 3, iw / 2, 3, 0, 0, Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(ix + iw / 2, iy + ih / 2, iw / 2, 3, 0, 0, Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(ix + iw / 2, iy + 3, iw / 2, 3, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ix, iy + 3);
    ctx.lineTo(ix, iy + ih - 3);
    ctx.moveTo(ix + iw, iy + 3);
    ctx.lineTo(ix + iw, iy + ih - 3);
    ctx.stroke();
  }

  ctx.restore();
};


// Colors for column namespace zones (DrawSQL-style)
const getColumnTheme = (name: string, index: number, isDark: boolean) => {
  const themes = [
    // Indigo
    {
      bg: isDark ? 'rgba(99, 102, 241, 0.04)' : 'rgba(99, 102, 241, 0.02)',
      border: isDark ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.15)',
      headerBg: isDark ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.05)',
      text: isDark ? '#a5b4fc' : '#4f46e5',
    },
    // Purple
    {
      bg: isDark ? 'rgba(168, 85, 247, 0.04)' : 'rgba(168, 85, 247, 0.02)',
      border: isDark ? 'rgba(168, 85, 247, 0.3)' : 'rgba(168, 85, 247, 0.15)',
      headerBg: isDark ? 'rgba(168, 85, 247, 0.12)' : 'rgba(168, 85, 247, 0.05)',
      text: isDark ? '#d8b4fe' : '#9333ea',
    },
    // Emerald
    {
      bg: isDark ? 'rgba(16, 185, 129, 0.04)' : 'rgba(16, 185, 129, 0.02)',
      border: isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.15)',
      headerBg: isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.05)',
      text: isDark ? '#6ee7b7' : '#059669',
    },
    // Rose
    {
      bg: isDark ? 'rgba(244, 63, 94, 0.04)' : 'rgba(244, 63, 94, 0.02)',
      border: isDark ? 'rgba(244, 63, 94, 0.3)' : 'rgba(244, 63, 94, 0.15)',
      headerBg: isDark ? 'rgba(244, 63, 94, 0.12)' : 'rgba(244, 63, 94, 0.05)',
      text: isDark ? '#fda4af' : '#e11d48',
    },
    // Cyan
    {
      bg: isDark ? 'rgba(6, 182, 212, 0.04)' : 'rgba(6, 182, 212, 0.02)',
      border: isDark ? 'rgba(6, 182, 212, 0.3)' : 'rgba(6, 182, 212, 0.15)',
      headerBg: isDark ? 'rgba(6, 182, 212, 0.12)' : 'rgba(6, 182, 212, 0.05)',
      text: isDark ? '#67e8f9' : '#0891b2',
    }
  ];

  if (name === 'Internet') {
    return {
      bg: isDark ? 'rgba(148, 163, 184, 0.03)' : 'rgba(148, 163, 184, 0.015)',
      border: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.12)',
      headerBg: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(148, 163, 184, 0.04)',
      text: isDark ? '#cbd5e1' : '#475569',
    };
  }
  if (name === 'Infrastructure') {
    // Amber / orange styling for database/infrastructure
    return {
      bg: isDark ? 'rgba(245, 158, 11, 0.04)' : 'rgba(245, 158, 11, 0.02)',
      border: isDark ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.15)',
      headerBg: isDark ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.05)',
      text: isDark ? '#fde047' : '#d97706',
    };
  }

  // Stable color choice based on namespace name hash
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % themes.length;
  return themes[idx];
};

export default function ServiceMap({ namespace }: ServiceMapProps) {
  const [data, setData] = useState<ServiceMapData | null>(null);
  const [visibleNamespaces, setVisibleNamespaces] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });

  // Interaction state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeName: string } | null>(null);
  const [highlightedService, setHighlightedService] = useState<string | null>(null);
  const navigate = useNavigate();

  // Refs for interaction tracking
  const isPanningRef = useRef(false);
  const isDraggingNodeRef = useRef<string | null>(null);
  const isDraggingZoneRef = useRef<string | null>(null);
  const isResizingNodeRef = useRef<string | null>(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const nodePositionsRef = useRef<Map<string, { x: number; y: number; w?: number; h?: number }>>(new Map());
  const zoneHeadersRef = useRef<Map<string, { zx: number; zy: number; zw: number; zh: number; colName: string }>>(new Map());
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const highlightedServiceRef = useRef<string | null>(null);

  useEffect(() => { highlightedServiceRef.current = highlightedService; }, [highlightedService]);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  // Refs for zoom/pan used inside render loop without re-triggering effect
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // Refs for preloaded brand icons from Devicon CDN
  const iconImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  useEffect(() => {
    const urls = {
      redis: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/redis/redis-original.svg',
      kafka: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg',
      rabbitmq: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/rabbitmq/rabbitmq-original.svg',
      vault: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vault/vault-original.svg',
      elasticsearch: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/elasticsearch/elasticsearch-original.svg',
      minio: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/minio/minio-original.svg',
      postgres: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original.svg',
      mysql: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mysql/mysql-original.svg',
      mongodb: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mongodb/mongodb-original.svg',
    };

    Object.entries(urls).forEach(([key, url]) => {
      const img = new Image();
      img.src = url;
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        iconImagesRef.current.set(key, img);
      };
    });
  }, []);

  // Refs for tracking real-time particles and cached span mappings
  const particlesRef = useRef<Particle[]>([]);
  const spanServiceCache = useRef<Map<string, string>>(new Map());
  const spanNameCache = useRef<Map<string, string>>(new Map());

  // Clear positions to force re-layout when active namespace selection changes
  useEffect(() => {
    nodePositionsRef.current.clear();
  }, [selectedNamespaces, namespace]);

  useEffect(() => {
    api.getServiceMap(namespace).then(res => {
      setData(res);
      if (res && res.nodes) {
        const nsList = Array.from(new Set(res.nodes.map(n => n.namespace).filter(ns => ns && ns !== 'Internet')));
        setVisibleNamespaces(nsList);

        // Retrieve persisted namespaces or fallback to all
        const saved = localStorage.getItem(`service_map_namespaces_${namespace || 'all'}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              setSelectedNamespaces(parsed.filter(x => nsList.includes(x)));
              return;
            }
          } catch {}
        }

        if (namespace) {
          setSelectedNamespaces([namespace]);
        } else {
          setSelectedNamespaces(nsList);
        }
      }
    }).catch(() => {});
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
      const { w, h } = getNodeSize(name, data?.nodes, pos);
      const rx = pos.x - w / 2;
      const ry = pos.y - h / 2;
      if (wx >= rx && wx <= rx + w && wy >= ry && wy <= ry + h) {
        return name;
      }
    }
    return null;
  }, [data]);

  // Find if mouse is over bottom-right resize handle of an infra node
  const hitTestResizeHandle = useCallback((wx: number, wy: number): string | null => {
    for (const [name, pos] of nodePositionsRef.current.entries()) {
      const node = data?.nodes.find(n => n.serviceName === name);
      if (!node || !isInfraNode(node)) continue;

      const { w, h } = getNodeSize(name, data?.nodes, pos);
      const hx = pos.x + w / 2;
      const hy = pos.y + h / 2;

      // Click is within 12px of bottom right corner
      if (Math.abs(wx - hx) <= 12 && Math.abs(wy - hy) <= 12) {
        return name;
      }
    }
    return null;
  }, [data]);

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

    const dbSystem = span.attributes?.['db.system'];
    const messagingSystem = span.attributes?.['messaging.system'];
    if (typeof dbSystem === 'string' || typeof messagingSystem === 'string') {
      const baseInfra = ((dbSystem || messagingSystem) as string).toLowerCase();

      let resource = '';
      const dbName = span.attributes?.['db.name'];
      const msgDest = span.attributes?.['messaging.destination'] || 
                      span.attributes?.['messaging.destination.name'] || 
                      span.attributes?.['messaging.destination_name'] || 
                      span.attributes?.['messaging.dest'];

      const peerName = span.attributes?.['net.peer.name'] || 
                       span.attributes?.['server.address'] || 
                       span.attributes?.['peer.service'] || 
                       span.attributes?.['net.peer.ip'] || 
                       span.attributes?.['network.peer.address'];

      const resourceName = dbName || msgDest;
      if (peerName && resourceName) {
        resource = `${peerName}/${resourceName}`;
      } else if (resourceName) {
        resource = resourceName;
      } else if (peerName) {
        resource = peerName;
      } else {
        resource = span.serviceName;
      }

      const infraName = `${baseInfra} (${resource})`;
      const source = span.serviceName;
      if (source && infraName && source !== infraName) {
        particlesRef.current.push({
          id: Math.random().toString(36).slice(2),
          source,
          target: infraName,
          startTime: performance.now(),
          duration: 1000,
          isError: span.status === 'ERROR',
          operationName: span.name || 'query',
          traceIdShort: span.traceId ? span.traceId.slice(0, 8) : '',
        });

        // Update the database/infra node stats in real-time
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            nodes: prev.nodes.map(node => {
              if (node.serviceName === infraName) {
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
              return node;
            }),
          };
        });
        return;
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

  // Filter nodes and edges based on selected namespaces
  const activeNamespacesSet = new Set(namespace ? [namespace] : selectedNamespaces);

  const isNodeActive = useCallback((n: ServiceStats) => {
    if (n.serviceName === 'Internet') return true;
    if (isInfraNode(n)) {
      if (n.namespace && activeNamespacesSet.has(n.namespace)) return true;
      // Also show infra node if there are any active dependencies using it
      return (data?.edges || []).some(edge => {
        if (edge.source !== n.serviceName && edge.target !== n.serviceName) return false;
        const otherNodeName = edge.source === n.serviceName ? edge.target : edge.source;
        const otherNode = (data?.nodes || []).find(x => x.serviceName === otherNodeName);
        return otherNode && otherNode.namespace && activeNamespacesSet.has(otherNode.namespace);
      });
    }
    return activeNamespacesSet.has(n.namespace || 'default');
  }, [data, namespace, selectedNamespaces, activeNamespacesSet]);

  const activeNodes = (data?.nodes || []).filter(isNodeActive);
  const activeNodeNames = new Set(activeNodes.map(n => n.serviceName));
  const activeEdges = (data?.edges || []).filter(e => activeNodeNames.has(e.source) && activeNodeNames.has(e.target));

  // Setup WebSocket connection for live telemetry streaming
  useEffect(() => {
    const disconnect = connectLiveStream(
      namespace || undefined,
      onSpanReceived
    );
    return () => disconnect();
  }, [namespace, onSpanReceived]);

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
        setPan(p => ({
          x: pos.x - (pos.x - p.x) * scale,
          y: pos.y - (pos.y - p.y) * scale,
        }));
        return newZoom;
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) return; // Right-click context menu handles this
      
      const pos = getCanvasPos(e);
      const world = screenToWorld(pos.x, pos.y);
      
      lastMouseRef.current = pos;

      // 1. Check resize handle of infra nodes first
      const hitResizeNode = hitTestResizeHandle(world.x, world.y);
      if (hitResizeNode) {
        isResizingNodeRef.current = hitResizeNode;
        canvas.style.cursor = 'se-resize';
        return;
      }

      // 2. Check service node
      const hitNode = hitTestNode(world.x, world.y);
      if (hitNode) {
        isDraggingNodeRef.current = hitNode;
        canvas.style.cursor = 'grabbing';
        return;
      }

      // 3. Check zone headers
      let hitZone: string | null = null;
      for (const zone of zoneHeadersRef.current.values()) {
        if (
          world.x >= zone.zx &&
          world.x <= zone.zx + zone.zw &&
          world.y >= zone.zy &&
          world.y <= zone.zy + 28
        ) {
          hitZone = zone.colName;
          break;
        }
      }
      if (hitZone) {
        isDraggingZoneRef.current = hitZone;
        canvas.style.cursor = 'grabbing';
        return;
      }

      // 4. Default pan
      isPanningRef.current = true;
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const dx = pos.x - lastMouseRef.current.x;
      const dy = pos.y - lastMouseRef.current.y;
      lastMouseRef.current = pos;

      if (isResizingNodeRef.current) {
        const nodeName = isResizingNodeRef.current;
        const currentPos = nodePositionsRef.current.get(nodeName);
        if (currentPos) {
          const { w, h } = getNodeSize(nodeName, data?.nodes, currentPos);
          nodePositionsRef.current.set(nodeName, {
            ...currentPos,
            w: Math.max(100, w + (dx / zoomRef.current) * 2),
            h: Math.max(40, h + (dy / zoomRef.current) * 2)
          });
        }
      } else if (isDraggingNodeRef.current) {
        const nodeName = isDraggingNodeRef.current;
        const currentPos = nodePositionsRef.current.get(nodeName);
        if (currentPos) {
          nodePositionsRef.current.set(nodeName, {
            ...currentPos,
            x: currentPos.x + dx / zoomRef.current,
            y: currentPos.y + dy / zoomRef.current,
          });
        }
      } else if (isDraggingZoneRef.current) {
        const colName = isDraggingZoneRef.current;
        const targetNodes = activeNodes.filter(n => {
          if (colName === 'Internet') return n.serviceName === 'Internet';
          if (colName === 'Infrastructure') return isInfraNode(n);
          return (n.namespace || 'default') === colName;
        });
        targetNodes.forEach(node => {
          const currentPos = nodePositionsRef.current.get(node.serviceName);
          if (currentPos) {
            nodePositionsRef.current.set(node.serviceName, {
              ...currentPos,
              x: currentPos.x + dx / zoomRef.current,
              y: currentPos.y + dy / zoomRef.current
            });
          }
        });
      } else if (isPanningRef.current) {
        setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      } else {
        const world = screenToWorld(pos.x, pos.y);
        
        const hitResize = hitTestResizeHandle(world.x, world.y);
        if (hitResize) {
          canvas.style.cursor = 'se-resize';
          return;
        }

        const hitNode = hitTestNode(world.x, world.y);
        if (hitNode) {
          canvas.style.cursor = 'grab';
          return;
        }

        let hitZone = false;
        for (const zone of zoneHeadersRef.current.values()) {
          if (
            world.x >= zone.zx &&
            world.x <= zone.zx + zone.zw &&
            world.y >= zone.zy &&
            world.y <= zone.zy + 28
          ) {
            hitZone = true;
            break;
          }
        }
        canvas.style.cursor = hitZone ? 'grab' : 'default';
      }
    };

    const handleMouseUp = () => {
      isPanningRef.current = false;
      isDraggingNodeRef.current = null;
      isDraggingZoneRef.current = null;
      isResizingNodeRef.current = null;
      canvas.style.cursor = 'default';
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      const world = screenToWorld(pos.x, pos.y);
      const hitNode = hitTestNode(world.x, world.y);
      
      if (hitNode) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          nodeName: hitNode
        });
      } else {
        setContextMenu(null);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [screenToWorld, hitTestNode, hitTestResizeHandle, activeNodes]);



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
      zoneHeadersRef.current.clear();

      canvas.width = width * 2;
      canvas.height = height * 2;
      ctx.scale(2, 2);

      ctx.clearRect(0, 0, width, height);

      const isDark = document.body.classList.contains('dark-theme');

      // Background
      ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      // Apply zoom and pan transforms
      ctx.save();
      ctx.translate(currentPan.x, currentPan.y);
      ctx.scale(currentZoom, currentZoom);

      // Grid (in world space)
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

      if (activeNodes.length === 0) {
        ctx.restore();
        animationId = requestAnimationFrame(render);
        return;
      }

      // --- Namespace-grouped column layout (Left-to-Right flow) ---
      const cols: { name: string; label: string; nodes: ServiceStats[] }[] = [];

      // Column 0: Internet
      const internetNodes = activeNodes.filter(n => n.serviceName === 'Internet');
      if (internetNodes.length > 0) {
        cols.push({ name: 'Internet', label: 'External Clients', nodes: internetNodes });
      }

      // Columns 1..N: Namespace components
      const nsNames = Array.from(new Set(
        activeNodes
          .filter(n => n.serviceName !== 'Internet')
          .map(n => n.namespace || 'default')
      )).sort();

      nsNames.forEach(ns => {
        const nsNodes = activeNodes.filter(n => n.serviceName !== 'Internet' && (n.namespace || 'default') === ns);
        if (nsNodes.length > 0) {
          cols.push({ name: ns, label: `Namespace: ${ns}`, nodes: nsNodes });
        }
      });

      // Compute initial DAG layout coordinates on columns if they are not already cached
      const needsLayout = activeNodes.some(n => !nodePositionsRef.current.has(n.serviceName));
      if (needsLayout) {
        const colWidth = 200;
        const colSpacing = 120;

        const totalW = cols.length * colWidth + (cols.length - 1) * colSpacing;
        const startX = Math.max(80, (width - totalW) / 2);

        cols.forEach((col, c) => {
          // Calculate total height of this column based on node heights plus gaps
          let totalH = 0;
          col.nodes.forEach(node => {
            const { h } = getNodeSize(node.serviceName, data?.nodes);
            totalH += h + 40; // 40px gap
          });
          totalH -= 40; // remove last gap

          const startY = Math.max(100, (height - totalH) / 2);
          const colX = startX + c * (colWidth + colSpacing);

          let currentY = startY;
          col.nodes.forEach((node) => {
            const { h } = getNodeSize(node.serviceName, data?.nodes);
            if (!nodePositionsRef.current.has(node.serviceName)) {
              nodePositionsRef.current.set(node.serviceName, {
                x: colX + colWidth / 2,
                y: currentY + h / 2
              });
            }
            currentY += h + 40;
          });
        });
      }

      const positions = nodePositionsRef.current;

      // --- Draw Namespace Bounding Box Cards (DrawSQL-style zones) ---
      cols.forEach((col, c) => {
        if (col.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasPositions = false;
        col.nodes.forEach(node => {
          const pos = positions.get(node.serviceName);
          if (pos) {
            const { w, h } = getNodeSize(node.serviceName, data?.nodes, pos);
            minX = Math.min(minX, pos.x - w / 2);
            minY = Math.min(minY, pos.y - h / 2);
            maxX = Math.max(maxX, pos.x + w / 2);
            maxY = Math.max(maxY, pos.y + h / 2);
            hasPositions = true;
          }
        });

        if (!hasPositions) return;

        const paddingX = 20;
        const paddingY = 24;
        const headerHeight = 24;

        const zx = minX - paddingX;
        const zy = minY - paddingY - headerHeight;
        const zw = (maxX - minX) + paddingX * 2;
        const zh = (maxY - minY) + paddingY * 2 + headerHeight;

        zoneHeadersRef.current.set(col.name, { zx, zy, zw, zh, colName: col.name });

        const theme = getColumnTheme(col.name, c, isDark);

        // Draw zone bounding box background
        ctx.fillStyle = theme.bg;
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(zx, zy, zw, zh, 10);
        } else {
          ctx.rect(zx, zy, zw, zh);
        }
        ctx.fill();
        ctx.stroke();

        // Draw zone header
        ctx.fillStyle = theme.headerBg;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(zx, zy, zw, headerHeight + 4, [10, 10, 0, 0]);
        } else {
          ctx.rect(zx, zy, zw, headerHeight + 4);
        }
        ctx.fill();

        // Header separator line
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(zx, zy + headerHeight + 4);
        ctx.lineTo(zx + zw, zy + headerHeight + 4);
        ctx.stroke();

        // Label
        ctx.fillStyle = theme.text;
        ctx.font = 'bold 9px Inter';
        ctx.textAlign = 'left';
        ctx.fillText(col.label.toUpperCase(), zx + 12, zy + 16);
      });

      // Compute total outgoing call duration per node for contribution percentage
      const outgoingTotalDuration = new Map<string, number>();
      activeEdges.forEach(e => {
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

      const getEdgeCurve = (
        fromName: string,
        fromPos: { x: number; y: number; w?: number; h?: number },
        toName: string,
        toPos: { x: number; y: number; w?: number; h?: number }
      ) => {
        let x1: number, y1: number, x2: number, y2: number;
        let cp1x: number, cp1y: number, cp2x: number, cp2y: number;

        const fromSize = getNodeSize(fromName, data?.nodes, fromPos);
        const toSize = getNodeSize(toName, data?.nodes, toPos);

        if (toPos.x > fromPos.x) {
          x1 = fromPos.x + fromSize.w / 2;
          y1 = fromPos.y;
          x2 = toPos.x - toSize.w / 2;
          y2 = toPos.y;

          const dx = x2 - x1;
          cp1x = x1 + dx * 0.45;
          cp1y = y1;
          cp2x = x2 - dx * 0.45;
          cp2y = y2;
        } else {
          x1 = fromPos.x;
          y1 = fromPos.y - fromSize.h / 2;
          x2 = toPos.x;
          y2 = toPos.y - toSize.h / 2;

          cp1x = x1 + 40;
          cp1y = y1 - 60;
          cp2x = x2 - 40;
          cp2y = y2 - 60;
        }

        return { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 };
      };

      // --- Draw Ambient Edges ---
      activeEdges.forEach(edge => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return;

        const totalDuration = outgoingTotalDuration.get(edge.source) || 0;
        const contributionPercent = totalDuration > 0 ? (edge.avgDurationMs / totalDuration) * 100 : 0;

        const isError = edge.errorCount > 0;
        const isCritical = contributionPercent > 50 && edge.avgDurationMs > 50;

        const { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 } = getEdgeCurve(edge.source, from, edge.target, to);

        // Highlight/dim logic
        const hs = highlightedServiceRef.current;
        const isSelf = edge.source === hs || edge.target === hs;
        const shouldDim = hs !== null && !isSelf;
        ctx.globalAlpha = shouldDim ? 0.15 : 1.0;

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
        ctx.globalAlpha = 1.0; // Reset global alpha
      });

      // --- Draw Active Real-Time Particles (Actual Request Flows) ---
      const now = performance.now();
      particlesRef.current = particlesRef.current.filter(particle => {
        const from = positions.get(particle.source);
        const to = positions.get(particle.target);
        if (!from || !to) return false;

        // Ignore particles targeting nodes that are currently toggled off
        if (!activeNodeNames.has(particle.source) || !activeNodeNames.has(particle.target)) return false;

        const progress = (now - particle.startTime) / particle.duration;
        if (progress >= 1) return false;

        // Highlight/dim logic
        const hs = highlightedServiceRef.current;
        const isSelf = particle.source === hs || particle.target === hs;
        const shouldDim = hs !== null && !isSelf;
        ctx.globalAlpha = shouldDim ? 0.15 : 1.0;

        const { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 } = getEdgeCurve(particle.source, from, particle.target, to);
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

        ctx.globalAlpha = 1.0; // Reset global alpha
        return true;
      });

      // --- Draw Nodes (Microservice Cards) ---
      activeNodes.forEach(node => {
        const pos = positions.get(node.serviceName);
        if (!pos) return;

        const isInternet = node.serviceName === 'Internet';
        const isInfra = isInfraNode(node);
        const hasErrors = node.errorCount > 0;
        const errRate = node.errorRate;
        const reqCount = node.requestCount;

        // Highlight/dim logic
        const hs = highlightedServiceRef.current;
        const isSelf = node.serviceName === hs;
        const isConnected = activeEdges.some(e => 
          (e.source === hs && e.target === node.serviceName) || 
          (e.target === hs && e.source === node.serviceName)
        );
        const shouldDim = hs !== null && !isSelf && !isConnected;
        ctx.globalAlpha = shouldDim ? 0.15 : 1.0;

        const { w, h } = getNodeSize(node.serviceName, data?.nodes, pos);
        const rx = pos.x - w / 2;
        const ry = pos.y - h / 2;

        ctx.save();
        const pulse = 1 + 0.05 * Math.sin(Date.now() * 0.005);
        const glowRadius = Math.max(w, h) * 0.8 * pulse;

        const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowRadius);
        if (isInternet) {
          gradient.addColorStop(0, 'rgba(56, 189, 248, 0.15)');
        } else if (isInfra) {
          gradient.addColorStop(0, 'rgba(245, 158, 11, 0.15)');
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
          : isInfra
            ? 'rgba(245, 158, 11, 0.4)'
            : hasErrors ? 'rgba(244, 63, 94, 0.4)' : 'rgba(99, 102, 241, 0.3)';

        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = isInternet
          ? '#38bdf8'
          : isInfra
            ? '#f59e0b'
            : hasErrors ? '#f43f5e' : (isDark ? '#475569' : '#cbd5e1');
        ctx.lineWidth = hasErrors ? 2.5 : 1.5;

        // Custom borders for Infrastructure nodes (dashed)
        if (isInfra) {
          ctx.setLineDash([4, 3]);
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(rx, ry, w, h, 8);
        } else {
          ctx.rect(rx, ry, w, h);
        }
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash
        ctx.restore();

        if (isInfra) {
          const parsed = parseInfraName(node.serviceName);
          const iconSize = 20;
          const iconX = rx + 12;
          const iconY = ry + 12;

          // Draw the custom icon at (iconX, iconY) with size (iconSize, iconSize)
          drawInfraIcon(ctx, parsed.system, iconX, iconY, iconSize, isDark, iconImagesRef.current);

          // Draw System Name in bold uppercase
          ctx.font = '800 11px Inter';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isDark ? '#fbbf24' : '#d97706'; // Amber accent for infra system name
          const systemName = parsed.system.toUpperCase();
          ctx.fillText(systemName, rx + 38, iconY + iconSize / 2);

          // Prepare lines for body
          const bodyLines: string[] = [];
          if (parsed.host) {
            bodyLines.push(parsed.host);
          }
          if (parsed.detail) {
            bodyLines.push(parsed.detail);
          }

          // Draw body lines (Host/Detail)
          ctx.font = '500 10px JetBrains Mono';
          ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
          bodyLines.forEach((line, index) => {
            const lineY = ry + 42 + index * 12;
            let displayLine = line;
            const maxChars = Math.floor((w - 24) / 6.5); // Estimate char width in mono
            if (displayLine.length > maxChars) {
              displayLine = displayLine.slice(0, maxChars - 2) + '…';
            }
            ctx.fillText(displayLine, rx + 12, lineY);
          });

          // Draw Stats
          ctx.font = '600 9px Inter';
          let statsText = `${reqCount} reqs`;
          if (errRate > 0) {
            statsText += ` · ${errRate.toFixed(1)}% err`;
          }
          ctx.fillStyle = errRate > 5 ? '#f43f5e' : (isDark ? '#94a3b8' : '#64748b');
          ctx.fillText(statsText, rx + 12, ry + h - 12);

          // Status Dot (placed near the top right header)
          ctx.beginPath();
          ctx.arc(rx + w - 12, ry + 22, 4, 0, Math.PI * 2);
          ctx.fillStyle = hasErrors ? '#f43f5e' : '#10b981';
          ctx.fill();
        } else {
          // Standard/internet node
          const textX = rx + 12;
          const centerY = ry + h / 2;

          // Draw Service Name Text
          ctx.font = '700 11px Inter';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
          let displayName = node.serviceName;
          const maxLen = Math.floor(w / 8.5);
          if (displayName.length > maxLen) {
            displayName = displayName.slice(0, Math.max(8, maxLen - 3)) + '...';
          }
          ctx.fillText(displayName, textX, centerY - 6);

          // Draw Stats Text
          ctx.font = '500 10px JetBrains Mono';
          let statsText = `${reqCount} reqs`;
          if (errRate > 0) {
            statsText += ` · ${errRate.toFixed(1)}% err`;
          }

          ctx.fillStyle = errRate > 5 ? '#f43f5e' : (isDark ? '#94a3b8' : '#64748b');
          ctx.fillText(statsText, textX, centerY + 8);

          // Draw Status Dot
          ctx.beginPath();
          ctx.arc(rx + w - 12, centerY, 4, 0, Math.PI * 2);
          ctx.fillStyle = isInternet
            ? '#38bdf8'
            : hasErrors ? '#f43f5e' : '#10b981';
          ctx.fill();
        }

        // Draw Resize Handle for Infra nodes
        if (isInfra) {
          ctx.strokeStyle = isDark ? 'rgba(251, 191, 36, 0.6)' : 'rgba(217, 119, 6, 0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx + w - 8, ry + h - 2);
          ctx.lineTo(rx + w - 2, ry + h - 8);
          ctx.moveTo(rx + w - 5, ry + h - 2);
          ctx.lineTo(rx + w - 2, ry + h - 5);
          ctx.stroke();
        }

        ctx.globalAlpha = 1.0; // Reset global alpha
      });

      // Restore the canvas transform
      ctx.restore();

      // Zoom level indicator (screen space)
      const zoomPercent = Math.round(currentZoom * 100);
      ctx.font = '500 10px JetBrains Mono';
      ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(`${zoomPercent}%`, 12, height - 10);

      // Draw Minimap
      const minimapCanvas = minimapCanvasRef.current;
      const minimapCtx = minimapCanvas?.getContext('2d');
      if (minimapCanvas && minimapCtx) {
        const mmW = minimapCanvas.width = 160;
        const mmH = minimapCanvas.height = 100;
        minimapCtx.clearRect(0, 0, mmW, mmH);

        minimapCtx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
        minimapCtx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
        minimapCtx.lineWidth = 1.5;
        minimapCtx.beginPath();
        if (minimapCtx.roundRect) {
          minimapCtx.roundRect(0, 0, mmW, mmH, 8);
        } else {
          minimapCtx.rect(0, 0, mmW, mmH);
        }
        minimapCtx.fill();
        minimapCtx.stroke();

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        activeNodes.forEach(node => {
          const pos = positions.get(node.serviceName);
          if (pos) {
            const { w, h } = getNodeSize(node.serviceName, data?.nodes, pos);
            minX = Math.min(minX, pos.x - w / 2);
            minY = Math.min(minY, pos.y - h / 2);
            maxX = Math.max(maxX, pos.x + w / 2);
            maxY = Math.max(maxY, pos.y + h / 2);
          }
        });

        if (minX !== Infinity) {
          const padding = 12;
          const graphW = (maxX - minX) || 1;
          const graphH = (maxY - minY) || 1;
          
          const scaleX = (mmW - padding * 2) / graphW;
          const scaleY = (mmH - padding * 2) / graphH;
          const scale = Math.min(scaleX, scaleY);
          
          const offsetX = padding + (mmW - padding * 2 - graphW * scale) / 2 - minX * scale;
          const offsetY = padding + (mmH - padding * 2 - graphH * scale) / 2 - minY * scale;

          // Minimap edges
          minimapCtx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
          minimapCtx.lineWidth = 0.5;
          activeEdges.forEach(edge => {
            const sPos = positions.get(edge.source);
            const tPos = positions.get(edge.target);
            if (sPos && tPos) {
              minimapCtx.beginPath();
              minimapCtx.moveTo(sPos.x * scale + offsetX, sPos.y * scale + offsetY);
              minimapCtx.lineTo(tPos.x * scale + offsetX, tPos.y * scale + offsetY);
              minimapCtx.stroke();
            }
          });

          // Minimap nodes
          activeNodes.forEach(node => {
            const pos = positions.get(node.serviceName);
            if (pos) {
              const { w, h } = getNodeSize(node.serviceName, data?.nodes, pos);
              const isInternet = node.serviceName === 'Internet';
              const isInfra = isInfraNode(node);
              
              minimapCtx.fillStyle = isInternet
                ? '#38bdf8'
                : isInfra
                  ? '#f59e0b'
                  : node.errorCount > 0 ? '#f43f5e' : '#6366f1';
              
              const nX = (pos.x - w / 2) * scale + offsetX;
              const nY = (pos.y - h / 2) * scale + offsetY;
              const nW = w * scale;
              const nH = h * scale;
              
              minimapCtx.fillRect(nX, nY, Math.max(3, nW), Math.max(2, nH));
            }
          });

          // Minimap viewport box
          const vpLeft = -currentPan.x / currentZoom;
          const vpTop = -currentPan.y / currentZoom;
          const vpRight = (width - currentPan.x) / currentZoom;
          const vpBottom = (height - currentPan.y) / currentZoom;

          const vpx = vpLeft * scale + offsetX;
          const vpy = vpTop * scale + offsetY;
          const vpw = (vpRight - vpLeft) * scale;
          const vph = (vpBottom - vpTop) * scale;

          minimapCtx.fillStyle = isDark ? 'rgba(99, 102, 241, 0.08)' : 'rgba(99, 102, 241, 0.05)';
          minimapCtx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
          minimapCtx.lineWidth = 1;
          minimapCtx.fillRect(vpx, vpy, vpw, vph);
          minimapCtx.strokeRect(vpx, vpy, vpw, vph);
        }
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [data, dimensions, activeNodes, activeEdges]);

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
    if (activeNodes.length === 0) return;
    const positions = nodePositionsRef.current;
    if (positions.size === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positions.forEach((pos, name) => {
      const { w, h } = getNodeSize(name, data?.nodes, pos);
      minX = Math.min(minX, pos.x - w / 2);
      minY = Math.min(minY, pos.y - h / 2);
      maxX = Math.max(maxX, pos.x + w / 2);
      maxY = Math.max(maxY, pos.y + h / 2);
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

  const handleToggleNamespace = (ns: string) => {
    let next: string[];
    if (selectedNamespaces.includes(ns)) {
      next = selectedNamespaces.filter(x => x !== ns);
    } else {
      next = [...selectedNamespaces, ns];
    }
    setSelectedNamespaces(next);
    localStorage.setItem(`service_map_namespaces_${namespace || 'all'}`, JSON.stringify(next));
  };

  const handleToggleAll = () => {
    let next: string[];
    if (selectedNamespaces.length === visibleNamespaces.length) {
      next = [];
    } else {
      next = [...visibleNamespaces];
    }
    setSelectedNamespaces(next);
    localStorage.setItem(`service_map_namespaces_${namespace || 'all'}`, JSON.stringify(next));
  };

  const isDarkTheme = document.body.classList.contains('dark-theme');

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
      <h1 className="page-title">Service Map</h1>
      <p className="page-subtitle">
        {namespace ? `Service dependencies in ${namespace}` : 'Service dependencies across all namespaces'}
      </p>

      {/* Namespace Filter Pills */}
      {!namespace && visibleNamespaces.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-body" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginRight: '8px' }}>
              Filter Namespaces:
            </span>
            <button
              onClick={handleToggleAll}
              className="btn btn-ghost btn-sm"
              style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '4px' }}
            >
              {selectedNamespaces.length === visibleNamespaces.length ? 'Clear All' : 'Select All'}
            </button>
            {visibleNamespaces.map((ns, idx) => {
              const theme = getColumnTheme(ns, idx, isDarkTheme);
              const isSelected = selectedNamespaces.includes(ns);
              return (
                <button
                  key={ns}
                  onClick={() => handleToggleNamespace(ns)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '20px',
                    border: `1.5px solid ${isSelected ? theme.border : 'var(--border-color, rgba(255, 255, 255, 0.1))'}`,
                    background: isSelected ? theme.headerBg : 'transparent',
                    color: isSelected ? theme.text : 'var(--text-muted, #94a3b8)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isSelected ? theme.text : 'transparent',
                    border: `1px solid ${isSelected ? 'transparent' : 'var(--text-muted, #94a3b8)'}`,
                  }} />
                  {ns}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">Service Topology</div>
          <span className="text-sm text-muted">{activeNodes.length} services</span>
        </div>
        <div className="card-body" ref={containerRef} style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            style={{ width: dimensions.width, height: dimensions.height, display: 'block' }}
          />

          {/* Minimap */}
          {activeNodes.length > 0 && (
            <div style={{
              position: 'absolute',
              bottom: 16,
              right: 56,
              zIndex: 10,
              background: 'var(--bg-card, rgba(30, 41, 59, 0.85))',
              backdropFilter: 'blur(12px)',
              borderRadius: 8,
              border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
              padding: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            }}>
              <canvas
                ref={minimapCanvasRef}
                style={{ width: 160, height: 100, display: 'block' }}
              />
            </div>
          )}

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

      {activeNodes.length > 0 && (
        <div className="card mt-6">
          <div className="card-header">
            <div className="card-title">Service Details</div>
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
                {activeNodes.map(node => (
                  <tr key={node.serviceName}>
                    <td style={{ fontWeight: 600 }}>{node.serviceName}</td>
                    <td>
                      <span className="badge badge-ns" style={{
                        background: getColumnTheme(node.namespace || 'default', 0, isDarkTheme).headerBg,
                        color: getColumnTheme(node.namespace || 'default', 0, isDarkTheme).text,
                        border: `1px solid ${getColumnTheme(node.namespace || 'default', 0, isDarkTheme).border}`,
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        fontWeight: 600
                      }}>
                        {node.namespace || 'default'}
                      </span>
                    </td>
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

      {activeNodes.length === 0 && (
        <div className="card mt-4">
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-state-icon" style={{ color: 'var(--text-muted)', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="empty-state-title">No active services visible</div>
              <div className="empty-state-text">Toggle on namespaces to display service topology</div>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: 'var(--bg-card, rgba(15, 23, 42, 0.95))',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
            borderRadius: '8px',
            padding: '4px',
            minWidth: '160px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
            fontSize: '12px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--text-muted, #94a3b8)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '10px', textTransform: 'uppercase' }}>
            {contextMenu.nodeName}
          </div>
          <button
            className="context-menu-item"
            onClick={() => {
              navigate(`/traces?service=${contextMenu.nodeName}`);
              setContextMenu(null);
            }}
          >
            🔍 View Traces
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              alert(`RED metrics for ${contextMenu.nodeName}:
• Throughput: ${(Math.random() * 100 + 10).toFixed(1)} req/s
• Latency: p50: ${(Math.random() * 20 + 2).toFixed(1)}ms, p99: ${(Math.random() * 80 + 30).toFixed(1)}ms
• Error Rate: ${(Math.random() * 1.5).toFixed(2)}%`);
              setContextMenu(null);
            }}
          >
            📈 View Metrics
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              setHighlightedService(
                highlightedService === contextMenu.nodeName ? null : contextMenu.nodeName
              );
              setContextMenu(null);
            }}
          >
            🔗 {highlightedService === contextMenu.nodeName ? 'Clear Highlight' : 'Expand Dependencies'}
          </button>
        </div>
      )}

      {/* Context Menu Styles */}
      <style>{`
        .context-menu-item {
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          color: var(--text-primary);
          padding: 8px 12px;
          cursor: pointer;
          font-size: 11.5px;
          border-radius: 4px;
          transition: background 0.15s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .context-menu-item:hover {
          background: rgba(99, 102, 241, 0.15);
          color: var(--accent-indigo-light, #818cf8);
        }
      `}</style>
    </div>
  );
}
