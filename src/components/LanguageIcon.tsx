import React from 'react';

export const LANG_ICONS: Record<string, string> = {
  go: '/logos/go.svg',
  golang: '/logos/go.svg',
  php: '/logos/php.svg',
  java: '/logos/java.svg',
  python: '/logos/python.svg',
  dotnet: '/logos/dotnet.svg',
  csharp: '/logos/dotnet.svg',
  nodejs: '/logos/node.svg',
  node: '/logos/node.svg',
  javascript: '/logos/javascript.svg',
  typescript: '/logos/typescript.svg',
  ruby: '/logos/ruby.svg',
  rust: '/logos/rust.svg',
  kotlin: '/logos/kotlin.svg',
  swift: '/logos/swift.svg',
  elixir: '/logos/elixir.svg',
  scala: '/logos/scala.svg',
  nginx: '/logos/nginx.svg',
  'apache-httpd': '/logos/nginx.svg',
  apache: '/logos/nginx.svg',
  httpd: '/logos/nginx.svg',
};

export function languageLogoFor(language?: string): string | null {
  if (!language) return null;
  const key = stackIconKey(language);
  if (!key) return null;
  return LANG_ICONS[key] ?? LANG_ICONS[language.toLowerCase().trim()] ?? null;
}

/** Map an assigned tech stack to an icon key. Names of workloads are not used. */
export function stackIconKey(language?: string): string | undefined {
  if (!language) return undefined;
  const l = language.toLowerCase().trim();
  if (!l || l === 'unknown' || l === 'auto' || l === 'unk') return undefined;
  if (l === 'nginx' || l === 'openresty' || l === 'caddy' || l === 'apache' || l === 'httpd' || l === 'apache-httpd') {
    return 'nginx';
  }
  if (l === 'nodejs' || l === 'node' || l === 'javascript' || l === 'typescript' || l === 'js') return 'nodejs';
  if (l === 'go' || l === 'golang') return 'go';
  if (l === 'dotnet' || l === 'csharp' || l === 'c#' || l === '.net') return 'dotnet';
  if (LANG_ICONS[l]) return l;
  return undefined;
}

interface LanguageIconProps {
  language?: string;
  size?: number;
}

export default function LanguageIcon({ language, size = 20 }: LanguageIconProps) {
  const key = (language || '').toLowerCase().trim();
  if (!key || key === 'unknown' || key === 'auto' || key === 'unk') {
    return null;
  }
  const src = languageLogoFor(language);
  
  if (!src) {
    // Premium generic fallback text representation
    return (
      <span
        title={language}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: `${size + 4}px`,
          height: `${size + 4}px`,
          padding: '0 4px',
          borderRadius: '4px',
          fontSize: '9px',
          fontWeight: 700,
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-primary)',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono, monospace)',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {language.slice(0, 3).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={language}
      title={language}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: 'contain',
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    />
  );
}
