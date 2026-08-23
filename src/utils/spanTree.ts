import type { Span } from '../entities';

const CONTAIN_SKEW_MS = 50;

export function normalizeSpanId(id?: string): string {
  if (!id) return '';
  let s = id.trim().toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  if (!s || /^0+$/.test(s)) return '';
  if (s.length < 16 && /^[0-9a-f]+$/.test(s)) {
    s = s.padStart(16, '0');
  }
  return s;
}

export function isRootParentId(id?: string): boolean {
  return normalizeSpanId(id) === '';
}

export interface SpanForest {
  roots: Span[];
  displayRoot: Span | null;
  partialRoot: boolean;
  midTreeMissing: Span[];
  childrenOf: (spanId: string) => Span[];
  getById: (spanId: string) => Span | undefined;
}

export function buildSpanForest(spans: Span[]): SpanForest {
  const byId = new Map<string, Span>();
  const ordered: Span[] = [];
  for (const sp of spans || []) {
    if (!sp?.spanId) continue;
    ordered.push(sp);
    byId.set(normalizeSpanId(sp.spanId), sp);
  }

  const children = new Map<string, Span[]>();
  const parentOf = new Map<string, string>();
  const addChild = (parentId: string, child: Span) => {
    const key = normalizeSpanId(parentId);
    const list = children.get(key) || [];
    list.push(child);
    children.set(key, list);
    parentOf.set(normalizeSpanId(child.spanId), key);
  };

  const trueRoots: Span[] = [];
  const orphans: Span[] = [];
  for (const sp of ordered) {
    if (isRootParentId(sp.parentSpanId)) {
      const linked = linkedParentInTrace(sp, byId);
      if (linked && linked.spanId !== sp.spanId) {
        addChild(linked.spanId, sp);
        continue;
      }
      trueRoots.push(sp);
      continue;
    }
    const parent = byId.get(normalizeSpanId(sp.parentSpanId));
    if (parent && parent.spanId !== sp.spanId) {
      addChild(parent.spanId, sp);
      continue;
    }
    orphans.push(sp);
  }

  let displayRoot: Span | null = null;
  let partialRoot = false;
  let roots: Span[] = [];
  if (trueRoots.length > 0) {
    displayRoot = earliest(trueRoots);
    roots = trueRoots;
  } else {
    displayRoot = entrySpan(orphans);
    partialRoot = !!displayRoot;
    roots = displayRoot ? [displayRoot] : [];
  }
  if (!displayRoot && ordered.length > 0) {
    displayRoot = earliest(ordered);
    roots = displayRoot ? [displayRoot] : [];
  }

  const midTreeMissing: Span[] = [];
  for (const sp of orphans) {
    if (displayRoot && sp.spanId === displayRoot.spanId) continue;
    let host = linkedParentInTrace(sp, byId) || tightestContainer(ordered, sp);
    if (!host || createsCycle(parentOf, normalizeSpanId(sp.spanId), normalizeSpanId(host.spanId))) {
      host = displayRoot;
    }
    if (!host || host.spanId === sp.spanId || createsCycle(parentOf, normalizeSpanId(sp.spanId), normalizeSpanId(host.spanId))) {
      midTreeMissing.push(sp);
      continue;
    }
    addChild(host.spanId, sp);
    midTreeMissing.push(sp);
  }

  const filteredMissing = partialRoot
    ? midTreeMissing.filter(sp => !displayRoot || sp.spanId !== displayRoot.spanId)
    : midTreeMissing;

  return {
    roots,
    displayRoot,
    partialRoot,
    midTreeMissing: filteredMissing,
    childrenOf: (spanId: string) => children.get(normalizeSpanId(spanId)) || [],
    getById: (spanId: string) => byId.get(normalizeSpanId(spanId)),
  };
}

function createsCycle(parentOf: Map<string, string>, child: string, host: string): boolean {
  let key = host;
  const seen = new Set<string>();
  while (key) {
    if (key === child) return true;
    if (seen.has(key)) return true;
    seen.add(key);
    key = parentOf.get(key) || '';
  }
  return false;
}

function earliest(spans: Span[]): Span | null {
  let best: Span | null = null;
  for (const sp of spans) {
    if (!best || new Date(sp.startTime).getTime() < new Date(best.startTime).getTime()) best = sp;
  }
  return best;
}

function entrySpan(orphans: Span[]): Span | null {
  let bestServer: Span | null = null;
  let bestAny: Span | null = null;
  for (const sp of orphans) {
    if (!bestAny || new Date(sp.startTime).getTime() < new Date(bestAny.startTime).getTime()) bestAny = sp;
    if (sp.kind === 'SERVER') {
      if (!bestServer || new Date(sp.startTime).getTime() < new Date(bestServer.startTime).getTime()) bestServer = sp;
    }
  }
  return bestServer || bestAny;
}

function tightestContainer(all: Span[], child: Span): Span | null {
  const childStart = new Date(child.startTime).getTime();
  const childEnd = new Date(child.endTime).getTime();
  let best: Span | null = null;
  for (const cand of all) {
    if (!cand || cand.spanId === child.spanId) continue;
    const start = new Date(cand.startTime).getTime();
    const end = new Date(cand.endTime).getTime();
    if (start > childStart + CONTAIN_SKEW_MS) continue;
    if (end + CONTAIN_SKEW_MS < childEnd) continue;
    if (
      !best ||
      cand.durationMs < best.durationMs ||
      (cand.durationMs === best.durationMs && start < new Date(best.startTime).getTime())
    ) {
      best = cand;
    }
  }
  return best;
}

function linkedParentInTrace(sp: Span, byId: Map<string, Span>): Span | undefined {
  const links = sp.links && sp.links.length > 0
    ? sp.links
    : parseStoredLinks(sp.attributes?.['otel.span.links']);
  for (const link of links) {
    if (!link.spanId) continue;
    if (link.traceId && normalizeSpanId(link.traceId) !== normalizeSpanId(sp.traceId)) continue;
    const parent = byId.get(normalizeSpanId(link.spanId));
    if (parent && parent.spanId !== sp.spanId) return parent;
  }
  return undefined;
}

function parseStoredLinks(raw?: string): { traceId?: string; spanId?: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
