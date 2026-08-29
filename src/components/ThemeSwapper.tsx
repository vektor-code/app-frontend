import { IconMoon, IconSun } from '@tabler/icons-react';
import './ThemeSwapper.css';

export function ThemeSwapper({
  dark,
  onChange,
  className,
  variant = 'segmented',
}: {
  dark: boolean;
  onChange: (dark: boolean) => void;
  className?: string;
  variant?: 'segmented' | 'icon';
}) {
  if (variant === 'icon') {
    return (
      <button
        type="button"
        className={['apm-theme-icon', className].filter(Boolean).join(' ')}
        data-mode={dark ? 'dark' : 'light'}
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={dark ? 'Light' : 'Dark'}
        onClick={() => onChange(!dark)}
      >
        <IconSun className="apm-theme-glyph sun" size={16} stroke={1.8} aria-hidden />
        <IconMoon className="apm-theme-glyph moon" size={16} stroke={1.8} aria-hidden />
      </button>
    );
  }

  return (
    <div
      aria-label="Theme"
      className={['apm-theme-swap', className].filter(Boolean).join(' ')}
      data-mode={dark ? 'dark' : 'light'}
      role="group"
    >
      <span aria-hidden="true" className="apm-theme-swap-thumb" />
      <button
        aria-label="Light"
        aria-pressed={!dark}
        data-theme="light"
        onClick={() => onChange(false)}
        title="Light"
        type="button"
      >
        <IconSun size={15} stroke={1.8} />
      </button>
      <button
        aria-label="Dark"
        aria-pressed={dark}
        data-theme="dark"
        onClick={() => onChange(true)}
        title="Dark"
        type="button"
      >
        <IconMoon size={15} stroke={1.8} />
      </button>
    </div>
  );
}
