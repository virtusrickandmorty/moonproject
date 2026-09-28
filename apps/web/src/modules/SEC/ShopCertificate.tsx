import { useEffect, useState } from 'react';
import { api, type CertInfo } from '../../api.ts';
import { Notice, Panel } from '../../components/ui.tsx';
import { groupFingerprint256 } from './fingerprint.ts';

export function ShopCertificate() {
  const [ca, setCa] = useState<CertInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.shopCertificate().then(
      (data) => { if (active) { setCa(data.ca); setLoading(false); } },
      (e: Error) => { if (active) { setError(e.message); setLoading(false); } },
    );
    return () => { active = false; };
  }, []);

  return <div className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold">Shop certificate</h1>
    {loading && <p className="text-sm text-slate-500">Loading certificate…</p>}
    {error && <Notice>{error}</Notice>}
    {!loading && !error && (ca === null ?
      <Notice tone="info">This PC is not serving the shop network yet. The Windows installer turns it on.</Notice> :
      <Panel title="Check the shop's code">
        <p className="text-sm text-slate-600">SHA-256 code</p>
        <p className="break-words font-mono text-xl font-semibold leading-relaxed tracking-wide text-slate-900" aria-label="SHA-256 code">
          {groupFingerprint256(ca.fingerprint256)}
        </p>
        <div className="space-y-3 pt-2 text-sm">
          <p><span className="font-medium">Windows thumbprint</span><br /><span className="break-all font-mono">{ca.fingerprint1.replace(/:/g, '')}</span></p>
          <p><span className="font-medium">Certificate ends</span><br />
            <time dateTime={ca.notAfter}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ca.notAfter))}</time>
          </p>
        </div>
        <p className="border-t border-slate-200 pt-3 text-sm text-slate-700">
          Each phone or PC joins once: open http://&lt;address&gt;/ on it (the address of this PC, without https) and check that its page shows this same code.
        </p>
      </Panel>)}
  </div>;
}
