/**
 * Reads the dependency classification the backend recorded on a span.
 *
 * The UI used to re-derive this from raw attributes, with its own port table
 * and substring rules, in two components that did not agree with each other or
 * with the backend. Classification now happens once at ingest; this module just
 * reads the result.
 *
 * The legacy `db.system` / `messaging.system` fallbacks exist for spans stored
 * before the change — they keep older traces rendering correctly and can be
 * dropped once retention has rolled past the upgrade.
 */

export type DependencyKind =
  | 'database'
  | 'cache'
  | 'messaging'
  | 'storage'
  | 'gateway'
  | 'secrets'
  | 'discovery'
  | 'observability'
  | '';

export interface SpanDependency {
  /** Canonical system id, e.g. "postgresql". Empty when unclassified. */
  system: string;
  kind: DependencyKind;
  /** What the decision was based on: "db.system", "port", "host", … */
  evidence: string;
  /** 0–1. Below ~0.5 the classification came from a name guess. */
  confidence: number;
}

type Attrs = Record<string, string> | undefined;

const EMPTY: SpanDependency = { system: '', kind: '', evidence: '', confidence: 0 };

export function getSpanDependency(attributes: Attrs): SpanDependency {
  if (!attributes) return EMPTY;

  const system = attributes['crnet.apm.dependency.system'];
  if (system) {
    return {
      system,
      kind: (attributes['crnet.apm.dependency.kind'] || '') as DependencyKind,
      evidence: attributes['crnet.apm.dependency.evidence'] || '',
      confidence: Number(attributes['crnet.apm.dependency.confidence']) || 0,
    };
  }

  // Spans ingested before the shared classifier landed.
  const legacyDb = attributes['db.system'] || attributes['db.system.name'];
  if (legacyDb) {
    return { system: legacyDb, kind: 'database', evidence: 'db.system', confidence: 1 };
  }
  const legacyMsg = attributes['messaging.system'];
  if (legacyMsg) {
    return { system: legacyMsg, kind: 'messaging', evidence: 'messaging.system', confidence: 1 };
  }
  return EMPTY;
}

/** True when the span is a call to a stateful data store. Gateways and secret
 *  stores are dependencies too, but they are not database calls. */
export function isDatabaseSpan(attributes: Attrs): boolean {
  const kind = getSpanDependency(attributes).kind;
  return kind === 'database' || kind === 'cache';
}

/** The query text to display, already sanitized at ingest. */
export function getQueryText(attributes: Attrs): string {
  if (!attributes) return '';
  return attributes['db.statement'] || attributes['db.query.text'] || '';
}

/** Low-cardinality label for a database span, e.g. "SELECT orders". */
export function getQuerySummary(attributes: Attrs): string {
  if (!attributes) return '';
  if (attributes['db.query.summary']) return attributes['db.query.summary'];

  const operation = attributes['db.operation'] || attributes['db.operation.name'] || '';
  const collection = attributes['db.collection.name'] || '';
  return [operation, collection].filter(Boolean).join(' ');
}

/**
 * How many spans a stored span stands for. Under load the collector samples,
 * and a span kept at 1% represents 100 — counts that ignore this under-report
 * silently.
 */
export function getAdjustedCount(attributes: Attrs): number {
  if (!attributes) return 1;
  const raw = Number(attributes['crnet.apm.sampling.adjusted_count']);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** True when the span survived sampling probabilistically, so any count
 *  derived from it is an estimate rather than an exact figure. */
export function isSampled(attributes: Attrs): boolean {
  return getAdjustedCount(attributes) > 1;
}
