import React from 'react';
import { Translate } from '@phosphor-icons/react';
import HeaderDropdown from './HeaderDropdown';
import { LANGUAGES, useTranslation, type Language } from '../utils/i18n';

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, language, changeLanguage } = useTranslation();

  return (
    <HeaderDropdown
      label={t('Language')}
      value={language}
      className={compact ? 'header-dropdown-compact' : undefined}
      icon={<Translate size={16} weight="light" />}
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
