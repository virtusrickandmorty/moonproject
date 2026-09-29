/** After a restore, the owner's first sign-in says which backup the books came from and when (PLAN C8 "Restore"). */
import { useEffect, useState } from 'react';
import { api, type Me } from '../../api.ts';
import { Notice } from '../../components/ui.tsx';
import { restoredWords } from './backups.ts';

export function RestoredNotice({ me }: { me: Me }) {
  const [restored, setRestored] = useState<{ file: string; at: string } | null>(null);
  const may = me.permissions.includes('bak.restore');
  useEffect(() => {
    if (may) void api.bakRestored().then(setRestored, () => undefined);
  }, [may]);
  if (!restored) return null;
  return (
    <div className="mb-4">
      <Notice tone="info">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>{restoredWords(restored)} Anything recorded after that backup was made needs to be entered again.</span>
          <button type="button" className="text-xs underline" onClick={() => setRestored(null)}>Close</button>
        </span>
      </Notice>
    </div>
  );
}
