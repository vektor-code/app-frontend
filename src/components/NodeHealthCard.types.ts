/**
 * Shared status vocabulary for the card. Used both for the card's overall
 * status (badge + accent bar) and, independently, for each metric's own
 * threshold color (the radial gauges). A node can be "warning" purely
 * because of pod restarts while every resource gauge is still "ok" -
 * these are deliberately decoupled.
 */
export type HealthLevel = 'ok' | 'warning' | 'critical';

export interface NodeMetric {
  /** Stable identifier for React keys, e.g. 'cpu' | 'memory' | 'pods'. */
  key: string;
  /** Short display label, e.g. 'CPU', 'Memory', 'Pods'. */
  label: string;
  /** 0-100. Values outside this range are clamped when rendered. */
  percent: number;
  /** e.g. '2.48 cores', '3.59 Gi', '6' */
  usedLabel: string;
  /** e.g. '7.60 cores', '14.84 Gi', '110' */
  totalLabel: string;
}

export interface NodeHealthCardProps {
  /** Node name, e.g. 'worker-1'. */
  name: string;
  /** Node role/pool label, e.g. 'worker', 'control-plane'. */
  role?: string;
  namespaceCount: number;
  podCount: number;
  /** Overall node status. Drives the accent bar and badge. */
  status: HealthLevel;
  /**
   * Short, human-readable reason the node is not healthy, e.g.
   * '1 pod at risk · 5 restarts'. Only rendered when status !== 'ok'.
   */
  riskReason?: string;
  /** CPU / memory / pod (and optionally more) usage, rendered as gauges. */
  metrics: NodeMetric[];
  /** Pre-formatted relative time, e.g. '12s ago'. Caller owns the clock. */
  updatedAgoLabel: string;
  /** Percent at which a gauge turns to the 'warning' color. Default 70. */
  warnAt?: number;
  /** Percent at which a gauge turns to the 'critical' color. Default 90. */
  critAt?: number;
  /** Optional drill-down action, e.g. navigate to the pod-level view. */
  onViewDetails?: () => void;
}
