import { useEffect, useState } from 'react';
import { api, type CertInfo, type JoinAddress } from '../../api.ts';
import { Loading, Notice, Panel } from '../../components/ui.tsx';
import { addressKind, groupFingerprint256 } from './fingerprint.ts';

export function ShopCertificate() {
  const [ca, setCa] = useState<CertInfo | null>(null);
  const [join, setJoin] = useState<JoinAddress>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.shopCertificate().then(
      (data) => { if (active) { setCa(data.ca); setJoin(data.join); setLoading(false); } },
      (e: Error) => { if (active) { setError(e.message); setLoading(false); } },
    );
    return () => { active = false; };
  }, []);

  return <div className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold">Shop certificate</h1>
    {loading && <Loading label="Loading certificate…" />}
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
          Each phone or PC joins once: open the address below on it (http, not https) and check that its page shows this same code.
        </p>
      </Panel>)}
    {!loading && !error && ca && join && <Panel title="The address to join">
      <p className="text-sm text-slate-600">This PC is called <span className="font-medium text-slate-900">{join.pcName}</span>. On a phone or another PC, type:</p>
      {join.urls.length ? <ul className="space-y-1">
        {join.urls.map((url, i) => <li key={url} className="text-sm">
          <span className="break-all font-mono text-lg font-semibold text-slate-900">{url}</span>
          <span className="ml-2 text-slate-600">{addressKind(join.addresses[i]!.kind)}</span>
        </li>)}
      </ul> : <Notice tone="warning">{join.addresses.length ? 'The "Join this PC" page is not running. Restart Virtus, or see its log.' : 'This PC has no network address. Connect it to the shop network.'}</Notice>}
    </Panel>}
  </div>;
}
