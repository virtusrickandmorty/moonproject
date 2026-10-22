/** Read-only payroll and production reports. Payroll money is from posted snapshots; job margin is explicitly non-GL. */
import type { Db } from '../../platform/db/driver.ts';
import { payrollEarningRows, payrollReportRows, thirteenthReportRows } from '../PAY/public.ts';
import { board, productionReportRows } from '../PRD/public.ts';
import { employee } from '../EMP/public.ts';
import { invoiceRecordsOf, productionOrderRows } from '../JO/public.ts';
import { programFigures, restockPrograms } from '../TPL/public.ts';
import { documentPath } from './sales-collections.ts';

type AnyRow = Record<string, string | number | null>;
const sum = (rows: AnyRow[], key: string) => rows.reduce((n, r) => n + Number(r[key] ?? 0), 0);
const group = (rows: AnyRow[], keys: string[], totals: string[]) => {
  const out = new Map<string, AnyRow>();
  for (const row of rows) {
    const id = keys.map((k) => row[k]).join('\0'); const old: AnyRow = out.get(id) ?? Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
    for (const k of totals) old[k] = Number(old[k] ?? 0) + Number(row[k] ?? 0); out.set(id, old);
  }
  return [...out.values()];
};

export function payrollRegister(db: Db, month: string, runId?: string) {
  const all = payrollReportRows(db) as unknown as AnyRow[];
  const rows = all.filter((r) => runId ? r.documentId === runId : r.contributionMonth === month).map((r) => ({ ...r,
    employeeSharesCents: Number(r.sssEeCents)+Number(r.phicEeCents)+Number(r.hdmfEeCents),
    employerSharesCents: Number(r.sssErCents)+Number(r.sssEcCents)+Number(r.phicErCents)+Number(r.hdmfErCents),
    documentType: 'pay.run', documentPath: documentPath('pay.run', String(r.documentId)) }));
  const money = ['grossCents','employeeSharesCents','employerSharesCents','taxCents','loanCents','caCents','netCents'];
  return { month, runId: runId ?? null, rows, totals: Object.fromEntries(money.map((k) => [k, sum(rows,k)])) };
}

export function pieceWork(db: Db, from: string, to: string) {
  const runs = new Map((payrollReportRows(db) as unknown as AnyRow[]).map((r) => [String(r.documentId), r]));
  const lines = (payrollEarningRows(db) as AnyRow[]).filter((r) => r.kind === 'piece' && (() => { const x=runs.get(String(r.documentId)); return x && x.periodEnd! >= from && x.periodStart! <= to; })());
  return { from, to, byEmployee: group(lines,['employeeId','employeeCode','employeeName'],['qty','amountCents']),
    byJobOrder: group(lines.filter((r)=>r.jobOrderId!==null),['jobOrderId'],['qty','amountCents']).map((r)=>({ ...r, documentType:'jo.job_order', documentPath:documentPath('jo.job_order',String(r.jobOrderId)) })) };
}

export function laborCost(db: Db, from: string, to: string) {
  const rows = group((payrollEarningRows(db) as AnyRow[]).filter((r)=>r.kind==='piece' && r.jobOrderId!==null && String(r.periodEnd)>=from && String(r.periodStart)<=to),['jobOrderId'],['qty','amountCents']);
  return { from,to,rows:rows.map((r)=>({ ...r, documentType:'jo.job_order',documentPath:documentPath('jo.job_order',String(r.jobOrderId)) })) };
}

export const thirteenthRegister = (db: Db, year: number) => ({ year, rows:(thirteenthReportRows(db,year) as AnyRow[]).map((r)=>({ ...r,documentType:'pay.thirteenth',documentPath:documentPath('pay.thirteenth',String(r.documentId)) })) });

export function productionBoard(db: Db) {
  const cards = board(db); const counts=new Map<string,number>();
  for (const c of cards) counts.set(c.stage,(counts.get(c.stage)??0)+1);
  return { rows:[...counts].map(([stage,count])=>({stage,count})), cards:cards.map((c)=>({ ...c,documentType:'jo.job_order',documentPath:documentPath('jo.job_order',c.jobOrderId) })) };
}

export function productionActivity(db: Db, from: string, to: string) {
  const names=new Map<string,string>(); // each worker is looked up once, not once per entry
  const nameOf=(id:string)=>names.get(id)??names.set(id,employee(db,id)?.name??id).get(id)!;
  const source=(productionReportRows(db,from,to) as AnyRow[]).map((r)=>({ ...r,employeeName:nameOf(String(r.employeeId)),documentType:'prd.entry',documentPath:documentPath('prd.entry',String(r.documentId)) }));
  return { from,to,throughput:group(source,['stepId','stepCode','stepName'],['pieces']),workerOutput:group(source,['employeeId','employeeName','stepName'],['pieces']),source };
}

export function productionTiming(db: Db, today: string) {
  const rows: AnyRow[]=(productionOrderRows(db) as AnyRow[]).map((r)=>({ ...r,leadDays:r.releaseDate===null?null:Math.round((Date.parse(String(r.releaseDate))-Date.parse(String(r.orderDate)))/86400000),documentType:'jo.job_order',documentPath:documentPath('jo.job_order',String(r.id)) }));
  return { rows,late:rows.filter((r)=>r.releaseDate===null && String(r.dueDate)<today) };
}

export function jobMargins(db: Db) {
  const labor=new Map((laborCost(db,'0000-01-01','9999-12-31').rows as AnyRow[]).map((r)=>[String(r.jobOrderId),Number(r.amountCents)]));
  const sales=new Map<string,number>();
  for(const i of invoiceRecordsOf(db,'all')) sales.set(i.jobOrderId,(sales.get(i.jobOrderId)??0)+i.grossCents-i.vatCents);
  // A TPL restock is a ₱0 job order billed later on its client's deliveries: margined per client below, not as a loss here.
  const restocks=restockPrograms(db);
  const rows=(productionOrderRows(db) as AnyRow[]).filter((j)=>!restocks.has(String(j.id))).map((j)=>({ id:j.id,number:j.number,customerName:j.customerName,invoiceNetCents:sales.get(String(j.id))??0,pieceLaborCents:labor.get(String(j.id))??0,
    marginCents:(sales.get(String(j.id))??0)-(labor.get(String(j.id))??0),documentType:'jo.job_order',documentPath:documentPath('jo.job_order',String(j.id)) }));
  const tplLabor=new Map<string,{ labor:number; restocks:number }>();
  for(const [jo,r] of restocks){ const t=tplLabor.get(r.programId)??{ labor:0,restocks:0 }; tplLabor.set(r.programId,{ labor:t.labor+(labor.get(jo)??0),restocks:t.restocks+1 }); }
  const tplClients=programFigures(db).filter((p)=>tplLabor.has(p.programId)||p.piecesDelivered>0).map((p)=>{ const t=tplLabor.get(p.programId)??{ labor:0,restocks:0 };
    return { programId:p.programId,customerName:p.customerName,restocks:t.restocks,piecesIn:p.piecesIn,piecesDelivered:p.piecesDelivered,invoiceNetCents:p.goodsNetCents,pieceLaborCents:t.labor,
      laborPerPieceCents:p.piecesIn>0?Math.round(t.labor/p.piecesIn):null,marginCents:p.goodsNetCents-t.labor }; });
  return { basis:'Invoice net less tagged piece labor; this is an operational figure, not from the general ledger. TPL clients are margined per client: the invoices of their deliveries less the labor of their restock job orders (pieces still in stock are not sold yet).',rows,tplClients };
}
