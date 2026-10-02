import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, td, th, usePagedReport, useToday } from './Books.tsx';
import './books.css';

type Row=Record<string,string|number|null>; type Filter='month'|'year'|'range'|'asOf'|'none';
const cell=(r:Row,k:string,money=false):ReactNode=>k==='document'?<Link className="text-indigo-700 underline" to={String(r.documentPath)}>{String(r.number??r.jobOrderId)}</Link>:money?peso(Number(r[k]??0)):String(r[k]??'—');
function Report({me,title,route,permission,filter='none',children}:{me:Me;title:string;route:string;permission:string;filter?:Filter;children:(path:string|null)=>ReactNode}){
  const today=useToday(),[from,setFrom]=useState(''),[to,setTo]=useState(''),[one,setOne]=useState(''),[applied,setApplied]=useState('');
  useEffect(()=>{if(!today)return;if(!from){setFrom(`${today.slice(0,7)}-01`);setTo(today);}if(!one)setOne(filter==='year'?today.slice(0,4):filter==='month'?today.slice(0,7):today);},[today,filter,from,one]);
  useEffect(()=>{if(!applied&&one&&filter!=='range')setApplied(filter==='none'?'':new URLSearchParams({[filter]:one}).toString());if(!applied&&from&&to&&filter==='range')setApplied(new URLSearchParams({from,to}).toString());},[applied,filter,from,to,one]);
  if(!me.permissions.includes(permission))return <Notice>Access denied.</Notice>;
  const path=filter==='none'?route:applied?`${route}?${applied}`:null;
  const apply=()=>setApplied(filter==='range'?new URLSearchParams({from,to}).toString():new URLSearchParams({[filter]:one}).toString());
  return <article className="rpt-page space-y-4"><BookTitle title={title} dates={filter==='range'?`${from} to ${to}`:one}/><div className="flex flex-wrap items-end gap-3 print:hidden">
    {filter==='range'?<><Field label="From"><input type="date" className={inputClass} value={from} onChange={e=>setFrom(e.target.value)}/></Field><Field label="To"><input type="date" className={inputClass} value={to} onChange={e=>setTo(e.target.value)}/></Field></>:filter!=='none'&&<Field label={filter==='asOf'?'As of':filter}><input type={filter==='asOf'?'date':filter} className={inputClass} value={one} onChange={e=>setOne(e.target.value)}/></Field>}
    {filter!=='none'&&<Button tone="primary" onClick={apply}>Show</Button>}{path&&<Tools path={path}/>}</div>{children(path)}</article>;
}
function Table({heads,keys,rows,money=[]}:{heads:string[];keys:string[];rows:Row[];money?:string[]}){return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{heads.map(h=><th className={th} key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{keys.map(k=><td className={td} key={k}>{cell(r,k,money.includes(k))}</td>)}</tr>)}</tbody></table></div>}
// Long reports (lead time, late jobs, job margin, labor cost) come a page at a time; the others answer without a `page` and show no pager.
function Data({path,pick}:{path:string|null;pick:(d:any)=>ReactNode}){const {data,error,pager}=usePagedReport<any>(path);return data?<>{pick(data)}{pager}</>:path?(error?<Notice>{error}</Notice>:<p>Loading…</p>):null;}
const page=(title:string,route:string,permission:string,filter:Filter,pick:(d:any)=>ReactNode)=>({me}:{me:Me})=><Report me={me} title={title} route={route} permission={permission} filter={filter}>{path=><Data path={path} pick={pick}/>}</Report>;
const docMoney=(heads:string[],keys:string[])=>(d:any)=><Panel title={`${d.page?.total ?? d.rows.length} rows`}><Table heads={heads} keys={keys} rows={d.rows} money={keys.filter(k=>k.endsWith('Cents'))}/></Panel>;

export const PayrollRegister=page('Payroll register','payroll-register','pay.run.view','month',docMoney(['Run','Employee','Gross','EE shares','ER shares','Tax','Loans','CA','Net'],['document','employeeName','grossCents','employeeSharesCents','employerSharesCents','taxCents','loanCents','caCents','netCents']));
export const PieceWork=page('Piece-work summary','piece-work','pay.run.view','range',d=><><Panel title="Per employee"><Table heads={['Employee','Pieces','Pay']} keys={['employeeName','qty','amountCents']} rows={d.byEmployee} money={['amountCents']}/></Panel><Panel title="Per job order"><Table heads={['Job order','Pieces','Pay']} keys={['document','qty','amountCents']} rows={d.byJobOrder} money={['amountCents']}/></Panel></>);
export const LaborCost=page('Labor cost per job order','labor-cost','pay.run.view','range',docMoney(['Job order','Pieces','Piece labor'],['document','qty','amountCents']));
export const ThirteenthRegister=page('13th-month register','thirteenth-register','pay.run.view','year',docMoney(['Document','Employee','Due','Accrued','Paid','Taxable'],['document','employeeName','dueCents','accruedCents','paidCents','taxableCents']));
export const ProductionStatus=page('Production board status','production-board','prd.view','none',d=><Panel title="Current status counts"><Table heads={['Status','Job orders']} keys={['stage','count']} rows={d.rows}/></Panel>);
export const Throughput=page('Production throughput per step','production-throughput','prd.view','range',d=><Panel title="Pieces per step"><Table heads={['Step','Pieces']} keys={['stepName','pieces']} rows={d.rows}/></Panel>);
export const WorkerOutput=page('Worker output','worker-output','prd.view','range',d=><Panel title="Pieces per worker and step"><Table heads={['Worker','Step','Pieces']} keys={['employeeName','stepName','pieces']} rows={d.rows}/></Panel>);
export const LeadTime=page('Job order lead time','lead-time','prd.view','asOf',docMoney(['Job order','Customer','Ordered','Released','Lead days'],['document','customerName','orderDate','releaseDate','leadDays']));
export const LateJobs=page('Late job orders','late-jobs','prd.view','asOf',d=><Panel title={`${d.page?.total ?? d.rows.length} late`}><Table heads={['Job order','Customer','Due','Status']} keys={['document','customerName','dueDate','stage']} rows={d.rows}/></Panel>);
export const JobMargin=page('Job margin per job order','job-margin','pay.run.view','none',d=><><Notice tone="note">{d.basis}</Notice><Panel title="Operational margin"><Table heads={['Job order','Customer','Invoice net','Tagged piece labor','Margin']} keys={['document','customerName','invoiceNetCents','pieceLaborCents','marginCents']} rows={d.rows} money={['invoiceNetCents','pieceLaborCents','marginCents']}/></Panel></>);
