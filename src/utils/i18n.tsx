import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { catalogs, LANGUAGE_STORAGE_KEY, LANGUAGES, type Language } from './locales';

export type { Language } from './locales';
export { LANGUAGES };

interface I18nContextType {
  t: (key: string) => string;
  language: Language;
  changeLanguage: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

function isLanguage(value: string | null | undefined): value is Language {
  return value === 'en' || value === 'az' || value === 'ru';
}

function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'tr') return 'en';
    if (isLanguage(stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  if (typeof navigator !== 'undefined') {
    const nav = navigator.language.slice(0, 2).toLowerCase();
    if (isLanguage(nav)) return nav;
  }
  return 'en';
}

function applyDocumentLanguage(language: Language) {
  document.documentElement.lang = language;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(detectLanguage);

  useEffect(() => {
    applyDocumentLanguage(language);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // localStorage may be unavailable
    }
  }, [language]);

  const t = useCallback((key: string) => {
    return catalogs[language][key] || catalogs.en[key] || key;
  }, [language]);

  const changeLanguage = useCallback((lang: Language) => {
    if (!isLanguage(lang)) return;
    setLanguage(lang);
  }, []);

  const value = useMemo(
    () => ({ t, language, changeLanguage }),
    [t, language, changeLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    return {
      t: (key: string) => key,
      language: 'en' as const,
      changeLanguage: (_lang: Language) => {},
    };
  }
  return context;
}
