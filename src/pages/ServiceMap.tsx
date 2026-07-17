import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { connectLiveStream } from '../api/liveStream';
import type { ServiceMapData, ServiceStats, Span, TraceListItem } from '../entities';
import { isSpanError } from '../utils/spanStatus';
import { createPortal } from 'react-dom';
import { LoadingState, NoDataState } from '../components/DataState';
import { useTranslation } from '../utils/i18n';

interface ServiceMapProps {
  namespace: string;
  collapsed?: boolean;
}

interface Particle {
  id: string;
  source: string;
  target: string;
  sourceNamespace?: string;
  targetNamespace?: string;
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
    name.includes('apm') ||
    name.includes('minio') ||
    name.includes('dns') ||
    name.includes('config') ||
    name.includes('liqui') ||
    name.includes('liquid') ||
    name.includes('nginx') ||
    name.includes('kong') ||
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(name) ||
    name.includes('.az') ||
    name.includes('.gov') ||
    name.includes('bridge')
  );
};

// Helper to get unique key for a node (Internet is global, others are namespace-scoped)
const getNodeKey = (node: { serviceName: string; namespace?: string } | string, fallbackNs?: string): string => {
  if (typeof node === 'string') {
    if (node === 'Internet') return 'Internet';
    return `${fallbackNs || 'default'}/${node}`;
  }
  if (node.serviceName === 'Internet') return 'Internet';
  return `${node.namespace || fallbackNs || 'default'}/${node.serviceName}`;
};

// Helper to get node dimensions based on its type and custom resize settings
const getNodeSize = (
  nodeKey: string,
  nodesList?: ServiceStats[],
  posSize?: { w?: number; h?: number }
) => {
  const firstSlash = nodeKey.indexOf('/');
  const nodeName = firstSlash !== -1 ? nodeKey.slice(firstSlash + 1) : nodeKey;
  const nodeNs = firstSlash !== -1 ? nodeKey.slice(0, firstSlash) : '';

  const node = nodesList?.find(n => 
    n.serviceName === nodeName && 
    (nodeName === 'Internet' || (n.namespace || 'default') === (nodeNs || 'default'))
  );
  const isInfra = node ? isInfraNode(node) : false;
  const defaultW = isInfra ? 190 : NODE_W;
  const defaultH = isInfra ? 90 : NODE_H;
  return {
    w: posSize?.w || defaultW,
    h: posSize?.h || defaultH,
  };
};

