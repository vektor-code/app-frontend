import { IconMoon, IconSun } from '@tabler/icons-react';
import { useTranslation } from '../utils/i18n';
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
  const { t } = useTranslation();
  const lightLabel = t('Light');
  const darkLabel = t('Dark');
  const switchLabel = dark ? t('Switch to light mode') : t('Switch to dark mode');

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className={['apm-theme-icon', className].filter(Boolean).join(' ')}
        data-mode={dark ? 'dark' : 'light'}
        aria-label={switchLabel}
        title={dark ? lightLabel : darkLabel}
        onClick={() => onChange(!dark)}
      >
        <IconSun className="apm-theme-glyph sun" size={16} stroke={1.8} aria-hidden />
        <IconMoon className="apm-theme-glyph moon" size={16} stroke={1.8} aria-hidden />
      </button>
    );
  }

  return (
    <div
      aria-label={t('Theme')}
      className={['apm-theme-swap', className].filter(Boolean).join(' ')}
      data-mode={dark ? 'dark' : 'light'}
      role="group"
    >
      <span aria-hidden="true" className="apm-theme-swap-thumb" />
      <button
        aria-label={lightLabel}
        aria-pressed={!dark}
        data-theme="light"
        onClick={() => onChange(false)}
        title={lightLabel}
        type="button"
      >
        <IconSun size={15} stroke={1.8} />
      </button>
      <button
        aria-label={darkLabel}
        aria-pressed={dark}
        data-theme="dark"
        onClick={() => onChange(true)}
        title={darkLabel}
        type="button"
      >
        <IconMoon size={15} stroke={1.8} />
      </button>
    </div>
  );
}

