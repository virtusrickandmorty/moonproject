import type { Db } from '../../platform/db/driver.ts';

export const supplierReports = {
  aging(db: Db, asOf: string) {
    const rows = db.prepare(`SELECT b.document_id AS id,d.number,d.business_date AS date,b.due_date AS dueDate,
      s.name AS supplierName,COALESCE(SUM(jl.credit_cents-jl.debit_cents),0) AS balanceCents
      FROM ap_bills b JOIN documents d ON d.id=b.document_id JOIN pur_suppliers s ON s.id=b.supplier_id
      JOIN journal_lines jl ON jl.ref_doc_id=d.id JOIN journals j ON j.id=jl.journal_id
      JOIN accounts a ON a.id=jl.account_id AND a.role_key='AP'
      WHERE j.business_date<=? AND j.sealed=1 GROUP BY b.document_id HAVING balanceCents<>0 ORDER BY s.name,b.due_date`).all(asOf);
    return { asOf, rows };
  },
  purchases(db: Db, from: string, to: string) {
    const rows = db.prepare(`SELECT d.id,d.number,d.business_date AS date,s.name AS supplierName,
      CASE WHEN l.category_id IS NOT NULL THEN COALESCE(c.name,'Category') WHEN l.supply_id IS NOT NULL THEN COALESCE(p.name,'Supply') ELSE l.purchase END AS category,
      SUM(l.amount_cents-l.vat_cents) AS amountCents
      FROM ap_bill_lines l JOIN ap_bills b ON b.document_id=l.document_id JOIN documents d ON d.id=l.document_id
      JOIN pur_suppliers s ON s.id=b.supplier_id LEFT JOIN exp_categories c ON c.id=l.category_id LEFT JOIN pur_supplies p ON p.id=l.supply_id
      WHERE d.status='posted' AND d.business_date BETWEEN ? AND ? GROUP BY d.id,category ORDER BY d.business_date,d.number`).all(from,to);
    return { from, to, rows };
  },
  orders(db: Db) { return { rows: db.prepare(`SELECT d.id,d.number,d.business_date AS date,d.status,s.name AS supplierName,
    SUM(l.qty*l.unit_cost_cents) AS totalCents,COALESCE(SUM((SELECT SUM(r.qty) FROM pur_rr_lines r JOIN documents rd ON rd.id=r.document_id AND rd.status='posted' WHERE r.po_document_id=l.document_id AND r.po_line_no=l.line_no)),0) AS receivedQty
    FROM pur_purchase_orders p JOIN documents d ON d.id=p.document_id JOIN pur_suppliers s ON s.id=p.supplier_id JOIN pur_po_lines l ON l.document_id=d.id GROUP BY d.id ORDER BY d.business_date,d.number`).all() }; },
  unbilled(db: Db) { return { rows: db.prepare(`SELECT rd.id,rd.number,rd.business_date AS date,pd.number AS poNumber,s.name AS supplierName,SUM(r.qty*l.unit_cost_cents) AS amountCents
    FROM pur_receiving_reports rr JOIN documents rd ON rd.id=rr.document_id AND rd.status='posted' JOIN documents pd ON pd.id=rr.po_document_id
    JOIN pur_purchase_orders p ON p.document_id=rr.po_document_id JOIN pur_suppliers s ON s.id=p.supplier_id
    JOIN pur_rr_lines r ON r.document_id=rr.document_id JOIN pur_po_lines l ON l.document_id=r.po_document_id AND l.line_no=r.po_line_no
    WHERE NOT EXISTS(SELECT 1 FROM ap_bills b JOIN documents bd ON bd.id=b.document_id AND bd.status='posted' WHERE b.receiving_report_id=rr.document_id)
    GROUP BY rd.id ORDER BY rd.business_date,rd.number`).all() }; },
};

