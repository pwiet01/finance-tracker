import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { todayIso } from '../shared/dates';
import { lookup, type Lookup } from '../shared/stats';
import type { AppState } from '../shared/types';

export class ApiError extends Error {}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? res.statusText);
  return data as T;
}

interface Data {
  state: AppState;
  lk: Lookup;
  today: string;
  reload: () => Promise<void>;
  /** Runs API calls, then reloads the state; errors are shown to the user. */
  mutate: (fn: () => Promise<unknown>) => Promise<boolean>;
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children, fallback }: { children: ReactNode; fallback: (error: string | null) => ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await api<AppState>('GET', '/state'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<Data | null>(() => state && {
    state,
    lk: lookup(state),
    today: todayIso(),
    reload,
    mutate: async (fn) => {
      try {
        await fn();
        return true;
      } catch (e) {
        alert((e as Error).message);
        return false;
      } finally {
        await reload();
      }
    }
  }, [state, reload]);

  if (!value) return <>{fallback(error)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const d = useContext(Ctx);
  if (!d) throw new Error('DataProvider missing');
  return d;
}
