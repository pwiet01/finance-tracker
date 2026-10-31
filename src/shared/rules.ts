import type { MatchType, PayeeRule } from './types';

const norm = (s: string) => s.trim().toLowerCase();

export function ruleMatches(matchType: MatchType, pattern: string, raw: string): boolean {
  const p = norm(pattern), r = norm(raw);
  if (!p) return false;
  if (matchType === 'exact') return r === p;
  if (matchType === 'starts') return r.startsWith(p);
  return r.includes(p);
}

const rank: Record<MatchType, number> = { exact: 0, starts: 1, contains: 2 };

/**
 * Picks the rule for a raw counterparty name. User rules beat automatic ones;
 * then exact beats "starts with" beats "contains"; then the longer pattern wins.
 */
export function resolveRule(raw: string, rules: PayeeRule[]): PayeeRule | undefined {
  let best: PayeeRule | undefined;
  for (const rule of rules) {
    if (!ruleMatches(rule.matchType, rule.pattern, raw)) continue;
    if (!best || compare(rule, best) < 0) best = rule;
  }
  return best;
}

function compare(a: PayeeRule, b: PayeeRule): number {
  if (a.auto !== b.auto) return a.auto ? 1 : -1;
  if (rank[a.matchType] !== rank[b.matchType]) return rank[a.matchType] - rank[b.matchType];
  return b.pattern.length - a.pattern.length;
}
