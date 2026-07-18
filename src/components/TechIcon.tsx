import React from 'react';

// Brand / technology logos available under public/logos.
// Keyed by a substring that may appear in a system or backend name.
export const TECH_LOGOS: Record<string, string> = {
  postgres: '/logos/postgres.svg',
  postgresql: '/logos/postgres.svg',
  mysql: '/logos/mysql.svg',
  mariadb: '/logos/mysql.svg',
  redis: '/logos/redis.svg',
  kafka: '/logos/kafka.svg',
  rabbitmq: '/logos/rabbitmq.svg',
  mongo: '/logos/mongodb.svg',
  mongodb: '/logos/mongodb.svg',
  clickhouse: '/logos/clickhouse.svg',
  elastic: '/logos/elasticsearch.svg',
  elasticsearch: '/logos/elasticsearch.svg',
  minio: '/logos/minio.svg',
  vault: '/logos/vault.svg',
  liquibase: '/logos/liquibase.svg',
  nginx: '/logos/nginx.svg',
  kong: '/logos/kong.svg',
  apm: '/logos/apm.svg',
  dns: '/logos/dns.svg',
  ldap: '/logos/active-directory.svg',
  activedirectory: '/logos/active-directory.svg',
  'active-directory': '/logos/active-directory.svg',
  'active directory': '/logos/active-directory.svg',
  prometheus: '/logos/prometheus.svg',
  grafana: '/logos/grafana.svg',
  pagerduty: '/logos/pagerduty.svg',
  slack: '/logos/slack.svg',
  telegram: '/logos/telegram.svg',
  mygov: '/mygov-id.svg',
  vm: '/logos/kubernetes.svg',
  bridge: '/logos/dns.svg',
  database: '/logos/database.svg',
  sql: '/logos/database.svg',
};

// Ordered lookup so more specific keys win over generic ones (e.g. clickhouse
// before the generic "sql"/"database" fallbacks).
export const TECH_LOOKUP_ORDER = [
  'postgresql', 'postgres', 'clickhouse', 'mariadb', 'mysql', 'redis', 'kafka',
  'rabbitmq', 'mongodb', 'mongo', 'elasticsearch', 'elastic', 'minio', 'vault',
  'liquibase', 'nginx', 'kong', 'apm', 'prometheus', 'grafana', 'pagerduty', 'telegram',
  'slack', 'active-directory', 'active directory', 'activedirectory', 'ldap', 'mygov', 'bridge',
  'dns', 'vm', 'database', 'sql',
];

export function techLogoFor(name: string): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('mygov')) return TECH_LOGOS.mygov;
  for (const key of TECH_LOOKUP_ORDER) {
    if (n.includes(key)) return TECH_LOGOS[key];
  }
  if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(n)) return TECH_LOGOS.vm;
  if (n.includes('.gov.az') || n.includes('.az')) return TECH_LOGOS.bridge;
  return null;
}

interface TechIconProps {
  name: string;
  size?: number;
  /** Show the system name next to the icon. */
  showLabel?: boolean;
  label?: string;
}

/**
 * Renders a technology/system logo (postgres, redis, vault, apm, …). Falls back
 * to a compact monospace chip with the first letters when no logo is known, so
 * the column never shows a bare uppercase string.
 */
export default function TechIcon({ name, size = 20, showLabel = false, label }: TechIconProps) {
  const src = techLogoFor(name);
  const display = label ?? name;

  const icon = src ? (
    <img
      src={src}
      alt={display}
      title={display}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, verticalAlign: 'middle' }}
    />
  ) : (
    <span
      title={display}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: size + 4,
        height: size + 4,
        padding: '0 5px',
        borderRadius: 5,
        fontSize: 9,
        fontWeight: 700,
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono, monospace)',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {display.slice(0, 3).toUpperCase()}
    </span>
  );

  if (!showLabel) return icon;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {icon}
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {display}
      </span>
    </span>
  );
}
