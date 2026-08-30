import React from 'react';
import { IconLanguage } from '@tabler/icons-react';
import HeaderDropdown from './HeaderDropdown';
import { LANGUAGES, useTranslation, type Language } from '../utils/i18n';

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, language, changeLanguage } = useTranslation();

  return (
    <HeaderDropdown
      label={t('Language')}
      value={language}
      className={compact ? 'header-dropdown-compact' : undefined}
      icon={<IconLanguage size={16} stroke={1.7} />}
      options={LANGUAGES.map(item => ({
        value: item.code,
        label: item.nativeName,
        shortLabel: item.label,
      }))}
      align="end"
      onChange={value => changeLanguage(value as Language)}
    />
  );
}