export const cashReports = {
  position(db: Db, asOf: string) { return { asOf, rows: db.prepare(`SELECT a.id,a.name,a.code,COALESCE(SUM(CASE WHEN j.business_date<=? THEN l.debit_cents-l.credit_cents ELSE 0 END),0) AS balanceCents
    FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journals j ON j.id=l.journal_id AND j.sealed=1 WHERE a.is_cash_place=1 GROUP BY a.id ORDER BY a.sort_order,a.code`).all(asOf) }; },
  transfers(db: Db, from: string, to: string) { return { from,to,rows: db.prepare(`SELECT d.id,d.number,d.business_date AS date,d.status,f.name AS fromPlace,t.name AS toPlace,x.amount_sent_cents AS sentCents,x.amount_received_cents AS receivedCents,x.fee_cents AS feeCents
    FROM cash_transfers x JOIN documents d ON d.id=x.document_id JOIN accounts f ON f.id=x.from_account_id JOIN accounts t ON t.id=x.to_account_id WHERE d.business_date BETWEEN ? AND ? ORDER BY d.business_date,d.number`).all(from,to) }; },
  counts(db: Db, from: string, to: string) { return { from,to,rows: db.prepare(`SELECT d.id,d.number,d.business_date AS date,d.status,a.name AS cashPlace,c.ledger_cents AS ledgerCents,c.counted_cents AS countedCents,c.difference_cents AS differenceCents
    FROM cash_counts c JOIN documents d ON d.id=c.document_id JOIN accounts a ON a.id=c.cash_account_id WHERE d.business_date BETWEEN ? AND ? ORDER BY d.business_date,d.number`).all(from,to) }; },
};

export function assetSchedule(db: Db, asOf: string) { return { asOf, rows: db.prepare(`SELECT d.id,d.number,a.description,c.name AS className,a.acquired_on AS acquiredOn,a.cost_cents AS costCents,
  COALESCE(-(SELECT SUM(l.debit_cents-l.credit_cents) FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts x ON x.id=l.account_id WHERE l.party_type='asset' AND l.party_id=d.id AND x.role_key=c.accum_role AND j.business_date<=? AND j.sealed=1),0) AS accumulatedCents,
  a.cost_cents-COALESCE(-(SELECT SUM(l.debit_cents-l.credit_cents) FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts x ON x.id=l.account_id WHERE l.party_type='asset' AND l.party_id=d.id AND x.role_key=c.accum_role AND j.business_date<=? AND j.sealed=1),0) AS bookValueCents,
  CAST((a.cost_cents-a.residual_cents+a.life_months/2)/a.life_months AS INTEGER) AS monthlyChargeCents
  FROM fa_all_assets a JOIN documents d ON d.id=a.document_id JOIN fa_classes c ON c.code=a.class_code WHERE d.business_date<=? AND d.status='posted' ORDER BY d.number`).all(asOf,asOf,asOf) }; }

export const controlReports = {
  late(db: Db) { return { rows: db.prepare(`SELECT d.id,d.number,d.doc_type AS docType,d.business_date AS date,d.posted_at AS recordedAt,u.display_name AS recordedBy FROM documents d JOIN users u ON u.id=d.posted_by WHERE d.doc_type IN ('acc.jv','acc.opening') AND d.business_date<substr(d.posted_at,1,10) ORDER BY d.posted_at DESC`).all() }; },
  lifecycle(db: Db) { return { rows: db.prepare(`SELECT d.id,d.number,d.doc_type AS docType,d.business_date AS date,d.cancel_reason AS reason,d.replaced_by_id AS replacementId,r.number AS replacementNumber FROM documents d LEFT JOIN documents r ON r.id=d.replaced_by_id WHERE d.status='cancelled' ORDER BY d.cancelled_at DESC`).all() }; },
  exceptions(db: Db, asOf: string) { const rows = db.prepare(`SELECT 'Released without invoice record' AS kind,d.id,d.number,0 AS amountCents FROM jo_releases r JOIN documents d ON d.id=r.document_id AND d.status='posted' WHERE NOT EXISTS(SELECT 1 FROM jo_invoice_records i JOIN documents x ON x.id=i.document_id AND x.status='posted' WHERE i.release_id=r.document_id)
    UNION ALL SELECT 'Cash place below zero',NULL,a.name,SUM(l.debit_cents-l.credit_cents) FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journals j ON j.id=l.journal_id WHERE a.is_cash_place=1 AND j.business_date<=? GROUP BY a.id HAVING SUM(l.debit_cents-l.credit_cents)<0
    UNION ALL SELECT 'Draft older than 3 days',id,doc_type,0 FROM drafts WHERE status='open' AND date(created_at)<date(?,'-3 days')`).all(asOf,asOf); return {asOf,rows}; },
  signins(db: Db, from: string, to: string) { return {from,to,rows:db.prepare(`SELECT id,username,ip,at,success FROM login_attempts WHERE substr(at,1,10) BETWEEN ? AND ? ORDER BY at DESC`).all(from,to)}; },
};
