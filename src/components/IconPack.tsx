import React from 'react';

interface IconPackProps {
  src: string;
  className?: string;
  size?: number;
}

export default function IconPack({ src, className = '', size }: IconPackProps) {
  const style = {
    '--icon-pack-url': `url("${src}")`,
    ...(size ? { width: size, height: size } : {})
  } as React.CSSProperties;

  return (
    <span
      className={`icon-pack ${className}`.trim()}
      aria-hidden="true"
      style={style}
    />
  );
}
