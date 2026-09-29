/** One dot on the owner's and accountant's Home for System Health (PLAN C8): the worst light, opening the page. */
import { useEffect, useState } from 'react';
import { api, type SystemHealth } from '../../api.ts';
import { Link } from '../../router.tsx';
import { DOT, HOME_DOT } from './health.ts';

export function HealthDot() {
  const [overall, setOverall] = useState<SystemHealth['overall'] | null>(null);
  useEffect(() => void api.systemHealth().then((h) => setOverall(h.overall), () => setOverall(null)), []);
  if (!overall) return null;
  return (
    <Link to="/admin/health" className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
      <span className={`inline-block h-3 w-3 rounded-full ${DOT[overall]}`} aria-hidden />
      {HOME_DOT[overall]}
    </Link>
  );
}
