/** "+ New" › Depreciation Run: the month is picked from the months still to run (no month to type), then recorded as on the asset register. */
import { useEffect, useState } from 'react';
import { api, type DepreciationGaps, type DocTypeInfo } from '../../api.ts';
import { Notice } from '../../components/ui.tsx';
import { navigate } from '../../router.tsx';
import { DepreciationRun } from './Actions.tsx';

export function DepreciationForm({ type }: { type: DocTypeInfo }) {
  const [gaps, setGaps] = useState<DepreciationGaps | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.depreciationGaps().then(setGaps, (e: Error) => setError(e.message)), []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New {type.title}</h1>
      {error && <Notice>{error}</Notice>}
      {!gaps && !error && <p className="text-slate-500">Loading…</p>}
      {gaps && <DepreciationRun gaps={gaps} onDone={() => navigate('/fa/assets')} onClose={() => history.back()} />}
    </div>
  );
}
