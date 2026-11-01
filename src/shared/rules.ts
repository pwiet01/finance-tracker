import type { MatchType, PayeeRule } from './types';

const norm = (s: string) => s.trim().toLowerCase();

export function ruleMatches(matchType: MatchType, pattern: string, raw: string): boolean {
  const p = norm(pattern), r = norm(raw);
  if (!p) return false;
  if (matchType === 'exact') return r === p;
  if (matchType === 'starts') return r.startsWith(p);
  return r.includes(p);
}

/** Whether a rule applies to a booking: the name must match, and the purpose must contain the rule's purpose text if it has one. */
export function ruleApplies(rule: Pick<PayeeRule, 'matchType' | 'pattern' | 'purpose'>, raw: string, purpose: string): boolean {
  return ruleMatches(rule.matchType, rule.pattern, raw) && (!norm(rule.purpose) || norm(purpose).includes(norm(rule.purpose)));
}

const rank: Record<MatchType, number> = { exact: 0, starts: 1, contains: 2 };

/**
 * Picks the rule for a booking. User rules beat automatic ones; rules that also check the
 * purpose beat those that don't; then exact beats "starts with" beats "contains"; then the
 * longer pattern wins.
 */
export function resolveRule(raw: string, purpose: string, rules: PayeeRule[]): PayeeRule | undefined {
  let best: PayeeRule | undefined;
  for (const rule of rules) {
    if (!ruleApplies(rule, raw, purpose)) continue;
    if (!best || compare(rule, best) < 0) best = rule;
  }
  return best;
}

function compare(a: PayeeRule, b: PayeeRule): number {
  if (a.auto !== b.auto) return a.auto ? 1 : -1;
  if (!a.purpose !== !b.purpose) return a.purpose ? -1 : 1;
  if (rank[a.matchType] !== rank[b.matchType]) return rank[a.matchType] - rank[b.matchType];
  return b.pattern.length - a.pattern.length || b.purpose.length - a.purpose.length;
}
