/** A band across every screen of the practice shop, the sign-in page and printouts included (PLAN C8, H2). */
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';

export function PracticeBanner() {
  const [practice, setPractice] = useState(false);
  useEffect(() => {
    api.health().then((h) => {
      setPractice(Boolean(h.practice));
      if (h.practice) document.title = `PRACTICE · ${document.title}`;
    }, () => undefined);
  }, []);
  if (!practice) return null;
  return (
    <div role="status" className="bg-amber-400 px-4 py-1.5 text-center text-sm font-semibold text-amber-950">
      PRACTICE SHOP: made-up data for training. Nothing you do here reaches the real shop or its books.
    </div>
  );
}
