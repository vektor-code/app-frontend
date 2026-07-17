import React from 'react';

const LANG_ICONS: Record<string, string> = {
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
};

interface LanguageIconProps {
  language?: string;
  size?: number;
}

export default function LanguageIcon({ language, size = 20 }: LanguageIconProps) {
  if (!language) return null;
  const key = language.toLowerCase().trim();
  const src = LANG_ICONS[key];
  
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
