import { useSettings } from '../settings';

export interface BarMonth {
  key: string;
  segments: { color: string; value: number; opacity?: number }[];
}

/** Stacked monthly bars; each column is a button that selects its month. */
export function StackedBars({ months, selected, onSelect, height = 200 }: {
  months: BarMonth[]; selected: string; onSelect: (key: string) => void; height?: number;
}) {
  const { money, monthLabel } = useSettings();
  const totals = months.map((m) => m.segments.reduce((s, x) => s + Math.max(0, x.value), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="bars" style={{ height: height + 70 }}>
      {months.map((m, i) => (
        <button key={m.key} type="button" className={`bar-col ${m.key === selected ? 'sel' : ''}`}
          onClick={() => onSelect(m.key)} aria-pressed={m.key === selected}
          aria-label={`${monthLabel(m.key, 'longYear')}: ${money(totals[i])}`}>
          <span className="bar-total num">{money(totals[i], { whole: true })}</span>
          <span className="bar-stack">
            {m.segments.filter((s) => s.value > 0).map((s, j) => (
              <span key={j} className="seg-part" style={{ height: (s.value / max) * height, background: s.color, opacity: s.opacity ?? 1 }} />
            ))}
          </span>
          <span className="bar-label">{monthLabel(m.key)}</span>
        </button>
      ))}
    </div>
  );
}

/** Balance line with labelled axes. `points[0]` is today. */
export function BalanceChart({ points, ariaLabel }: { points: { label: string; value: number }[]; ariaLabel: string }) {
  const { money } = useSettings();
  const n = Math.max(1, points.length - 1);
  const values = points.map((p) => p.value);
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const yMin = Math.min(0, vMin);
  const yMax = vMax + Math.max(1, vMax - yMin) * 0.08;
  const X = (i: number) => (i / n) * 1000;
  const Y = (v: number) => 240 - ((v - yMin) / (yMax - yMin)) * 240;
  const pts = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const step = Math.ceil(n / 12);
  return (
    <div className="fc-wrap">
      <div className="fc-y" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => (
          <span key={k} className="num" style={{ top: `${100 - (k / 3) * 100}%` }}>{money(yMin + ((yMax - yMin) * k) / 3, { whole: true })}</span>
        ))}
      </div>
      <div className="fc-plot">
        <svg viewBox="0 0 1000 240" preserveAspectRatio="none" className="fc-svg" role="img" aria-label={ariaLabel}>
          <path className="fc-grid" d={[0, 80, 160, 240].map((y) => `M0,${y} L1000,${y}`).join(' ')} />
          <path className="fc-area" d={`M0,240 L${pts.join(' L')} L1000,240 Z`} />
          {yMin < 0 && <path className="fc-zero" d={`M0,${Y(0)} L1000,${Y(0)}`} />}
          <polyline className="fc-line" points={pts.join(' ')} />
        </svg>
        <div className="fc-x" aria-hidden="true">
          {points.map((p, i) => (i % step === 0 ? <span key={i} style={{ left: `${(i / n) * 100}%` }}>{p.label}</span> : null))}
        </div>
      </div>
    </div>
  );
}
