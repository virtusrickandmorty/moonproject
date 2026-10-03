import { openServerPrint, type Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button,Field,Notice,Panel,inputClass,peso } from '../../components/ui.tsx';
import { BookTitle,Tools,useReport,useToday,td,th,money } from './Books.tsx';
import { PendingPeriod,ResultSummary,statusWords,usePeriod, type Period } from './ReportParts.tsx';

type Result={rows:Record<string,unknown>[];from?:string;to?:string;asOf?:string;totalCents?:number};
const labels:Record<string,string>={apAging:'AP aging',purchases:'Purchases by supplier and category',purchaseOrders:'Purchase orders by status',receivedNotBilled:'Received but not billed',cashPosition:'Cash position',transfers:'Transfers',cashCounts:'Cash counts',assets:'Fixed-asset schedule',lateEntries:'Late entries',cancellations:'Cancellations and reissues',exceptions:'Exceptions',signIns:'Sign-in history'};
const endpoints:Record<string,string>={apAging:'ap-aging',purchases:'purchases',purchaseOrders:'purchase-orders',receivedNotBilled:'received-not-billed',cashPosition:'cash-position',transfers:'transfers',cashCounts:'cash-counts',assets:'assets',lateEntries:'late-entries',cancellations:'cancellations',exceptions:'exceptions',signIns:'sign-ins'};
const ranges=new Set(['purchases','transfers','cashCounts','signIns']), dated=new Set(['apAging','cashPosition','assets','exceptions']);
const columns:Record<string,[string,string][]>={
  apAging:[['supplierName','Supplier'],['number','Document'],['date','Date'],['dueDate','Due date'],['bucket','Overdue'],['balanceCents','Balance']],
  purchases:[['date','Date'],['number','Document'],['supplierName','Supplier'],['category','Category'],['amountCents','Amount']],
  purchaseOrders:[['date','Date'],['number','Purchase order'],['supplierName','Supplier'],['status','Status'],['totalCents','Amount']],
  receivedNotBilled:[['date','Date'],['number','Receiving record'],['poNumber','Purchase order'],['supplierName','Supplier'],['totalCents','Amount']],
  cashPosition:[['name','Cash place'],['balanceCents','Balance']],
  transfers:[['date','Date'],['number','Transfer'],['fromPlace','From'],['toPlace','To'],['sentCents','Amount sent'],['receivedCents','Amount received'],['feeCents','Fee'],['status','Status']],
  cashCounts:[['date','Date'],['number','Cash count'],['cashPlace','Cash place'],['countedCents','Counted amount'],['ledgerCents','Ledger balance'],['differenceCents','Difference'],['status','Status']],
  assets:[['number','Document'],['description','Asset'],['location','Location'],['acquiredOn','Acquired'],['costCents','Cost'],['accumulatedDepreciationCents','Depreciation to date'],['bookValueCents','Book value'],['monthlyChargeCents','Monthly depreciation']],
  lateEntries:[['businessDate','Date'],['number','Document'],['madeAt','Recorded at'],['summary','What was recorded']],
  cancellations:[['cancelledAt','Cancelled at'],['number','Original document'],['businessDate','Document date'],['reason','Reason'],['replacement','Replacement']],
  exceptions:[['kind','Needs attention'],['detail','Details'],['amountCents','Amount']],
  signIns:[['at','Time'],['username','Username'],['success','Result'],['ip','Network address']],
};
export function OperationsTable({kind,data}:{kind:string;data:Result}){
  const cols=columns[kind]!, amounts=cols.filter(([k])=>k.endsWith('Cents'));
  const total=(key:string)=>data.rows.reduce((n,r)=>n+(typeof r[key]==='number'?r[key] as number:0),0);
  return <><ResultSummary count={data.rows.length} summary={data.totalCents!==undefined?`Total ${peso(data.totalCents)}.`:undefined}/><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{cols.map(([k,label])=><th className={k.endsWith('Cents')?`${th} text-right`:th} key={k}>{label}</th>)}</tr></thead><tbody>{data.rows.map((r,i)=><tr key={i}>{cols.map(([k])=><td className={k.endsWith('Cents')?money:td} key={k}>{k==='replacement'?(r.replacementPath?<Link className="text-indigo-700 underline" to={String(r.replacementPath)}>Open replacement</Link>:'None'):['number','detail'].includes(k)&&r.documentPath?<Link className="text-indigo-700 underline" to={String(r.documentPath)}>{String(r[k]??'—')}</Link>:['status','bucket'].includes(k)?statusWords(r[k]):k==='success'?(r[k]?'Successful':'Unsuccessful'):k.endsWith('Cents')?(typeof r[k]==='number'?peso(r[k] as number):'—'):String(r[k]??'—')}</td>)}</tr>)}{amounts.length>0&&<tr className="font-semibold border-t-2 border-slate-400">{cols.map(([k],i)=><td className={k.endsWith('Cents')?money:td} key={k}>{i===0?'Total':k.endsWith('Cents')?peso(total(k)):''}</td>)}</tr>}</tbody></table></div></>;
}
function Report({me,kind}:{me:Me;kind:string}){
  const today=useToday(),filter:Period=ranges.has(kind)?'range':dated.has(kind)?'asOf':'none',period=usePeriod(filter,today);
  const path=filter==='none'?today?endpoints[kind]!:null:period.applied?`${endpoints[kind]}?${period.applied}`:null,{data,error}=useReport<Result>(path);
  if(!me.permissions.includes('rpt.books.view'))return <Notice>Access denied.</Notice>;
  const dates=data?.from?`${data.from} to ${data.to}`:data?.asOf?`As of ${data.asOf}`:period.dates;
  return <article className="rpt-page space-y-4"><BookTitle title={labels[kind]!} dates={dates}/><div className="flex flex-wrap items-end gap-3 print:hidden">{filter==='range'&&<Field label="From"><input type="date" className={inputClass} value={period.values.from} onChange={e=>period.change('from',e.target.value)}/></Field>}{filter!=='none'&&<Field label={filter==='asOf'?'As of':'To'}><input type="date" className={inputClass} value={period.values[filter==='asOf'?'asOf':'to']} onChange={e=>period.change(filter==='asOf'?'asOf':'to',e.target.value)}/></Field>}{filter!=='none'&&<Button tone="primary" disabled={!period.valid} onClick={period.apply}>Show</Button>}{path&&<Tools path={path}/>} {kind==='assets'&&data&&<Button onClick={()=>void openServerPrint(me,'/api/prt/reports/fixed-assets',{asOf:data.asOf!})}>Print fixed asset schedule</Button>}</div><PendingPeriod applied={period.applied} values={filter==='range'?{from:period.values.from!,to:period.values.to!}:filter==='asOf'?{asOf:period.values.asOf!}:{}}/>{error&&<Notice>{error}</Notice>}{!data&&!error&&<p>Loading…</p>}{data&&<Panel title="Results"><OperationsTable kind={kind} data={data}/></Panel>}</article>;
}
export const ApAging=(p:{me:Me})=><Report {...p} kind="apAging"/>;export const Purchases=(p:{me:Me})=><Report {...p} kind="purchases"/>;export const PurchaseOrders=(p:{me:Me})=><Report {...p} kind="purchaseOrders"/>;export const ReceivedNotBilled=(p:{me:Me})=><Report {...p} kind="receivedNotBilled"/>;export const CashPosition=(p:{me:Me})=><Report {...p} kind="cashPosition"/>;export const Transfers=(p:{me:Me})=><Report {...p} kind="transfers"/>;export const CashCounts=(p:{me:Me})=><Report {...p} kind="cashCounts"/>;export const Assets=(p:{me:Me})=><Report {...p} kind="assets"/>;export const LateEntries=(p:{me:Me})=><Report {...p} kind="lateEntries"/>;export const Cancellations=(p:{me:Me})=><Report {...p} kind="cancellations"/>;export const Exceptions=(p:{me:Me})=><Report {...p} kind="exceptions"/>;export const SignIns=(p:{me:Me})=><Report {...p} kind="signIns"/>;
