import React, { createContext, useContext } from 'react';

export type Language = 'en';

interface I18nContextType {
  t: (key: string) => string;
  language: Language;
  changeLanguage: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const t = (key: string): string => key;
  return (
    <I18nContext.Provider value={{ t, language: 'en', changeLanguage: () => {} }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return {
    t: (key: string): string => key,
    language: 'en' as const,
    changeLanguage: () => {},
  };
}
