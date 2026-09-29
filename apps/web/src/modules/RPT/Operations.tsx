import { useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, useReport, useToday } from './Books.tsx';

type Row = Record<string, string | number | null> & { id?: string; docType?: string };
type Spec = { path:string; title:string; mode:'asOf'|'range'|'none'; columns:[string,string,'money'?][] };
function Report({me,spec}:{me:Me;spec:Spec}) {
  const today=useToday(); const [from,setFrom]=useState(''); const [to,setTo]=useState(''); const [applied,setApplied]=useState('');
  useEffect(()=>{if(today&&!to){setTo(today);setFrom(today.slice(0,7)+'-01')}},[today,to]);
  const params=()=>spec.mode==='asOf'?new URLSearchParams({asOf:to}):spec.mode==='range'?new URLSearchParams({from,to}):new URLSearchParams();
  useEffect(()=>{if(to&&!applied)setApplied(params().toString()||'ready')},[to,from,applied,spec.mode]);
  const path=applied?`${spec.path}${applied?'?'+applied:''}`:null; const {data,error}=useReport<{rows:Row[]}>(path);
  if(!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const show=()=>setApplied(params().toString()||'ready');
  return <article className="rpt-page space-y-4"><BookTitle title={spec.title} dates=""/><div className="flex flex-wrap items-end gap-3 print:hidden">
    {spec.mode==='range'&&<Field label="From"><input type="date" className={inputClass} value={from} onChange={e=>setFrom(e.target.value)}/></Field>}
    {spec.mode!=='none'&&<Field label={spec.mode==='asOf'?'As of':'To'}><input type="date" className={inputClass} value={to} onChange={e=>setTo(e.target.value)}/></Field>}
    <Button tone="primary" disabled={spec.mode!=='none'&&(!to||(spec.mode==='range'&&(!from||from>to)))} onClick={show}>Show</Button>{path&&<Tools path={path}/>}</div>
    {error&&<Notice>{error}</Notice>}{!data&&!error&&<p>Loading…</p>}{data&&<Panel title={`${data.rows.length} rows`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{spec.columns.map(c=><th className={th} key={c[1]}>{c[0]}</th>)}</tr></thead><tbody>{data.rows.map((r,i)=><tr key={String(r.id??i)}>{spec.columns.map(c=><td className={c[2]==='money'?money:td} key={c[1]}>{c[1]==='number'&&r.id?<Link className="text-indigo-700 underline" to={`/docs/${encodeURIComponent(String(r.docType??guessType(spec.path)))}/${encodeURIComponent(r.id)}`}>{r[c[1]]}</Link>:c[2]==='money'?peso(Number(r[c[1]]??0)):String(r[c[1]]??'')}</td>)}</tr>)}</tbody></table></div></Panel>}
  </article>;
}
const guessType=(p:string)=>p==='transfers'?'cash.transfer':p==='cash-counts'?'cash.count':p==='purchase-orders'?'pur.po':p==='received-not-billed'?'pur.rr':p==='ap-aging'||p==='purchases'?'ap.bill':p==='asset-schedule'?'fa.buy':'';
const make=(spec:Spec)=>(p:{me:Me})=><Report {...p} spec={spec}/>;
export const ApAging=make({path:'ap-aging',title:'AP aging',mode:'asOf',columns:[['Supplier','supplierName'],['Document','number'],['Due date','dueDate'],['Balance','balanceCents','money']]});
export const Purchases=make({path:'purchases',title:'Purchases by supplier and category',mode:'range',columns:[['Date','date'],['Document','number'],['Supplier','supplierName'],['Category','category'],['Amount','amountCents','money']]});
export const PurchaseOrders=make({path:'purchase-orders',title:'Purchase orders by status',mode:'none',columns:[['Date','date'],['Document','number'],['Supplier','supplierName'],['Status','status'],['Total','totalCents','money']]});
export const ReceivedNotBilled=make({path:'received-not-billed',title:'Received but not billed',mode:'none',columns:[['Date','date'],['Receiving report','number'],['Purchase order','poNumber'],['Supplier','supplierName'],['Amount','amountCents','money']]});
export const CashPosition=make({path:'cash-position',title:'Cash position',mode:'asOf',columns:[['Code','code'],['Cash place','name'],['Balance','balanceCents','money']]});
export const Transfers=make({path:'transfers',title:'Cash transfers',mode:'range',columns:[['Date','date'],['Document','number'],['From','fromPlace'],['To','toPlace'],['Sent','sentCents','money'],['Received','receivedCents','money'],['Fee','feeCents','money']]});
export const CashCounts=make({path:'cash-counts',title:'Cash counts',mode:'range',columns:[['Date','date'],['Document','number'],['Cash place','cashPlace'],['Ledger','ledgerCents','money'],['Counted','countedCents','money'],['Difference','differenceCents','money']]});
export const AssetSchedule=make({path:'asset-schedule',title:'Fixed-asset schedule',mode:'asOf',columns:[['Asset','number'],['Description','description'],['Class','className'],['Cost','costCents','money'],['Accumulated depreciation','accumulatedCents','money'],['Book value','bookValueCents','money'],['Monthly charge','monthlyChargeCents','money']]});
export const LateEntries=make({path:'late-entries',title:'Late entries',mode:'none',columns:[['Date','date'],['Document','number'],['Type','docType'],['Recorded at','recordedAt'],['Recorded by','recordedBy']]});
export const Cancellations=make({path:'cancellations-reissues',title:'Cancellations and reissues',mode:'none',columns:[['Date','date'],['Document','number'],['Type','docType'],['Reason','reason'],['Replacement','replacementNumber']]});
export const Exceptions=make({path:'exceptions',title:'Exceptions',mode:'asOf',columns:[['Exception','kind'],['Record','number'],['Amount','amountCents','money']]});
export const SignIns=make({path:'sign-in-history',title:'Sign-in history',mode:'range',columns:[['At','at'],['Username','username'],['IP address','ip'],['Successful','success']]});
