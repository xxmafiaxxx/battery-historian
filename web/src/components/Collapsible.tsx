import { useEffect, useState } from 'react';

export function useCollapsible(id: string, defaultOpen = true) {
  const key = `bh:collapse:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw) as boolean;
    } catch {}
    return defaultOpen;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(open)); } catch {}
  }, [key, open]);
  return [open, setOpen] as const;
}
