import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dictionaries, type Key, type Lang } from './i18n';

export type Theme = 'system' | 'light' | 'dark';

const LOCALES: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  // A URL parameter wins, e.g. ?theme=dark&lang=en (handy for screenshots).
  const fromUrl = new URLSearchParams(location.search).get(key);
  if (fromUrl && allowed.includes(fromUrl as T)) return fromUrl as T;
  try {
    const v = localStorage.getItem(`ft.${key}`);
    if (v && allowed.includes(v as T)) return v as T;
  } catch { /* storage unavailable */ }
  return fallback;
}

function persist(key: string, value: string) {
  try { localStorage.setItem(`ft.${key}`, value); } catch { /* storage unavailable */ }
}

export interface Settings {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  money: (cents: number, opts?: { signed?: boolean; whole?: boolean }) => string;
  date: (iso: string, style?: 'short' | 'medium') => string;
  monthLabel: (monthKey: string, style?: 'short' | 'long' | 'longYear' | 'shortYear') => string;
  pct: (ratio: number) => string;
}

const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const browserLang: Lang = navigator.language.startsWith('de') ? 'de' : 'en';
  const [lang, setLangState] = useState<Lang>(() => stored('lang', ['de', 'en'] as const, browserLang));
  const [theme, setThemeState] = useState<Theme>(() => stored('theme', ['system', 'light', 'dark'] as const, 'system'));
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.lang = lang;
  }, [dark, lang]);

  const value = useMemo<Settings>(() => {
    const locale = LOCALES[lang];
    const dict = dictionaries[lang];
    const cur = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' });
    const cur0 = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 });
    const toDate = (iso: string) => new Date(`${iso}T00:00:00`);
    return {
      lang, theme,
      setLang: (l) => { setLangState(l); persist('lang', l); },
      setTheme: (t) => { setThemeState(t); persist('theme', t); },
      t: (key, vars) => dict[key].replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? '')),
      money: (cents, opts) => {
        const s = (opts?.whole ? cur0 : cur).format(cents / 100);
        return opts?.signed && cents > 0 ? `+${s}` : s;
      },
      date: (iso, style = 'medium') => toDate(iso).toLocaleDateString(locale, style === 'short'
        ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' }),
      monthLabel: (key, style = 'short') => {
        const opts: Intl.DateTimeFormatOptions = {
          short: { month: 'short' }, long: { month: 'long' }, longYear: { month: 'long', year: 'numeric' }, shortYear: { month: 'short', year: '2-digit' }
        }[style] as Intl.DateTimeFormatOptions;
        return toDate(`${key}-01`).toLocaleDateString(locale, opts);
      },
      pct: (ratio) => `${Math.round(ratio * 100)}${lang === 'de' ? ' %' : '%'}`
    };
  }, [lang, theme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(Ctx);
  if (!s) throw new Error('SettingsProvider missing');
  return s;
}
