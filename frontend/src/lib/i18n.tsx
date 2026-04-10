import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import ptBR from '../locales/pt-BR.json';
import enUS from '../locales/en-US.json';

export type Locale = 'pt-BR' | 'en-US';

type Translations = Record<string, string | string[]>;

const locales: Record<Locale, Translations> = {
  'pt-BR': ptBR as unknown as Translations,
  'en-US': enUS as unknown as Translations,
};

const STORAGE_KEY = 'locale';

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved in locales) return saved as Locale;
  const nav = navigator.language;
  if (nav.startsWith('pt')) return 'pt-BR';
  return 'en-US';
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? '');
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  tList: (key: string) => string[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  // Sync html lang attribute
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string>): string => {
      const value = locales[locale]?.[key] ?? locales['pt-BR']?.[key] ?? key;
      const str = typeof value === 'string' ? value : key;
      return params ? interpolate(str, params) : str;
    },
    [locale],
  );

  const tList = useCallback(
    (key: string): string[] => {
      const value = locales[locale]?.[key] ?? locales['pt-BR']?.[key];
      return Array.isArray(value) ? value : [];
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, tList }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
