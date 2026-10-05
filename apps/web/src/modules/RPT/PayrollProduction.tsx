import { type ReactNode } from 'react';
import type { Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, td, th, money as moneyClass, usePagedReport, useToday } from './Books.tsx';
import { PendingPeriod, ResultSummary, daysOverdue, statusWords, usePeriod } from './ReportParts.tsx';
import './books.css';

type Row=Record<string,string|number|null>; type Filter='month'|'year'|'range'|'asOf'|'none';
const cell=(r:Row,k:string,money=false):ReactNode=>k==='document'?<Link className="text-indigo-700 underline" to={String(r.documentPath)}>{String(r.number)}</Link>:k==='stage'?statusWords(r[k]):money?peso(Number(r[k]??0)):String(r[k]??'—');
function Report({me,title,route,permission,filter='none',children}:{me:Me;title:string;route:string;permission:string;filter?:Filter;children:(path:string|null)=>ReactNode}){
  const today=useToday(),period=usePeriod(filter,today),{from,to}=period.values,one=period.values[filter]??'',applied=period.applied;
  if(!me.permissions.includes(permission))return <Notice>Access denied.</Notice>;
  const path=filter==='none'?today?route:null:applied?`${route}?${applied}`:null;
  return <article className="rpt-page space-y-4"><BookTitle title={title} dates={period.dates}/><div className="flex flex-wrap items-end gap-3 print:hidden">
    {filter==='range'?<><Field label="From"><input type="date" className={inputClass} value={from} onChange={e=>period.change('from',e.target.value)}/></Field><Field label="To"><input type="date" className={inputClass} value={to} onChange={e=>period.change('to',e.target.value)}/></Field></>:filter!=='none'&&<Field label={filter==='asOf'?'As of':filter==='month'?'Month':'Year'}><input type={filter==='asOf'?'date':filter==='year'?'number':filter} className={inputClass} value={one} onChange={e=>period.change(filter,e.target.value)}/></Field>}
    {filter!=='none'&&<Button tone="primary" disabled={!period.valid} onClick={period.apply}>Show</Button>}{path&&<Tools path={path}/>}</div><PendingPeriod applied={applied} values={filter==='range'?{from:from!,to:to!}:filter==='none'?{}:{[filter]:one}}/>{children(path)}</article>;
}
export function Table({heads,keys,rows,money=[],totals,total}:{heads:string[];keys:string[];rows:Row[];money?:string[];totals?:Row;total?:number}){
  const cols=keys.map((k,i)=>({key:k,head:heads[i]}));
  const sum=(k:string)=>Number(totals?.[k]??rows.reduce((n,r)=>n+Number(r[k]??0),0)),main=['netCents','dueCents','marginCents','amountCents','pieces','qty','count'].find(k=>keys.includes(k));
  const summary=main?`${heads[keys.indexOf(main)]} ${money.includes(main)?peso(sum(main)):sum(main).toLocaleString('en-PH')}${total!==undefined&&total>rows.length?' on this page':''}.`:undefined;
  return <><ResultSummary count={rows.length} total={total} summary={summary}/><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{cols.map(c=><th className={money.includes(c.key)?`${th} text-right`:th} key={c.key}>{c.head}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{cols.map(c=><td className={money.includes(c.key)?moneyClass:td} key={c.key}>{cell(r,c.key,money.includes(c.key))}</td>)}</tr>)}{money.length>0&&<tr className="font-semibold border-t-2 border-slate-400">{cols.map((c,i)=><td className={money.includes(c.key)?moneyClass:td} key={c.key}>{i===0?'Total':money.includes(c.key)?peso(sum(c.key)):''}</td>)}</tr>}</tbody></table></div>{money.length>0&&total!==undefined&&total>rows.length&&<p className="text-xs text-slate-600">Totals cover this page.</p>}</>;
}
// Long reports (lead time, late jobs, job margin, labor cost) come a page at a time; the others answer without a `page` and show no pager.
function Data({path,pick}:{path:string|null;pick:(d:any)=>ReactNode}){const {data,error,pager}=usePagedReport<any>(path);return data?<>{pick(data)}{pager}</>:path?(error?<Notice>{error}</Notice>:<p>Loading…</p>):null;}
const page=(title:string,route:string,permission:string,filter:Filter,pick:(d:any)=>ReactNode)=>({me}:{me:Me})=><Report me={me} title={title} route={route} permission={permission} filter={filter}>{path=><Data path={path} pick={pick}/>}</Report>;
const docMoney=(heads:string[],keys:string[])=>(d:any)=><Panel title="Results"><Table heads={heads} keys={keys} rows={d.rows} totals={d.totals} total={d.page?.total} money={keys.filter(k=>k.endsWith('Cents'))}/></Panel>;

