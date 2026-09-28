import { useEffect, useState } from 'react';
import { api, type CashAccount, type Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { canShowBook } from './rules.ts';

const kinds: { value: CashAccount['kind']; label: string }[] = [
  { value: 'cash', label: 'Cash box' }, { value: 'checks', label: 'Checks on hand' }, { value: 'bank', label: 'Bank' }, { value: 'ewallet', label: 'E-wallet' },
];

export function CashAccounts({ me }: { me: Me }) {
  const manage = me.permissions.includes('cash.places.manage');
  const book = me.permissions.includes('cash.book.view');
  const [places, setPlaces] = useState<CashAccount[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<CashAccount | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CashAccount['kind']>('cash');
  const [accountNo, setAccountNo] = useState('');
  const [changeAccountNo, setChangeAccountNo] = useState(false);
  const [encoderSeesBalance, setEncoderSeesBalance] = useState(true);
  const action = useAction();
  const load = () => api.cashAccounts().then(setPlaces, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  const startEdit = (p: CashAccount) => {
    setEditing(p);
    setAdding(false);
    setAccountNo(''); // the server may send a masked number; never submit that mask as a new number
    setChangeAccountNo(false);
    setEncoderSeesBalance(p.encoderSeesBalance ?? false);
  };
  const save = async () => {
    if (editing) {
      await api.updateCashPlace(editing.id, editing.version!, {
        encoderSeesBalance,
        ...(changeAccountNo && (editing.kind === 'bank' || editing.kind === 'ewallet') ? { accountNo: accountNo.trim() || null } : {}),
      });
    } else {
      await api.addCashPlace({ name: name.trim(), kind, encoderSeesBalance, ...(kind === 'bank' || kind === 'ewallet' ? (accountNo.trim() ? { accountNo: accountNo.trim() } : {}) : {}) });
    }
    setEditing(null);
    setAdding(false);
    setName('');
    setAccountNo('');
    await load();
  };
  const formOpen = adding || !!editing;
  const numberKind = (editing?.kind ?? kind) === 'bank' || (editing?.kind ?? kind) === 'ewallet';

  return <div className="space-y-4">
    <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold">Cash Accounts</h1><span className="flex-1" />{manage && <Button tone="primary" onClick={() => { setAdding(true); setEditing(null); setName(''); setAccountNo(''); setKind('cash'); setEncoderSeesBalance(true); }}>Add place</Button>}</div>
    {error && <Notice>{error}</Notice>}
    <Panel title="Cash places">
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="py-2">Place</th><th>Kind</th><th>Account number</th><th className="text-right">Balance</th><th /></tr></thead><tbody>
        {places.map((p) => <tr key={p.id} className="border-t border-slate-100"><td className="py-3 font-medium">{p.name} <span className="text-slate-500">({p.code})</span></td><td>{kinds.find((k) => k.value === p.kind)?.label}</td><td>{p.accountNo ?? '—'}</td><td className="text-right tabular-nums">{p.balanceCents === null ? 'Hidden' : peso(p.balanceCents)}</td><td className="space-x-2 text-right">{book && canShowBook(p) && <Link to={`/cash/book?place=${p.id}`} className="underline">Cash book</Link>}{manage && <Button onClick={() => startEdit(p)}>Settings</Button>}</td></tr>)}
      </tbody></table></div>
      {places.length === 0 && <p className="text-sm text-slate-500">No cash places yet.</p>}
    </Panel>
    {formOpen && <Panel title={editing ? `Settings for ${editing.name}` : 'Add a cash place'}>
      <div className="max-w-lg space-y-3">
        {!editing && <><Field label="Name" required><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Kind" required><select className={inputClass} value={kind} onChange={(e) => { setKind(e.target.value as CashAccount['kind']); setAccountNo(''); }}><option value="cash">Cash box</option><option value="checks">Checks on hand</option><option value="bank">Bank</option><option value="ewallet">E-wallet</option></select></Field></>}
        {numberKind && <><p className="text-sm text-slate-600">{editing ? `Current account number: ${editing.accountNo ?? 'none'}` : 'Account number is optional.'}</p>{editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={changeAccountNo} onChange={(e) => { setChangeAccountNo(e.target.checked); setAccountNo(''); }} />Change account number</label>}{(!editing || changeAccountNo) && <Field label="Account number" hint="Leave blank to remove the number when changing it."><input className={inputClass} value={accountNo} onChange={(e) => setAccountNo(e.target.value)} /></Field>}</>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={encoderSeesBalance} onChange={(e) => setEncoderSeesBalance(e.target.checked)} />Encoders see the balance</label>
        {action.error && <Notice>{action.error}</Notice>}
        <div className="flex gap-2"><Button tone="primary" disabled={action.busy || (!editing && name.trim().length < 3)} onClick={() => action.run(save)}>Save</Button><Button onClick={() => { setEditing(null); setAdding(false); }}>Cancel</Button></div>
      </div>
    </Panel>}
  </div>;
}
