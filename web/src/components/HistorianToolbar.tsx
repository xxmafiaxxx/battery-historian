import { useMemo } from 'react';
import { isValidRegExp } from '../data/levelUtils';
import type { ParsedLog } from './Timeline';

type DomainOption = 'Default' | 'Shown metrics' | string;

export function HistorianToolbar({
  logs,
  domain,
  onDomainChange,
  regexp,
  onRegexpChange,
  showRateOfChange,
  onRateChange,
  showBars,
  onShowBars,
}: {
  logs: ParsedLog[];
  domain: DomainOption;
  onDomainChange: (v: DomainOption) => void;
  regexp: string;
  onRegexpChange: (v: string) => void;
  showRateOfChange: boolean;
  onRateChange: (v: boolean) => void;
  showBars: boolean;
  onShowBars: (v: boolean) => void;
}) {
  const sources = useMemo(() => [...new Set(logs.map(l => l.source))].sort(), [logs]);
  const badRegexp = regexp !== '' && !isValidRegExp(regexp);
  return (
    <div className="historian-toolbar">
      <label className="htb-field">
        Restrict domain
        <select className="set-domain" value={domain} onChange={e => onDomainChange(e.target.value as DomainOption)}>
          <option value="Default">Default</option>
          <option value="Shown metrics">Shown metrics</option>
          {sources.map(s => <option key={s} value={s}>{s} Log</option>)}
        </select>
      </label>
      <label className="htb-field">
        Regexp search
        <input
          name="regexp-search"
          type="text"
          placeholder="filter bar values"
          value={regexp}
          onChange={e => onRegexpChange(e.target.value)}
          className={badRegexp ? 'error' : undefined}
          title={badRegexp ? 'Invalid regexp' : 'Case-insensitive — filters bars by formatted value'}
        />
      </label>
      <label className="htb-check">
        <input type="checkbox" className="show-rate-of-change" checked={showRateOfChange} onChange={e => onRateChange(e.target.checked)} />
        Show rate of change
      </label>
      <label className="htb-check">
        <input type="checkbox" className="show-bars" checked={showBars} onChange={e => onShowBars(e.target.checked)} />
        Show bars
      </label>
    </div>
  );
}