export const PayrollRegister=page('Payroll register','payroll-register','pay.run.view','month',docMoney(['Run','Employee','Gross pay','Employee share','Company share','Tax','Loans','Cash advance','Net pay'],['document','employeeName','grossCents','employeeSharesCents','employerSharesCents','taxCents','loanCents','caCents','netCents']));
export const PieceWork=page('Piece-work summary','piece-work','pay.run.view','range',d=><><Panel title="Per employee"><Table heads={['Employee','Pieces','Pay']} keys={['employeeName','qty','amountCents']} rows={d.byEmployee} money={['amountCents']}/></Panel><Panel title="Per job order"><p className="mb-3 text-sm text-slate-600">Job-order numbers are unavailable in this report.</p><Table heads={['Pieces','Pay']} keys={['qty','amountCents']} rows={d.byJobOrder} money={['amountCents']}/></Panel></>);
export const LaborCost=page('Labor cost per job order','labor-cost','pay.run.view','range',d=><><p className="text-sm text-slate-600">Job-order numbers are unavailable in this report.</p>{docMoney(['Pieces','Piece labor'],['qty','amountCents'])(d)}</>);
export const ThirteenthRegister=page('13th-month register','thirteenth-register','pay.run.view','year',docMoney(['Document','Employee','Due','Accrued','Paid','Taxable'],['document','employeeName','dueCents','accruedCents','paidCents','taxableCents']));
export const ProductionStatus=page('Production board status','production-board','prd.view','none',d=><Panel title="Current status counts"><Table heads={['Status','Job orders']} keys={['stage','count']} rows={d.rows}/></Panel>);
export const Throughput=page('Production throughput per step','production-throughput','prd.view','range',d=><Panel title="Pieces per step"><Table heads={['Step','Pieces']} keys={['stepName','pieces']} rows={d.rows}/></Panel>);
export const WorkerOutput=page('Worker output','worker-output','prd.view','range',d=><Panel title="Pieces per worker and step"><Table heads={['Worker','Step','Pieces']} keys={['employeeName','stepName','pieces']} rows={d.rows}/></Panel>);
export const LeadTime=page('Job order lead time','lead-time','prd.view','asOf',docMoney(['Job order','Customer','Ordered','Released','Lead days'],['document','customerName','orderDate','releaseDate','leadDays']));
export const LateJobs=page('Late job orders','late-jobs','prd.view','asOf',d=><Panel title="Late job orders"><Table heads={['Job order','Customer','Due date','Days overdue','Status']} keys={['document','customerName','dueDate','overdue','stage']} rows={d.rows.map((r:Row)=>({...r,overdue:`${daysOverdue(String(r.dueDate),d.asOf)} days overdue`}))} total={d.page?.total}/></Panel>);
export const JobMargin=page('Job margin per job order','job-margin','pay.run.view','none',d=><><Notice tone="note">{d.basis}</Notice><Panel title="Operational margin"><Table heads={['Job order','Customer','Invoice net','Tagged piece labor','Margin']} keys={['document','customerName','invoiceNetCents','pieceLaborCents','marginCents']} rows={d.rows} total={d.page?.total} money={['invoiceNetCents','pieceLaborCents','marginCents']}/></Panel></>);