// Helper to parse infrastructure details from name (e.g. system (host/detail))
const parseInfraName = (name: string, ns: string = 'default'): { system: string; host?: string; detail?: string } => {
  const match = name.match(/^([^(]+)\(([^)]+)\)$/);
  
  let system = '';
  let host: string | undefined;
  let detail: string | undefined;

  if (match) {
    system = match[1].trim();
    const inner = match[2].trim();
    const slashIndex = inner.indexOf('/');
    if (slashIndex !== -1) {
      host = inner.slice(0, slashIndex).trim();
      detail = inner.slice(slashIndex + 1).trim();
    } else {
      host = inner;
    }
  } else {
    // Show only the system name when details are not reported.
    const lower = name.toLowerCase();
    if (lower.includes('postgres') || lower.includes('postgresql')) {
      system = 'PostgreSQL';
    } else if (lower.includes('redis')) {
      system = 'Redis';
    } else if (lower.includes('kafka')) {
      system = 'Kafka';
    } else if (lower.includes('rabbitmq') || lower.includes('message_bus')) {
      system = 'RabbitMQ';
    } else if (lower.includes('mongo')) {
      system = 'MongoDB';
    } else if (lower.includes('clickhouse')) {
      system = 'ClickHouse';
    } else if (lower.includes('elastic')) {
      system = 'Elasticsearch';
    } else if (lower.includes('minio')) {
      system = 'MinIO';
    } else if (lower.includes('mysql')) {
      system = 'MySQL';
    } else if (lower.includes('sqlite')) {
      system = 'SQLite';
    } else if (lower.includes('db-') || lower.endsWith('-db') || lower.includes('database') || lower.includes('db')) {
      const cleanSystem = name.replace(/[-_]db|db[-_]|database/gi, '').trim() || name;
      system = cleanSystem.charAt(0).toUpperCase() + cleanSystem.slice(1) + ' Database';
    } else if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(name) || lower.includes('vm')) {
      system = 'Virtual Machine';
    } else if (lower.includes('bridge') || lower.includes('.gov.az') || lower.includes('.az')) {
      system = 'API Bridge';
    } else {
      system = name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  return { system, host, detail };
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
  const isWebEndpoint = sys.includes('.') || sys.startsWith('http') || sys.includes('api') || sys.includes('proxy') || sys.includes('external');

  let matchedKey = '';
  if (sys.includes('mygov')) matchedKey = 'mygov';
  else if (sys.includes('redis')) matchedKey = 'redis';
  else if (sys.includes('kafka')) matchedKey = 'kafka';
  else if (sys.includes('rabbitmq') || sys.includes('message_bus')) matchedKey = 'rabbitmq';
  else if (sys.includes('apm')) matchedKey = 'apm';
  else if (sys.includes('vault')) matchedKey = 'vault';
  else if (sys.includes('elastic')) matchedKey = 'elasticsearch';
  else if (sys.includes('minio')) matchedKey = 'minio';
  else if (sys.includes('postgres')) matchedKey = 'postgres';
  else if (sys.includes('mysql')) matchedKey = 'mysql';
  else if (sys.includes('mongo')) matchedKey = 'mongodb';
  else if (sys.includes('liqui') || sys.includes('liquid')) matchedKey = 'liquibase';
  else if (sys.includes('nginx')) matchedKey = 'nginx';
  else if (sys.includes('kong')) matchedKey = 'kong';
  else if (sys.includes('clickhouse')) matchedKey = 'clickhouse';
  else if (sys.includes('dns')) matchedKey = 'dns';
  else if (sys.includes('database') || sys.includes('db')) matchedKey = 'database';
  else if (sys.includes('vm') || sys.includes('virtual machine') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(sys)) matchedKey = 'vm';
  else if (sys.includes('bridge') || sys.includes('gov.az')) matchedKey = 'bridge';

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
  } else if (sys.includes('rabbitmq') || sys.includes('message_bus')) {
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
  } else if (sys.includes('apm')) {
    // APM: Pulse wave line chart indicating telemetry/health metrics
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + size / 2 + 2);
    ctx.lineTo(x + size / 4, y + size / 2 + 2);
    ctx.lineTo(x + size / 2 - 2, y + 2);
    ctx.lineTo(x + size / 2 + 2, y + size - 2);
    ctx.lineTo(x + 3 * size / 4, y + size / 2);
    ctx.lineTo(x + size - 1, y + size / 2);
    ctx.stroke();
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
  } else if (sys.includes('config')) {
    // Config: Gear/Cog icon
    ctx.strokeStyle = isDark ? '#fbbf24' : '#d97706';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = isDark ? '#d97706' : '#fef3c7';

    const cx = x + size / 2;
    const cy = y + size / 2;
    const rOuter = size * 0.4;
    const rInner = size * 0.18;

    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, rOuter * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2, -rOuter, 4, 3);
      ctx.strokeRect(-2, -rOuter, 4, 3);
    }
    ctx.restore();
  } else if (sys.includes('dns')) {
    // DNS: Network globe (Amber)
    ctx.strokeStyle = isDark ? '#fbbf24' : '#d97706';
    ctx.lineWidth = 1.5;

    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * 0.4;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.5, r, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
  } else if (sys.includes('mygov')) {
    // MyGov: Blue circular emblem with stylized green crest inside
    ctx.strokeStyle = '#0284c7';
    ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(2, 132, 199, 0.08)';
    ctx.lineWidth = 1.5;
    
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * 0.45;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#10b981';
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy - 3);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx + 3, cy - 3);
    ctx.stroke();
  } else if (isWebEndpoint) {
    // Web / HTTP API Endpoint: Network globe (Blue)
    ctx.strokeStyle = isDark ? '#38bdf8' : '#0284c7';
    ctx.lineWidth = 1.5;

    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * 0.4;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.5, r, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
  } else if (sys.includes('liqui') || sys.includes('liquid')) {
    // Liquibase: Droplet
    ctx.strokeStyle = isDark ? '#fbbf24' : '#d97706';
    ctx.fillStyle = isDark ? 'rgba(217, 119, 6, 0.2)' : 'rgba(254, 243, 199, 0.6)';
    ctx.lineWidth = 1.5;

    const cx = x + size / 2;
    const cy = y + size / 2;

    ctx.beginPath();
    ctx.moveTo(cx, y + 2);
    ctx.bezierCurveTo(x + size - 2, cy + 2, x + size - 4, y + size - 2, cx, y + size - 2);
    ctx.bezierCurveTo(x + 4, y + size - 2, x + 2, cy + 2, cx, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (sys.includes('nginx')) {
    // Nginx: Green diamond/rhombus
    ctx.strokeStyle = '#009639';
    ctx.fillStyle = isDark ? 'rgba(0, 150, 57, 0.2)' : 'rgba(230, 244, 234, 0.8)';
    ctx.lineWidth = 2;

    const cx = x + size / 2;
    const cy = y + size / 2;

    ctx.beginPath();
    ctx.moveTo(cx, y + 1);
    ctx.lineTo(x + size - 1, cy);
    ctx.lineTo(cx, y + size - 1);
    ctx.lineTo(x + 1, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (sys.includes('vm') || sys.includes('virtual machine') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(sys)) {
    // VM: Stacked server blades with status indicator
    ctx.strokeStyle = isDark ? '#a855f7' : '#9333ea';
    ctx.fillStyle = isDark ? 'rgba(168, 85, 247, 0.15)' : 'rgba(168, 85, 247, 0.08)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, size, size, 2);
    } else {
      ctx.rect(x, y, size, size);
    }
    ctx.fill();
    ctx.stroke();

    const rackH = (size - 6) / 3;
    for (let i = 0; i < 3; i++) {
      const ry = y + 2 + i * rackH;
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)';
      ctx.fillRect(x + 2, ry + 1, size - 4, rackH - 2);
      ctx.strokeRect(x + 2, ry + 1, size - 4, rackH - 2);

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(x + 6, ry + rackH / 2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (sys.includes('bridge') || sys.includes('gov.az')) {
    // Bridge / API Gateway: Two columns connected by bridge deck
    ctx.strokeStyle = isDark ? '#06b6d4' : '#0891b2';
    ctx.fillStyle = isDark ? 'rgba(6, 182, 212, 0.15)' : 'rgba(6, 182, 212, 0.08)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    // left pier
    ctx.moveTo(x + 2, y + size - 2);
    ctx.lineTo(x + 5, y + size - 2);
    ctx.lineTo(x + 5, y + size / 2);
    ctx.lineTo(x + 2, y + size / 2);
    ctx.closePath();

    // right pier
    ctx.moveTo(x + size - 5, y + size - 2);
    ctx.lineTo(x + size - 2, y + size - 2);
    ctx.lineTo(x + size - 2, y + size / 2);
    ctx.lineTo(x + size - 5, y + size / 2);
    ctx.closePath();

    // deck & arch
    ctx.moveTo(x + 2, y + size / 2);
    ctx.quadraticCurveTo(x + size / 2, y + 4, x + size - 2, y + size / 2);
    ctx.lineTo(x + size - 2, y + size / 2 + 2);
    ctx.quadraticCurveTo(x + size / 2, y + 8, x + 2, y + size / 2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (sys.includes('kong')) {
    // Kong: Orange/Royal Blue geometric crown/shield
    ctx.strokeStyle = '#1155cc';
    ctx.fillStyle = isDark ? 'rgba(17, 85, 204, 0.2)' : 'rgba(230, 240, 250, 0.8)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x + 2, y + 4);
    ctx.lineTo(x + size / 2, y + 1);
    ctx.lineTo(x + size - 2, y + 4);
    ctx.lineTo(x + size - 6, y + size - 2);
    ctx.lineTo(x + 6, y + size - 2);
    ctx.closePath();
    ctx.fill();
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

export default function ServiceMap({ namespace, collapsed }: ServiceMapProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ServiceMapData | null>(null);
  const [visibleNamespaces, setVisibleNamespaces] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>('all');
  const [enabledNamespaces, setEnabledNamespaces] = useState<Set<string> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });

  // Interaction state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeName: string } | null>(null);
  const [highlightedService, setHighlightedService] = useState<string | null>(null);
  const navigate = useNavigate();

  // Click/Selection details drawer state
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [serviceTraces, setServiceTraces] = useState<TraceListItem[]>([]);
  const [loadingTraces, setLoadingTraces] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'traces' | 'metrics'>('traces');
  const mouseDownPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (selectedService) {
      document.body.classList.add('drawer-open');
    } else {
      document.body.classList.remove('drawer-open');
    }
    return () => {
      document.body.classList.remove('drawer-open');
    };
  }, [selectedService]);

  useEffect(() => {
    if (!selectedService) {
      setServiceTraces([]);
      return;
    }
    setLoadingTraces(true);
    
    const params: Record<string, string> = { limit: '15' };
    if (namespace) params.namespace = namespace;
    if (selectedService) params.service = selectedService;

    api.getTraces(params)
      .then((res) => {
        setServiceTraces(res?.traces || []);
      })
      .catch((err) => {
        console.error('Error fetching traces for service', selectedService, err);
        setServiceTraces([]);
      })
      .finally(() => {
        setLoadingTraces(false);
      });
  }, [selectedService, namespace]);

  // Refs for interaction tracking
  const isPanningRef = useRef(false);
  const isDraggingNodeRef = useRef<string | null>(null);
  const isDraggingZoneRef = useRef<string | null>(null);
  const isResizingNodeRef = useRef<string | null>(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const nodePositionsRef = useRef<Map<string, { x: number; y: number; w?: number; h?: number }>>(new Map());
  const customPositionsRef = useRef<Set<string>>(new Set());
  const lastLayoutDimensionsRef = useRef({ width: 0, height: 0 });
  const zoneHeadersRef = useRef<Map<string, { zx: number; zy: number; zw: number; zh: number; colName: string }>>(new Map());
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const highlightedServiceRef = useRef<string | null>(null);

  useEffect(() => { highlightedServiceRef.current = highlightedService; }, [highlightedService]);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    
    // Load custom node positions on initial mount
    try {
      const saved = localStorage.getItem('service_map_custom_positions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          parsed.forEach(([key, val]) => {
            nodePositionsRef.current.set(key, val);
            customPositionsRef.current.add(key);
          });
        }
      }
    } catch (e) {
      console.error('Error loading custom positions on mount:', e);
    }

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
      redis: '/logos/redis.svg',
      kafka: '/logos/kafka.svg',
      rabbitmq: '/logos/rabbitmq.svg',
      vault: '/logos/vault.svg',
      elasticsearch: '/logos/elasticsearch.svg',
      minio: '/logos/minio.svg',
      postgres: '/logos/postgres.svg',
      mysql: '/logos/mysql.svg',
      mongodb: '/logos/mongodb.svg',
      liquibase: '/logos/liquibase.svg',
      nginx: '/logos/nginx.svg',
      kong: '/logos/kong.svg',
      mygov: '/mygov-id.svg',
      vm: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linux.svg',
      bridge: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linkerd.svg',
      frontend: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg',
      backend: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/go/go-original.svg',
      clickhouse: '/logos/clickhouse.svg',
      apm: '/logos/apm.svg',
      dns: '/logos/dns.svg',
      database: '/logos/database.svg',
      // Language backends
      go: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/go/go-original.svg',
      php: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/php/php-original.svg',
      java: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/java/java-original.svg',
      node: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nodejs/nodejs-original.svg',
      python: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/python/python-original.svg',
      dotnet: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/dotnetcore/dotnetcore-original.svg',
      ruby: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/ruby/ruby-original.svg',
      rust: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/rust/rust-original.svg',
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
  const particleIdRef = useRef(0);
  const spanServiceCache = useRef<Map<string, string>>(new Map());
  const spanNamespaceCache = useRef<Map<string, string>>(new Map());
  const spanNameCache = useRef<Map<string, string>>(new Map());

  // Reload custom positions when active namespace selection changes
  useEffect(() => {
    nodePositionsRef.current.clear();
    customPositionsRef.current.clear();
    try {
      const saved = localStorage.getItem('service_map_custom_positions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          parsed.forEach(([key, val]) => {
            nodePositionsRef.current.set(key, val);
            customPositionsRef.current.add(key);
          });
        }
      }
    } catch (e) {
      console.error('Error reloading custom positions:', e);
    }
  }, [selectedNamespaces, namespace]);

  // Only namespaces with ingestion enabled (Namespace Manager) should ever appear here.
  useEffect(() => {
    let active = true;
    api.getNamespaceStatuses().then(res => {
      if (!active) return;
      setEnabledNamespaces(new Set(res.enabled || []));
    }).catch(() => {
      if (!active) return;
      setEnabledNamespaces(new Set());
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;

    const loadMap = () => {
      api.getServiceMap(namespace).then(res => {
        if (!active) return;
        setData(res);
        const nsList = res && res.nodes
          ? Array.from(new Set(res.nodes.map(n => n.namespace).filter(ns => ns && ns !== 'Internet')))
          : [];

        // Retrieve persisted namespaces or fallback to all
        let loadedNamespaces: string[] = [];
        let hasSaved = false;
        const saved = localStorage.getItem(`service_map_namespaces_${namespace || 'all'}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              loadedNamespaces = parsed;
              hasSaved = true;
            }
          } catch {}
        }

        if (!hasSaved) {
          if (namespace) {
            loadedNamespaces = [namespace];
          } else {
            loadedNamespaces = nsList;
          }
        }

        setVisibleNamespaces(prev => {
          const union = Array.from(new Set([...prev, ...nsList, ...loadedNamespaces]));
          return union;
        });

        setSelectedNamespaces(prev => {
          if (prev.length > 0) return prev;
          return loadedNamespaces;
        });
      }).catch(() => {
        if (!active) return;
        // Fallback in case of error: initialize namespaces from localStorage
        let loadedNamespaces: string[] = [];
        let hasSaved = false;
        const saved = localStorage.getItem(`service_map_namespaces_${namespace || 'all'}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              loadedNamespaces = parsed;
              hasSaved = true;
            }
          } catch {}
        }

        if (!hasSaved && namespace) {
          loadedNamespaces = [namespace];
        }

        setVisibleNamespaces(prev => {
          if (prev.length > 0) return prev;
          return loadedNamespaces;
        });
        setSelectedNamespaces(prev => {
          if (prev.length > 0) return prev;
          return loadedNamespaces;
        });
      });
    };

    loadMap();
    // Poll every 30 s — backend caches the map, so sub-second freshness is unnecessary.
    // Skip the poll if the tab is hidden to avoid wasting CPU / network in the background.
    let inFlight = false;
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      api.getServiceMap(namespace).then(res => {
        inFlight = false;
        if (!active) return;
        setData(res);
      }).catch(() => { inFlight = false; });
    }, 30000); // reload map data every 30 seconds

    return () => {
      active = false;
      clearInterval(interval);
    };
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
    // 1. Cache the span ID to service name, namespace and operation name
    spanServiceCache.current.set(span.spanId, span.serviceName);
    spanNamespaceCache.current.set(span.spanId, span.namespace);
    spanNameCache.current.set(span.spanId, span.name);
    if (spanServiceCache.current.size > 1500) {
      const firstKey = spanServiceCache.current.keys().next().value;
      if (firstKey) {
        spanServiceCache.current.delete(firstKey);
        spanNamespaceCache.current.delete(firstKey);
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
          id: `infra-${span.traceId || span.spanId || 'span'}-${particleIdRef.current++}`,
          source,
          target: infraName,
          sourceNamespace: span.namespace,
          targetNamespace: span.namespace,
          startTime: performance.now(),
          duration: 1000,
          isError: isSpanError(span),
          operationName: span.name || 'query',
          traceIdShort: span.traceId ? span.traceId.slice(0, 8) : '',
        });

        // Update the database/infra node stats in real-time
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            nodes: prev.nodes.map(node => {
              if (node.serviceName === infraName && (node.namespace || 'default') === (span.namespace || 'default')) {
                const reqs = node.requestCount + 1;
                const errs = node.errorCount + (isSpanError(span) ? 1 : 0);
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
    let sourceNamespace = '';
    if (!span.parentSpanId || span.parentSpanId === '0000000000000000' || span.parentSpanId === '0') {
      if (span.kind === 'SERVER') {
        source = 'Internet';
        sourceNamespace = span.namespace;
      }
    } else {
      source = spanServiceCache.current.get(span.parentSpanId) || '';
      sourceNamespace = spanNamespaceCache.current.get(span.parentSpanId) || '';
    }

    // Fallback heuristic for internal requests where parent span isn't in cache yet
    if (!source && span.kind === 'SERVER') {
      if (span.serviceName === 'gateway-backend') {
        source = 'Internet';
        sourceNamespace = span.namespace;
      } else {
        source = 'gateway-backend';
        sourceNamespace = span.namespace;
      }
    }

    if (!sourceNamespace) {
      sourceNamespace = span.namespace;
    }

    const target = span.serviceName;

    // 3. Trigger a dynamic particle if the call is external or inter-service
    if (source && target && source !== target) {
      particlesRef.current.push({
        id: `flow-${span.traceId || span.spanId || 'span'}-${particleIdRef.current++}`,
        source,
        target,
        sourceNamespace,
        targetNamespace: span.namespace,
        startTime: performance.now(),
        duration: 1000,
        isError: isSpanError(span),
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
          if (node.serviceName === target && (node.namespace || 'default') === (span.namespace || 'default')) {
            const reqs = node.requestCount + 1;
            const errs = node.errorCount + (isSpanError(span) ? 1 : 0);
            return {
              ...node,
              requestCount: reqs,
              errorCount: errs,
              errorRate: (errs / reqs) * 100,
              p50Ms: (node.p50Ms * node.requestCount + span.durationMs) / reqs,
            };
          }
          if (source === 'Internet' && node.serviceName === 'Internet' && (node.namespace || 'default') === (span.namespace || 'default')) {
            const reqs = node.requestCount + 1;
            const errs = node.errorCount + (isSpanError(span) ? 1 : 0);
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

  // Filter nodes and edges based on selected namespaces — restricted to namespaces with ingestion enabled.
  const activeNamespacesSet = new Set(
    namespace
      ? (enabledNamespaces && !enabledNamespaces.has(namespace) ? [] : [namespace])
      : selectedNamespaces.filter(ns => !enabledNamespaces || enabledNamespaces.has(ns))
  );

  const isNodeActive = useCallback((n: ServiceStats) => {
    if (n.serviceName === 'Internet') return true;

    // Check activity filter if set
    if (activityFilter !== 'all' && n.lastSeen) {
      const lastSeenTime = new Date(n.lastSeen).getTime();
      const now = Date.now();
      let threshold = 0;
      if (activityFilter === '5m') threshold = 5 * 60 * 1000;
      else if (activityFilter === '15m') threshold = 15 * 60 * 1000;
      else if (activityFilter === '1h') threshold = 60 * 60 * 1000;

      if (now - lastSeenTime > threshold) {
        return false;
      }
    }

    if (isInfraNode(n)) {
      if (n.namespace && activeNamespacesSet.has(n.namespace)) return true;
      // Also show infra node if an active namespace's own service actually calls THIS
      // specific namespace-scoped instance of it — match by namespace, not just name,
      // since many namespaces share identically-named resources (e.g. "postgresql").
      const nNs = n.namespace || 'default';
      return (data?.edges || []).some(edge => {
        const isSource = edge.source === n.serviceName && (edge.sourceNamespace || 'default') === nNs;
        const isTarget = edge.target === n.serviceName && (edge.targetNamespace || 'default') === nNs;
        if (!isSource && !isTarget) return false;
        const otherNs = isSource ? edge.targetNamespace : edge.sourceNamespace;
        return !!otherNs && activeNamespacesSet.has(otherNs);
      });
    }
    return activeNamespacesSet.has(n.namespace || 'default');
  }, [data, namespace, selectedNamespaces, activeNamespacesSet, activityFilter]);

  const activeNodes = (data?.nodes || []).filter(isNodeActive);
  const activeNodeKeys = new Set(activeNodes.map(n => getNodeKey(n)));
  const activeEdges = (data?.edges || []).filter(e => {
    const sourceKey = getNodeKey({ serviceName: e.source, namespace: e.sourceNamespace || namespace });
    const targetKey = getNodeKey({ serviceName: e.target, namespace: e.targetNamespace || namespace });
    return activeNodeKeys.has(sourceKey) && activeNodeKeys.has(targetKey);
  });

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
      
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
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
          customPositionsRef.current.add(nodeName);
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
          customPositionsRef.current.add(nodeName);
        }
      } else if (isDraggingZoneRef.current) {
        const colName = isDraggingZoneRef.current;
        const targetNodes = activeNodes.filter(n => {
          if (colName === 'Internet') return n.serviceName === 'Internet';
          if (colName === 'Infrastructure') return isInfraNode(n);
          return (n.namespace || 'default') === colName;
        });
        targetNodes.forEach(node => {
          const key = getNodeKey(node);
          const currentPos = nodePositionsRef.current.get(key);
          if (currentPos) {
            nodePositionsRef.current.set(key, {
              ...currentPos,
              x: currentPos.x + dx / zoomRef.current,
              y: currentPos.y + dy / zoomRef.current
            });
            customPositionsRef.current.add(key);
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

    const handleMouseUp = (e: MouseEvent) => {
      const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
      const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
      const isClick = dx < 4 && dy < 4;

      if (isClick) {
        const pos = getCanvasPos(e);
        const world = screenToWorld(pos.x, pos.y);
        const hitNodeKey = hitTestNode(world.x, world.y);
        if (hitNodeKey) {
          const firstSlash = hitNodeKey.indexOf('/');
          const serviceName = firstSlash !== -1 ? hitNodeKey.slice(firstSlash + 1) : hitNodeKey;
          setHighlightedService(prev => prev === serviceName ? null : serviceName);
        } else {
          setHighlightedService(null);
        }
      }

      if (isDraggingNodeRef.current || isDraggingZoneRef.current || isResizingNodeRef.current) {
        try {
          const entries = Array.from(nodePositionsRef.current.entries());
          localStorage.setItem('service_map_custom_positions', JSON.stringify(entries));
        } catch (err) {
          console.error('Error saving custom positions:', err);
        }
      }
      isPanningRef.current = false;
      isDraggingNodeRef.current = null;
      isDraggingZoneRef.current = null;
      isResizingNodeRef.current = null;
      canvas.style.cursor = 'default';
    };

    const handleDblClick = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const world = screenToWorld(pos.x, pos.y);
      const hitNodeKey = hitTestNode(world.x, world.y);
      if (hitNodeKey) {
        const firstSlash = hitNodeKey.indexOf('/');
        const serviceName = firstSlash !== -1 ? hitNodeKey.slice(firstSlash + 1) : hitNodeKey;
        setSelectedService(serviceName);
        setDrawerTab('traces');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      const world = screenToWorld(pos.x, pos.y);
      const hitNodeKey = hitTestNode(world.x, world.y);
      
      if (hitNodeKey) {
        const firstSlash = hitNodeKey.indexOf('/');
        const serviceName = firstSlash !== -1 ? hitNodeKey.slice(firstSlash + 1) : hitNodeKey;
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          nodeName: serviceName
        });
      } else {
        setContextMenu(null);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('dblclick', handleDblClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('dblclick', handleDblClick);
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

      // Compute initial DAG layout coordinates on columns if they are not already cached or if dimensions changed
      const dimsChanged = lastLayoutDimensionsRef.current.width !== dimensions.width || lastLayoutDimensionsRef.current.height !== dimensions.height;
      const needsLayout = dimsChanged || activeNodes.some(n => !nodePositionsRef.current.has(getNodeKey(n)));
      if (needsLayout && dimensions.width > 0) {
        // Clear all positions that are NOT user-customized, so they get recalculated for new container size
        for (const key of Array.from(nodePositionsRef.current.keys())) {
          if (!customPositionsRef.current.has(key)) {
            nodePositionsRef.current.delete(key);
          }
        }

        const colWidth = 200;
        const colSpacing = 120;

        const totalW = cols.length * colWidth + (cols.length - 1) * colSpacing;
        const startX = Math.max(80, (width - totalW) / 2);

        cols.forEach((col, c) => {
          // Calculate total height of this column based on node heights plus gaps
          let totalH = 0;
          col.nodes.forEach(node => {
            const key = getNodeKey(node);
            const { h } = getNodeSize(key, data?.nodes);
            totalH += h + 40; // 40px gap
          });
          totalH -= 40; // remove last gap

          const startY = Math.max(100, (height - totalH) / 2);
          const colX = startX + c * (colWidth + colSpacing);

          let currentY = startY;
          col.nodes.forEach((node) => {
            const key = getNodeKey(node);
            const { h } = getNodeSize(key, data?.nodes);
            if (!nodePositionsRef.current.has(key)) {
              nodePositionsRef.current.set(key, {
                x: colX + colWidth / 2,
                y: currentY + h / 2
              });
            }
            currentY += h + 40;
          });
        });

        lastLayoutDimensionsRef.current = { width: dimensions.width, height: dimensions.height };
      }

      const positions = nodePositionsRef.current;

      // --- Draw Namespace Bounding Box Cards (DrawSQL-style zones) ---
      cols.forEach((col, c) => {
        if (col.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasPositions = false;
        col.nodes.forEach(node => {
          const key = getNodeKey(node);
          const pos = positions.get(key);
          if (pos) {
            const { w, h } = getNodeSize(key, data?.nodes, pos);
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
        const sourceKey = getNodeKey({ serviceName: e.source, namespace: e.sourceNamespace || namespace });
        const current = outgoingTotalDuration.get(sourceKey) || 0;
        outgoingTotalDuration.set(sourceKey, current + e.avgDurationMs);
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
        const sourceKey = getNodeKey({ serviceName: edge.source, namespace: edge.sourceNamespace || namespace });
        const targetKey = getNodeKey({ serviceName: edge.target, namespace: edge.targetNamespace || namespace });
        const from = positions.get(sourceKey);
        const to = positions.get(targetKey);
        if (!from || !to) return;

        const totalDuration = outgoingTotalDuration.get(sourceKey) || 0;
        const contributionPercent = totalDuration > 0 ? (edge.avgDurationMs / totalDuration) * 100 : 0;

        const isError = edge.errorCount > 0;
        const isCritical = contributionPercent > 50 && edge.avgDurationMs > 50;

        const { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 } = getEdgeCurve(sourceKey, from, targetKey, to);

        // Highlight/dim logic
        const hs = highlightedServiceRef.current;
        const isSelf = edge.source === hs || edge.target === hs;
        const shouldDim = hs !== null && !isSelf;
        ctx.globalAlpha = shouldDim ? 0.05 : 1.0;

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
        const sourceKey = getNodeKey({ serviceName: particle.source, namespace: particle.sourceNamespace || namespace });
        const targetKey = getNodeKey({ serviceName: particle.target, namespace: particle.targetNamespace || namespace });
        const from = positions.get(sourceKey);
        const to = positions.get(targetKey);
        if (!from || !to) return false;

        // Ignore particles targeting nodes that are currently toggled off
        if (!activeNodeKeys.has(sourceKey) || !activeNodeKeys.has(targetKey)) return false;

        const progress = (now - particle.startTime) / particle.duration;
        if (progress >= 1) return false;

        // Highlight/dim logic
        const hs = highlightedServiceRef.current;
        const isSelf = particle.source === hs || particle.target === hs;
        const shouldDim = hs !== null && !isSelf;
        ctx.globalAlpha = shouldDim ? 0.05 : 1.0;

        const { x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2 } = getEdgeCurve(sourceKey, from, targetKey, to);
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
        const key = getNodeKey(node);
        const pos = positions.get(key);
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
        ctx.globalAlpha = shouldDim ? 0.08 : 1.0;

        const { w, h } = getNodeSize(key, data?.nodes, pos);
        const rx = pos.x - w / 2;
        const ry = pos.y - h / 2;

        ctx.save();
        const pulse = 1 + 0.05 * Math.sin(Date.now() * 0.005);
        const glowRadius = Math.max(w, h) * 0.8 * pulse;

        // Skip glow/halo if the node is dimmed
        if (!shouldDim) {
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
        }

        // Disable shadows on dimmed nodes to prevent glowing artifacts
        ctx.shadowBlur = shouldDim ? 0 : (hasErrors ? 12 : 6);
        ctx.shadowColor = shouldDim ? 'transparent' : (isInternet
          ? 'rgba(56, 189, 248, 0.4)'
          : isInfra
            ? 'rgba(245, 158, 11, 0.4)'
            : hasErrors ? 'rgba(244, 63, 94, 0.4)' : 'rgba(99, 102, 241, 0.3)');

        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        // Draw a quiet neutral border if the node is dimmed, otherwise draw themed/error borders
        ctx.strokeStyle = shouldDim
          ? (isDark ? '#334155' : '#e2e8f0')
          : (isInternet
            ? '#38bdf8'
            : isInfra
              ? '#f59e0b'
              : hasErrors ? '#f43f5e' : (isDark ? '#475569' : '#cbd5e1'));
        ctx.lineWidth = shouldDim ? 1 : (hasErrors ? 2.5 : 1.5);

        ctx.setLineDash([]);

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
          const parsed = parseInfraName(node.serviceName, node.namespace || 'default');
          const iconSize = 20;
          const iconX = rx + 12;
          const iconY = ry + 12;

          // For mygov: draw the full logo (no clip) at compact height, then "MYGOV" label after it
          const mygovImg = iconImagesRef.current?.get('mygov');
          const isMyGovNode = node.serviceName.toLowerCase().includes('mygov');
          if (isMyGovNode && mygovImg && mygovImg.complete && mygovImg.naturalWidth !== 0) {
            const aspect = mygovImg.naturalWidth / mygovImg.naturalHeight;
            const logoH = 14; // compact height matching other icon visual weight
            const logoW = logoH * aspect; // natural width, no clipping
            const logoDrawY = iconY + (iconSize - logoH) / 2; // vertically centred in icon row
            ctx.save();
            ctx.drawImage(mygovImg, iconX, logoDrawY, logoW, logoH);
            ctx.restore();

            // "MYGOV" label starts just after the logo ends
            ctx.font = '800 11px Inter';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isDark ? '#fbbf24' : '#d97706';
            ctx.fillText('MYGOV', iconX + logoW + 5, iconY + iconSize / 2);
          } else {
            // Draw the custom icon at (iconX, iconY) with size (iconSize, iconSize)
            drawInfraIcon(ctx, node.serviceName, iconX, iconY, iconSize, isDark, iconImagesRef.current);

            // Draw System Name in bold uppercase
            ctx.font = '800 11px Inter';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isDark ? '#fbbf24' : '#d97706'; // Amber accent for infra system name
            const systemName = parsed.system.toUpperCase();
            ctx.fillText(systemName, rx + 38, iconY + iconSize / 2);
          }

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
          const isInternet = node.serviceName === 'Internet';
          const isFrontend = node.serviceName.toLowerCase().includes('frontend') || node.serviceName.toLowerCase().includes('ui') || node.serviceName.toLowerCase().includes('client');
          const isBackend = !isInternet && !isFrontend;

          const iconSize = 20;
          const iconX = rx + 12;
          const iconY = ry + (h - iconSize) / 2;

          let imgKey = '';
          if (isFrontend) {
            imgKey = 'frontend';
          } else if (isBackend && !isInternet) {
            // First check if the backend dynamically detected the language
            if (node.language) {
              const lang = node.language.toLowerCase();
              if (lang.includes('go') || lang.includes('golang')) imgKey = 'go';
              else if (lang.includes('php')) imgKey = 'php';
              else if (lang.includes('java') || lang.includes('jvm')) imgKey = 'java';
              else if (lang.includes('node') || lang.includes('javascript') || lang.includes('typescript') || lang.includes('js')) imgKey = 'node';
              else if (lang.includes('python')) imgKey = 'python';
              else if (lang.includes('dotnet') || lang.includes('c#') || lang.includes('csharp')) imgKey = 'dotnet';
              else if (lang.includes('ruby')) imgKey = 'ruby';
              else if (lang.includes('rust')) imgKey = 'rust';
            }
            
            // Fallback to name-based heuristics if language is not yet detected/populated
            if (!imgKey) {
              const sName = node.serviceName.toLowerCase();
              if (sName.includes('php')) {
                imgKey = 'php';
              } else if (sName.includes('java') || sName.includes('spring') || sName.includes('boot')) {
                imgKey = 'java';
              } else if (sName.includes('go') || sName.includes('golang') || sName.includes('gopkg')) {
                imgKey = 'go';
              } else if (sName.includes('node') || sName.includes('express') || sName.includes('nestjs') || sName.includes('javascript') || sName.includes('typescript') || sName.includes('external')) {
                imgKey = 'node';
              } else if (sName.includes('python') || sName.includes('django') || sName.includes('flask') || sName.includes('fastapi') || sName.includes('adapter')) {
                imgKey = 'python';
              } else if (sName.includes('dotnet') || sName.includes('csharp') || sName.includes('aspnet')) {
                imgKey = 'dotnet';
              } else if (sName.includes('ruby') || sName.includes('rails')) {
                imgKey = 'ruby';
              } else if (sName.includes('rust')) {
                imgKey = 'rust';
              } else {
                imgKey = 'backend';
              }
            }
          }

          const img = imgKey ? iconImagesRef.current?.get(imgKey) : null;
          if (img && img.complete && img.naturalWidth !== 0) {
            ctx.save();
            ctx.drawImage(img, iconX, iconY, iconSize, iconSize);
            ctx.restore();
          }

          const textX = img ? rx + 38 : rx + 12;
          const centerY = ry + h / 2;

          // Draw Service Name Text
          ctx.font = '700 11px Inter';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
          let displayName = node.serviceName;
          const maxLen = Math.floor((w - (img ? 38 : 12)) / 8.5);
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
          const key = getNodeKey(node);
          const pos = positions.get(key);
          if (pos) {
            const { w, h } = getNodeSize(key, data?.nodes, pos);
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
            const sKey = getNodeKey({ serviceName: edge.source, namespace: edge.sourceNamespace || namespace });
            const tKey = getNodeKey({ serviceName: edge.target, namespace: edge.targetNamespace || namespace });
            const sPos = positions.get(sKey);
            const tPos = positions.get(tKey);
            if (sPos && tPos) {
              minimapCtx.beginPath();
              minimapCtx.moveTo(sPos.x * scale + offsetX, sPos.y * scale + offsetY);
              minimapCtx.lineTo(tPos.x * scale + offsetX, tPos.y * scale + offsetY);
              minimapCtx.stroke();
            }
          });

          // Minimap nodes
          activeNodes.forEach(node => {
            const key = getNodeKey(node);
            const pos = positions.get(key);
            if (pos) {
              const { w, h } = getNodeSize(key, data?.nodes, pos);
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
      let w = window.innerWidth - (collapsed ? 144 : 340);
      if (containerRef.current) {
        w = containerRef.current.clientWidth;
      }
      setDimensions({ width: Math.max(600, w), height: 600 });
    };
    handleResize();
    const timer = setTimeout(handleResize, 200); // Account for sidebar transition
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [collapsed]);

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
    nodePositionsRef.current.clear();
    customPositionsRef.current.clear();
    lastLayoutDimensionsRef.current = { width: 0, height: 0 };
    localStorage.removeItem('service_map_custom_positions');
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

  // Namespace pills only ever offer namespaces with ingestion enabled in Namespace Manager.
  const filterableNamespaces = enabledNamespaces
    ? visibleNamespaces.filter(ns => enabledNamespaces.has(ns))
    : visibleNamespaces;

  const handleToggleAll = () => {
    let next: string[];
    if (selectedNamespaces.length === filterableNamespaces.length) {
      next = [];
    } else {
      next = [...filterableNamespaces];
    }
    setSelectedNamespaces(next);
    localStorage.setItem(`service_map_namespaces_${namespace || 'all'}`, JSON.stringify(next));
  };

  const isDarkTheme = document.body.classList.contains('dark-theme');
  const applicationNodes = activeNodes.filter(node => node.serviceName !== 'Internet' && !isInfraNode(node));
  const infrastructureNodes = activeNodes.filter(node => isInfraNode(node));
  const totalRequests = activeNodes.reduce((sum, node) => sum + node.requestCount, 0);
  const totalErrors = activeNodes.reduce((sum, node) => sum + node.errorCount, 0);
  const mapErrorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  const weightedP95 = weightedMapValue(applicationNodes.length > 0 ? applicationNodes : activeNodes, node => node.p95Ms, node => node.requestCount);
  const criticalNodes = activeNodes.filter(node => getMapNodeHealth(node).tone === 'critical');
  const degradedNodes = activeNodes.filter(node => getMapNodeHealth(node).tone === 'warning');
  const selectedNode = selectedService
    ? activeNodes.find(node => node.serviceName === selectedService) || data?.nodes.find(node => node.serviceName === selectedService) || null
    : null;
  const selectedIncoming = selectedService ? activeEdges.filter(edge => edge.target === selectedService) : [];
  const selectedOutgoing = selectedService ? activeEdges.filter(edge => edge.source === selectedService) : [];
  const topServices = [...activeNodes]
    .filter(node => node.serviceName !== 'Internet')
    .sort((a, b) => getMapNodeRisk(b) - getMapNodeRisk(a))
    .slice(0, 8);
  const topPaths = [...activeEdges]
    .sort((a, b) => getMapEdgeWeight(b) - getMapEdgeWeight(a))
    .slice(0, 6);
  const mapStatusTone = data === null
    ? 'neutral'
    : criticalNodes.length > 0
      ? 'critical'
      : degradedNodes.length > 0
        ? 'warning'
        : activeNodes.length > 0
          ? 'healthy'
          : 'neutral';
  const mapStatusLabel = data === null
    ? t('Loading')
    : activeNodes.length === 0
      ? t('No data')
      : criticalNodes.length > 0
        ? t('Action needed')
        : degradedNodes.length > 0
          ? t('Watch')
          : t('Healthy');

  return (
    <div className="service-map-page animate-fade-in">
      <section className="service-map-hero">
        <div className="service-map-title-block">
          <span className="service-map-eyebrow">
            <ServiceMapIcon name="network" />
            {t('Live topology')}
          </span>
          <h1>{t('Service Map')}</h1>
          <p>
            {namespace
              ? t('Service dependencies in {{namespace}}').replace('{{namespace}}', namespace)
              : t('Service dependencies across all namespaces')}
          </p>
        </div>
        <div className="service-map-hero-actions">
          <button className="service-map-tool-button" onClick={handleFitView} disabled={activeNodes.length === 0}>
            <ServiceMapIcon name="focus" />
            {t('Fit')}
          </button>
          <button className="service-map-tool-button" onClick={handleReset}>
            <ServiceMapIcon name="reset" />
            {t('Reset')}
          </button>
        </div>
      </section>

      <section className="service-map-kpi-grid">
        <ServiceMapStatCard
          icon="services"
          label={t('Applications')}
          value={formatMapNumber(applicationNodes.length)}
          detail={`${formatMapNumber(activeNodes.length)} ${t('visible nodes')}`}
          tone={applicationNodes.length > 0 ? 'info' : 'neutral'}
        />
        <ServiceMapStatCard
          icon="flow"
          label={t('Dependencies')}
          value={formatMapNumber(activeEdges.length)}
          detail={`${formatMapNumber(infrastructureNodes.length)} ${t('infra nodes')}`}
          tone="info"
        />
        <ServiceMapStatCard
          icon="activity"
          label={t('Traffic')}
          value={formatMapNumber(totalRequests)}
          detail={`${formatMapNumber(totalErrors)} ${t('errors')}`}
          tone={totalErrors > 0 ? 'warning' : totalRequests > 0 ? 'healthy' : 'neutral'}
        />
        <ServiceMapStatCard
          icon="latency"
          label={t('Weighted P95')}
          value={formatMapMs(weightedP95)}
          detail={`${formatMapPercent(mapErrorRate)} ${t('error rate')}`}
          tone={mapErrorRate > 5 ? 'critical' : weightedP95 > 1000 ? 'warning' : totalRequests > 0 ? 'healthy' : 'neutral'}
        />
      </section>

      {namespace && enabledNamespaces && !enabledNamespaces.has(namespace) && (
        <div className="service-map-alert">
          <ServiceMapIcon name="alert" />
          <span>
            <strong>{t('Ingestion is disabled')}</strong> {t('for')} <code className="mono">{namespace}</code>. {t('Enable it in Namespace Manager to see its service map.')}
          </span>
        </div>
      )}

      <section className="service-map-toolbar">
        <div className="service-map-filter-group">
          <span className="service-map-filter-label">
            <ServiceMapIcon name="namespace" />
            {t('Namespaces')}
          </span>
          {!namespace && filterableNamespaces.length > 0 ? (
            <div className="service-map-namespace-row">
              <button
                onClick={handleToggleAll}
                className="service-map-chip service-map-chip-action"
              >
                {selectedNamespaces.length === filterableNamespaces.length ? t('Clear All') : t('Select All')}
              </button>
              {filterableNamespaces.map((ns, idx) => {
                const theme = getColumnTheme(ns, idx, isDarkTheme);
                const isSelected = selectedNamespaces.includes(ns);
                return (
                  <button
                    key={ns}
                    onClick={() => handleToggleNamespace(ns)}
                    className={`service-map-chip ${isSelected ? 'active' : ''}`}
                    style={{
                      '--sm-chip-bg': isSelected ? theme.headerBg : 'transparent',
                      '--sm-chip-color': isSelected ? theme.text : 'var(--text-secondary)',
                      '--sm-chip-border': isSelected ? theme.border : 'var(--border-primary)',
                    } as React.CSSProperties}
                  >
                    <span />
                    {ns}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="service-map-scope-pill">{namespace || t('All namespaces')}</span>
          )}
        </div>

        <label className="service-map-select-field">
          <span>{t('Activity')}</span>
          <select value={activityFilter} onChange={(e) => setActivityFilter(e.target.value)}>
            <option value="all">{t('All nodes')}</option>
            <option value="5m">{t('Last 5m')}</option>
            <option value="15m">{t('Last 15m')}</option>
            <option value="1h">{t('Last 1h')}</option>
          </select>
        </label>
      </section>

      <section className="service-map-shell">
        <div className="service-map-shell-header">
          <div>
            <span className={`service-map-status-pill ${mapStatusTone}`}>
              <i />
              {mapStatusLabel}
            </span>
            <h2>{t('Service Topology')}</h2>
          </div>
          <div className="service-map-shell-meta">
            <span>{formatMapNumber(activeNodes.length)} {t('nodes')}</span>
            <span>{formatMapNumber(activeEdges.length)} {t('edges')}</span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        <div className="service-map-canvas-area" ref={containerRef}>
          <canvas
            ref={canvasRef}
            className="service-map-canvas"
            style={{ width: dimensions.width, height: dimensions.height }}
          />

          {(data === null || activeNodes.length === 0) && (
            <div className="service-map-empty-overlay">
              {data === null ? (
                <LoadingState height={220} label={t("Discovering service topology…")} />
              ) : (
                <NoDataState
                  height={220}
                  title={t("No services discovered yet")}
                  hint={t("Enable tracing and send traffic to draw the map.")}
                  icon={
                    <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="5" cy="6" r="2.2" /><circle cx="19" cy="6" r="2.2" /><circle cx="12" cy="18" r="2.2" />
                      <path d="M7 7.2 L10.4 16 M17 7.2 L13.6 16 M7.2 6 L16.8 6" strokeDasharray="2.5 3" />
                    </svg>
                  }
                />
              )}
            </div>
          )}

          {activeNodes.length > 0 && (
            <div className="service-map-legend">
              <ServiceMapLegendItem tone="healthy" label={t('Healthy')} />
              <ServiceMapLegendItem tone="warning" label={t('Latency')} />
              <ServiceMapLegendItem tone="critical" label={t('Errors')} />
              <ServiceMapLegendItem tone="infra" label={t('Infrastructure')} />
            </div>
          )}

          {activeNodes.length > 0 && (
            <div className="service-map-minimap">
              <canvas
                ref={minimapCanvasRef}
                style={{ width: 160, height: 100, display: 'block' }}
              />
            </div>
          )}

          <div className="service-map-zoom-controls">
            {[
              { icon: 'plus' as const, title: t('Zoom In'), handler: handleZoomIn },
              { icon: 'minus' as const, title: t('Zoom Out'), handler: handleZoomOut },
              { icon: 'focus' as const, title: t('Fit View'), handler: handleFitView },
              { icon: 'reset' as const, title: t('Reset'), handler: handleReset },
            ].map(btn => (
              <button
                key={btn.title}
                title={btn.title}
                onClick={btn.handler}
              >
                <ServiceMapIcon name={btn.icon} />
              </button>
            ))}
          </div>
        </div>
      </section>

      {activeNodes.length > 0 && (
        <section className="service-map-insights-grid">
          <div className="service-map-panel">
            <div className="service-map-panel-header">
              <div>
                <span>{t('Service Health')}</span>
                <h3>{t('Highest risk nodes')}</h3>
              </div>
              <strong>{formatMapNumber(topServices.length)}</strong>
            </div>
            <div className="service-map-node-list">
              {topServices.map(node => (
                <ServiceMapNodeCard
                  key={getNodeKey(node)}
                  node={node}
                  onClick={() => {
                    setSelectedService(node.serviceName);
                    setDrawerTab('metrics');
                  }}
                />
              ))}
            </div>
          </div>

          <div className="service-map-panel">
            <div className="service-map-panel-header">
              <div>
                <span>{t('Critical Paths')}</span>
                <h3>{t('Slowest or failing edges')}</h3>
              </div>
              <strong>{formatMapNumber(topPaths.length)}</strong>
            </div>
            <div className="service-map-path-list">
              {topPaths.length === 0 ? (
                <NoDataState height={180} title={t('No dependency edges yet')} hint={t('Edges appear after service-to-service traces arrive.')} />
              ) : (
                topPaths.map(edge => (
                  <button
                    key={`${edge.sourceNamespace || 'default'}:${edge.source}->${edge.targetNamespace || 'default'}:${edge.target}`}
                    className={`service-map-path-card ${edge.errorCount > 0 ? 'critical' : edge.avgDurationMs > 1000 ? 'warning' : ''}`}
                    onClick={() => setHighlightedService(edge.source)}
                  >
                    <div className="service-map-path-main">
                      <strong>{edge.source}</strong>
                      <ServiceMapIcon name="arrow" />
                      <strong>{edge.target}</strong>
                    </div>
                    <div className="service-map-path-metrics">
                      <span>{formatMapNumber(edge.callCount)} {t('calls')}</span>
                      <span>{formatMapMs(edge.avgDurationMs)}</span>
                      <span>{formatMapNumber(edge.errorCount)} {t('errors')}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="service-map-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="service-map-context-title">
            <span>{t('Service')}</span>
            <strong>{contextMenu.nodeName}</strong>
          </div>
          <button
            className="service-map-context-item"
            onClick={() => {
              navigate(`/traces?service=${encodeURIComponent(contextMenu.nodeName)}`);
              setContextMenu(null);
            }}
          >
            <ServiceMapIcon name="trace" />
            {t('View Traces')}
          </button>
          <button
            className="service-map-context-item"
            onClick={() => {
              navigate(`/services?service=${encodeURIComponent(contextMenu.nodeName)}`);
              setContextMenu(null);
            }}
          >
            <ServiceMapIcon name="metrics" />
            {t('View Metrics')}
          </button>
          <button
            className="service-map-context-item"
            onClick={() => {
              setHighlightedService(
                highlightedService === contextMenu.nodeName ? null : contextMenu.nodeName
              );
              setContextMenu(null);
            }}
          >
            <ServiceMapIcon name="focus" />
            {highlightedService === contextMenu.nodeName ? t('Clear Focus') : t('Focus Dependencies')}
          </button>
        </div>
      )}

      {/* Sliding Drawer for Clicked Service Details via React Portal to cover whole screen */}
      {createPortal(
        <>
          <div 
            className={`service-map-drawer-backdrop ${selectedService ? 'open' : ''}`}
            onClick={() => setSelectedService(null)} 
          />
          <div className={`span-drawer service-map-drawer ${selectedService ? 'open' : ''}`}>
            {selectedService && (
              <>
                <div className="service-map-drawer-header">
                  <div className="service-map-drawer-title">
                    <span>{selectedNode?.namespace || namespace || 'default'}</span>
                    <h2>{selectedService}</h2>
                    <p>
                      {selectedNode
                        ? `${formatMapNumber(selectedNode.requestCount)} ${t('calls')} / ${formatMapPercent(selectedNode.errorRate)} ${t('errors')}`
                        : t('Service details')}
                    </p>
                  </div>
                  <button className="service-map-drawer-close" onClick={() => setSelectedService(null)} title={t('Close')}>
                    <ServiceMapIcon name="close" />
                  </button>
                </div>

                <div className="service-map-drawer-tabs">
                  <button
                    className={drawerTab === 'traces' ? 'active' : ''}
                    onClick={() => setDrawerTab('traces')}
                  >
                    <ServiceMapIcon name="trace" />
                    {t('Recent Traces')}
                  </button>
                  <button
                    className={drawerTab === 'metrics' ? 'active' : ''}
                    onClick={() => setDrawerTab('metrics')}
                  >
                    <ServiceMapIcon name="network" />
                    {t('Topology')}
                  </button>
                </div>

                <div className="service-map-drawer-content">
                  {drawerTab === 'traces' ? (
                    <div className="service-map-drawer-section">
                      <div className="service-map-drawer-section-title">
                        <span>{t('Recent transactions')}</span>
                        <strong>{formatMapNumber(serviceTraces.length)}</strong>
                      </div>

                      {loadingTraces ? (
                        <LoadingState height={180} label={t('Loading traces...')} />
                      ) : serviceTraces.length === 0 ? (
                        <NoDataState height={180} title={t('No recent transactions')} hint={t('Traces appear here when this service receives traffic.')} />
                      ) : (
                        <div className="service-map-trace-list">
                          {serviceTraces.map((item) => (
                            <button
                              key={item.traceId}
                              className={`service-map-trace-card ${item.hasError ? 'critical' : ''}`}
                              onClick={() => navigate(`/traces/${item.traceId}`)}
                            >
                              <div className="service-map-trace-title">
                                <strong title={item.rootName || 'Transaction'}>{item.rootName || 'Transaction'}</strong>
                                <span className={item.hasError ? 'critical' : 'healthy'}>{item.hasError ? 'ERROR' : 'OK'}</span>
                              </div>
                              <div className="service-map-trace-meta">
                                <code>{item.traceId.slice(0, 10)}...</code>
                                <span>{new Date(item.startTime).toLocaleTimeString()}</span>
                                <strong>{formatMapMs(item.durationMs)}</strong>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="service-map-drawer-section">
                      {selectedNode ? (
                        <>
                          <div className="service-map-drawer-metrics">
                            <ServiceMapMetricBox label={t('Throughput')} value={formatMapNumber(selectedNode.requestCount)} detail={t('calls')} />
                            <ServiceMapMetricBox label={t('Error Rate')} value={formatMapPercent(selectedNode.errorRate)} detail={`${formatMapNumber(selectedNode.errorCount)} ${t('errors')}`} tone={selectedNode.errorCount > 0 ? 'critical' : 'healthy'} />
                            <ServiceMapMetricBox label={t('P95')} value={formatMapMs(selectedNode.p95Ms)} detail={`P50 ${formatMapMs(selectedNode.p50Ms)}`} tone={selectedNode.p95Ms > 1000 ? 'warning' : 'neutral'} />
                            <ServiceMapMetricBox label={t('P99')} value={formatMapMs(selectedNode.p99Ms)} detail={selectedNode.lastSeen ? formatRelativeTime(selectedNode.lastSeen) : t('No recent activity')} tone={selectedNode.p99Ms > 2000 ? 'warning' : 'neutral'} />
                          </div>

                          <div className="service-map-drawer-actions">
                            <button onClick={() => navigate(`/traces?service=${encodeURIComponent(selectedService)}`)}>
                              <ServiceMapIcon name="trace" />
                              {t('Open traces')}
                            </button>
                            <button onClick={() => navigate(`/services?service=${encodeURIComponent(selectedService)}`)}>
                              <ServiceMapIcon name="metrics" />
                              {t('Open metrics')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <NoDataState height={160} title={t('Metrics unavailable')} hint={t('This component is not visible in the current filter.')} />
                      )}

                      <ServiceMapConnectionList
                        title={t('Incoming Callers')}
                        empty={t('No incoming callers.')}
                        edges={selectedIncoming}
                        direction="incoming"
                        onSelect={setSelectedService}
                      />
                      <ServiceMapConnectionList
                        title={t('Outgoing Dependencies')}
                        empty={t('No outgoing calls.')}
                        edges={selectedOutgoing}
                        direction="outgoing"
                        onSelect={setSelectedService}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

type ServiceMapTone = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';
type ServiceMapIconName =
  | 'activity'
  | 'alert'
  | 'arrow'
  | 'close'
  | 'flow'
  | 'focus'
  | 'latency'
  | 'metrics'
  | 'minus'
  | 'namespace'
  | 'network'
  | 'plus'
  | 'reset'
  | 'services'
  | 'trace';

function ServiceMapStatCard({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: ServiceMapIconName;
  label: string;
  value: string;
  detail: string;
  tone?: ServiceMapTone;
}) {
  return (
    <div className={`service-map-stat-card ${tone}`}>
      <div className="service-map-stat-icon">
        <ServiceMapIcon name={icon} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

function ServiceMapLegendItem({ tone, label }: { tone: ServiceMapTone | 'infra'; label: string }) {
  return (
    <span className={`service-map-legend-item ${tone}`}>
      <i />
      {label}
    </span>
  );
}

function ServiceMapNodeCard({ node, onClick }: { node: ServiceStats; onClick: () => void }) {
  const health = getMapNodeHealth(node);
  const isInfra = isInfraNode(node);
  return (
    <button className={`service-map-node-card ${health.tone}`} onClick={onClick}>
      <div className="service-map-node-card-top">
        <span className="service-map-node-kind">
          <ServiceMapIcon name={isInfra ? 'network' : 'services'} />
        </span>
        <div>
          <strong title={node.serviceName}>{node.serviceName}</strong>
          <em>{isInfra ? 'Infrastructure' : (node.namespace || 'default')}</em>
        </div>
        <i className={`service-map-node-state ${health.tone}`} />
      </div>
      <div className="service-map-node-card-metrics">
        <span>{formatMapNumber(node.requestCount)} calls</span>
        <span>{formatMapPercent(node.errorRate)} err</span>
        <span>{formatMapMs(node.p95Ms)} p95</span>
      </div>
      <div className="service-map-health-bar">
        <i className={health.tone} style={{ width: `${Math.max(4, health.score)}%` }} />
      </div>
    </button>
  );
}

function ServiceMapMetricBox({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: ServiceMapTone;
}) {
  return (
    <div className={`service-map-metric-box ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function ServiceMapConnectionList({
  title,
  empty,
  edges,
  direction,
  onSelect,
}: {
  title: string;
  empty: string;
  edges: ServiceMapData['edges'];
  direction: 'incoming' | 'outgoing';
  onSelect: (serviceName: string) => void;
}) {
  return (
    <div className="service-map-connection-section">
      <div className="service-map-drawer-section-title">
        <span>{title}</span>
        <strong>{formatMapNumber(edges.length)}</strong>
      </div>
      {edges.length === 0 ? (
        <div className="service-map-connection-empty">{empty}</div>
      ) : (
        <div className="service-map-connection-list">
          {edges.map(edge => {
            const serviceName = direction === 'incoming' ? edge.source : edge.target;
            return (
              <button
                key={`${edge.sourceNamespace || 'default'}:${edge.source}->${edge.targetNamespace || 'default'}:${edge.target}`}
                className={`service-map-connection-card ${edge.errorCount > 0 ? 'critical' : edge.avgDurationMs > 1000 ? 'warning' : ''}`}
                onClick={() => onSelect(serviceName)}
              >
                <div>
                  <strong title={serviceName}>{serviceName}</strong>
                  <span>{direction === 'incoming' ? (edge.sourceNamespace || 'default') : (edge.targetNamespace || 'default')}</span>
                </div>
                <em>{formatMapNumber(edge.callCount)} calls</em>
                <em>{formatMapMs(edge.avgDurationMs)}</em>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ServiceMapIcon({ name }: { name: ServiceMapIconName }) {
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
    case 'close':
      return <svg {...common}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
    case 'flow':
      return <svg {...common}><circle cx="5" cy="6" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7.4 7.6 10.8 16" /><path d="m16.6 7.6-3.4 8.4" /><path d="M8 6h8" /></svg>;
    case 'focus':
      return <svg {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3" /><path d="M16 4h3a1 1 0 0 1 1 1v3" /><path d="M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'latency':
      return <svg {...common}><path d="M9 2h6" /><path d="M12 6v5l3 2" /><circle cx="12" cy="14" r="8" /></svg>;
    case 'metrics':
      return <svg {...common}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15v-4" /><path d="M12 15V8" /><path d="M16 15v-6" /></svg>;
    case 'minus':
      return <svg {...common}><path d="M5 12h14" /></svg>;
    case 'namespace':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case 'network':
      return <svg {...common}><path d="M12 3v5" /><path d="M6 13H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2" /><path d="M12 16v5" /><rect x="8" y="8" width="8" height="8" rx="2" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case 'reset':
      return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v6h6" /></svg>;
    case 'services':
      return <svg {...common}><path d="M12 2 4 6.5v9L12 20l8-4.5v-9L12 2Z" /><path d="m4.5 7 7.5 4.2L19.5 7" /><path d="M12 20v-8.8" /></svg>;
    case 'trace':
      return <svg {...common}><path d="M4 7h5" /><path d="M15 7h5" /><circle cx="12" cy="7" r="3" /><path d="M12 10v4" /><path d="M7 17h10" /><circle cx="5" cy="17" r="2" /><circle cx="19" cy="17" r="2" /></svg>;
    default:
      return <svg {...common}><path d="M4 12h16" /></svg>;
  }
}

function getMapNodeHealth(node: ServiceStats): { tone: ServiceMapTone; score: number; label: string } {
  if (node.requestCount <= 0) {
    return { tone: 'neutral', score: 100, label: 'No traffic' };
  }

  const errorRate = Number.isFinite(node.errorRate) ? node.errorRate : (node.errorCount / Math.max(node.requestCount, 1)) * 100;
  const healthScore = clampMapValue(
    node.healthScore ?? inferMapHealthScore(errorRate, node.p95Ms, node.p99Ms),
    0,
    100
  );

  if (node.status === 'critical' || errorRate > 10 || healthScore < 65) {
    return { tone: 'critical', score: healthScore, label: 'Critical' };
  }
  if (node.status === 'degraded' || errorRate > 2 || node.p95Ms > 1000 || healthScore < 85) {
    return { tone: 'warning', score: healthScore, label: 'Watch' };
  }
  return { tone: 'healthy', score: healthScore, label: 'Healthy' };
}

function inferMapHealthScore(errorRate: number, p95Ms: number, p99Ms: number) {
  const errorPenalty = Math.min(70, errorRate * 5);
  const latencyPenalty = Math.min(25, Math.max(0, p95Ms - 300) / 35) + Math.min(15, Math.max(0, p99Ms - 1200) / 120);
  return 100 - errorPenalty - latencyPenalty;
}

function getMapNodeRisk(node: ServiceStats) {
  const health = getMapNodeHealth(node);
  const trafficWeight = Math.log10(Math.max(node.requestCount, 1));
  return (100 - health.score) * 2 + node.errorRate * 8 + Math.min(node.p99Ms / 30, 80) + trafficWeight;
}

function getMapEdgeWeight(edge: ServiceMapData['edges'][number]) {
  return edge.errorCount * 20 + edge.avgDurationMs + Math.log10(Math.max(edge.callCount, 1)) * 10;
}

function weightedMapValue(
  nodes: ServiceStats[],
  getValue: (node: ServiceStats) => number,
  getWeight: (node: ServiceStats) => number
) {
  const totals = nodes.reduce(
    (acc, node) => {
      const value = getValue(node);
      const weight = Math.max(getWeight(node), 0);
      if (Number.isFinite(value)) {
        acc.value += value * Math.max(weight, 1);
        acc.weight += Math.max(weight, 1);
      }
      return acc;
    },
    { value: 0, weight: 0 }
  );
  return totals.weight > 0 ? totals.value / totals.weight : 0;
}

function clampMapValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function formatMapNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function formatMapMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0ms';
  if (value < 1) return `${(value * 1000).toFixed(0)}us`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`;
  return `${value.toFixed(value >= 100 ? 0 : 1)}ms`;
}

function formatMapPercent(value: number) {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'No recent activity';
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}
