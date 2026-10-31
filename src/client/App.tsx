import { useMemo } from 'react';
import { suggestMatches } from '../shared/matching';
import { Icon, Logo } from './components/ui';
import { DataProvider, useData } from './data';
import type { Key } from './i18n';
import { CategoriesPage } from './pages/Categories';
import { CategoryDetailPage } from './pages/CategoryDetail';
import { ForecastPage } from './pages/Forecast';
import { ImportPage } from './pages/Import';
import { OverviewPage } from './pages/Overview';
import { PlanningPage } from './pages/Planning';
import { TransactionsPage } from './pages/Transactions';
import { useRoute } from './router';
import { SettingsProvider, useSettings, type Theme } from './settings';

export function App() {
  return (
    <SettingsProvider>
      <DataProvider fallback={(error) => <Loading error={error} />}>
        <Shell />
      </DataProvider>
    </SettingsProvider>
  );
}

function Loading({ error }: { error: string | null }) {
  const { t } = useSettings();
  return <div className="empty">{error ? t('error', { msg: error }) : t('loading')}</div>;
}

const NAV: { id: string; icon: Parameters<typeof Icon>[0]['name']; label: Key }[] = [
  { id: '', icon: 'overview', label: 'overview' },
  { id: 'transactions', icon: 'transactions', label: 'transactions' },
  { id: 'planning', icon: 'planning', label: 'planning' },
  { id: 'forecast', icon: 'forecast', label: 'forecast' },
  { id: 'categories', icon: 'categories', label: 'categories' },
  { id: 'import', icon: 'import', label: 'import' }
];

function Shell() {
  const route = useRoute();
  const { t, money, date, theme, setTheme, lang, setLang } = useSettings();
  const { state } = useData();
  const page = route.path[0] ?? '';
  const section = page === 'category' ? '' : page;
  const suggestions = useMemo(() => suggestMatches(state).length, [state]);
  const badges: Record<string, number> = { planning: suggestions };

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><Logo />finance-tracker</div>
        <nav className="nav" aria-label={t('navLabel')}>
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={section === n.id ? 'active' : ''} aria-current={section === n.id ? 'page' : undefined}>
              <Icon name={n.icon} />{t(n.label)}
              {badges[n.id] ? <span className="badge">{badges[n.id]}</span> : null}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="balance-mini">
            <div className="small muted">{t('balance')}</div>
            {state.balance ? (
              <>
                <div className="num" style={{ fontWeight: 600, fontSize: 16 }}>{money(state.balance.amount)}</div>
                <div className="small muted">{t('asOf', { date: date(state.balance.date) })}</div>
              </>
            ) : <div className="small muted">{t('noBalance')}</div>}
          </div>
          <div className="segctl" role="group" aria-label={t('theme')}>
            {(['system', 'light', 'dark'] as Theme[]).map((th) => (
              <button key={th} type="button" className={theme === th ? 'on' : ''} aria-pressed={theme === th} onClick={() => setTheme(th)}>
                {t(th === 'system' ? 'themeSystem' : th)}
              </button>
            ))}
          </div>
          <div className="segctl" role="group" aria-label={t('language')}>
            <button type="button" className={lang === 'de' ? 'on' : ''} aria-pressed={lang === 'de'} onClick={() => setLang('de')}>Deutsch</button>
            <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          </div>
          <a className="link small row" href="/api/export" download><Icon name="download" size={14} />{t('exportBackup')}</a>
        </div>
      </aside>
      <main className="main">
        {page === '' && <OverviewPage />}
        {page === 'category' && <CategoryDetailPage id={Number(route.path[1])} />}
        {page === 'transactions' && <TransactionsPage query={route.query} />}
        {page === 'planning' && <PlanningPage tab={route.path[1]} />}
        {page === 'forecast' && <ForecastPage />}
        {page === 'categories' && <CategoriesPage />}
        {page === 'import' && <ImportPage />}
      </main>
    </div>
  );
}
