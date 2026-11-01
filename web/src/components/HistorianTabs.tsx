import type { HistorianTabId, TabConfig } from '../data/historianTabs';
import { TAB_CONFIGS } from '../data/historianTabs';

export function HistorianTabs({ active, onChange }: { active: HistorianTabId; onChange: (id: HistorianTabId) => void }) {
  return (
    <div role="tablist" aria-label="Historian views" className="historian-tabs">
      {TAB_CONFIGS.map((t: TabConfig) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            className={`htab ${isActive ? 'htab-active' : ''}`}
            onClick={() => onChange(t.id)}
            title={t.subtitle}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
