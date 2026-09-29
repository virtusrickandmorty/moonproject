import type { FastifyInstance } from "fastify";
import { AppError, csvPesos, toCsv, type CsvCell } from "@moonproject/shared";
import type { AppDeps } from "../../app.ts";
import {
  jobMargins,
  laborCost,
  payrollRegister,
  pieceWork,
  productionActivity,
  productionBoard,
  productionTiming,
  thirteenthRegister,
} from "./payroll-production.ts";

const date = (v: unknown) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  )
    throw new AppError(
      "BAD_DATE",
      "Use a valid date in YYYY-MM-DD format.",
      400,
    );
  return v;
};
const range = (q: Record<string, unknown>) => {
  const from = date(q.from),
    to = date(q.to);
  if (from > to)
    throw new AppError(
      "BAD_RANGE",
      "The first date must be on or before the last date.",
      400,
    );
  return { from, to };
};
const csv = (
  reply: {
    header: (a: string, b: string) => unknown;
    type: (v: string) => unknown;
  },
  name: string,
  rows: CsvCell[][],
) => {
  reply.header("Content-Disposition", `attachment; filename="${name}.csv"`);
  reply.type("text/csv; charset=utf-8");
  return toCsv(rows);
};
const p = (v: unknown) => csvPesos(Number(v));
const values = (rows: Record<string, unknown>[], cols: string[]) =>
  rows.map(
    (r) =>
      cols.map((c) =>
        c.endsWith("Cents") ? p(r[c]) : String(r[c] ?? ""),
      ) as CsvCell[],
  );

export function payrollProductionRoutes(
  app: FastifyInstance,
  { db }: AppDeps,
): void {
  app.get(
    "/api/rpt/payroll-register",
    { config: { permission: "pay.run.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>;
      const month =
        typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month)
          ? q.month
          : (() => {
              throw new AppError(
                "BAD_MONTH",
                "Use a month in YYYY-MM format.",
                400,
              );
            })();
      const r = payrollRegister(
        db,
        month,
        typeof q.runId === "string" ? q.runId : undefined,
      );
      return q.format === "csv"
        ? csv(reply, `payroll-register-${month}`, [
            [
              "Run",
              "Employee",
              "Gross PHP",
              "Employee shares PHP",
              "Employer shares PHP",
              "Tax PHP",
              "Loans PHP",
              "CA PHP",
              "Net PHP",
              "Document link",
            ],
            ...values(r.rows, [
              "number",
              "employeeName",
              "grossCents",
              "employeeSharesCents",
              "employerSharesCents",
              "taxCents",
              "loanCents",
              "caCents",
              "netCents",
              "documentPath",
            ]),
          ])
        : r;
    },
  );
  app.get(
    "/api/rpt/piece-work",
    { config: { permission: "pay.run.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        x = range(q),
        r = pieceWork(db, x.from, x.to);
      return q.format === "csv"
        ? csv(reply, `piece-work-${x.from}-${x.to}`, [
            ["Employee", "Pieces", "Pay PHP"],
            ...values(r.byEmployee, ["employeeName", "qty", "amountCents"]),
            [],
            ["Job order", "Pieces", "Pay PHP", "Document link"],
            ...values(r.byJobOrder, [
              "jobOrderId",
              "qty",
              "amountCents",
              "documentPath",
            ]),
          ])
        : r;
    },
  );
  app.get(
    "/api/rpt/labor-cost",
    { config: { permission: "pay.run.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        x = range(q),
        r = laborCost(db, x.from, x.to);
      return q.format === "csv"
        ? csv(reply, `labor-cost-${x.from}-${x.to}`, [
            ["Job order", "Pieces", "Piece labor PHP", "Document link"],
            ...values(r.rows, [
              "jobOrderId",
              "qty",
              "amountCents",
              "documentPath",
            ]),
          ])
        : r;
    },
  );
  app.get(
    "/api/rpt/thirteenth-register",
    { config: { permission: "pay.run.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        year = Number(q.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100)
        throw new AppError("BAD_YEAR", "Use a four-digit year.", 400);
      const r = thirteenthRegister(db, year);
      return q.format === "csv"
        ? csv(reply, `13th-month-${year}`, [
            [
              "Document",
              "Employee",
              "Due PHP",
              "Accrued PHP",
              "Paid PHP",
              "Taxable PHP",
              "Document link",
            ],
            ...values(r.rows, [
              "number",
              "employeeName",
              "dueCents",
              "accruedCents",
              "paidCents",
              "taxableCents",
              "documentPath",
            ]),
          ])
        : r;
    },
  );
  app.get(
    "/api/rpt/production-board",
    { config: { permission: "prd.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        r = productionBoard(db);
      return q.format === "csv"
        ? csv(reply, "production-board", [
            ["Status", "Count"],
            ...values(r.rows, ["stage", "count"]),
          ])
        : r;
    },
  );
  app.get(
    "/api/rpt/production-activity",
    { config: { permission: "prd.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        x = range(q),
        r = productionActivity(db, x.from, x.to);
      return q.format === "csv"
        ? csv(reply, `production-activity-${x.from}-${x.to}`, [
            [
              "Date",
              "Entry",
              "Job order",
              "Step",
              "Worker",
              "Pieces",
              "Document link",
            ],
            ...values(r.source, [
              "workDate",
              "number",
              "jobOrderNumber",
              "stepName",
              "employeeName",
              "pieces",
              "documentPath",
            ]),
          ])
        : r;
    },
  );
  app.get(
    "/api/rpt/production-throughput",
    { config: { permission: "prd.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        x = range(q),
        r = productionActivity(db, x.from, x.to);
      return q.format === "csv"
        ? csv(reply, `production-throughput-${x.from}-${x.to}`, [
            ["Step", "Pieces"],
            ...values(r.throughput, ["stepName", "pieces"]),
          ])
        : { from: x.from, to: x.to, rows: r.throughput };
    },
  );
  app.get(
    "/api/rpt/worker-output",
    { config: { permission: "prd.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        x = range(q),
        r = productionActivity(db, x.from, x.to);
      return q.format === "csv"
        ? csv(reply, `worker-output-${x.from}-${x.to}`, [
            ["Worker", "Step", "Pieces"],
            ...values(r.workerOutput, ["employeeName", "stepName", "pieces"]),
          ])
        : { from: x.from, to: x.to, rows: r.workerOutput };
    },
  );
  app.get(
    "/api/rpt/production-timing",
    { config: { permission: "prd.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        today = date(q.asOf),
        r = productionTiming(db, today);
      return q.format === "csv"
        ? csv(reply, `production-timing-${today}`, [
            [
              "Job order",
              "Customer",
              "Ordered",
              "Due",
              "Released",
              "Lead days",
              "Status",
              "Document link",
            ],
            ...values(r.rows, [
              "number",
              "customerName",
              "orderDate",
              "dueDate",
              "releaseDate",
              "leadDays",
              "stage",
              "documentPath",
            ]),
          ])
        : r;
    },
  );
  app.get(
    "/api/rpt/lead-time",
    { config: { permission: "prd.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        today = date(q.asOf),
        r = productionTiming(db, today);
      return q.format === "csv"
        ? csv(reply, `lead-time-${today}`, [
            [
              "Job order",
              "Customer",
              "Ordered",
              "Released",
              "Lead days",
              "Document link",
            ],
            ...values(r.rows, [
              "number",
              "customerName",
              "orderDate",
              "releaseDate",
              "leadDays",
              "documentPath",
            ]),
          ])
        : { asOf: today, rows: r.rows };
    },
  );
  app.get(
    "/api/rpt/late-jobs",
    { config: { permission: "prd.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        today = date(q.asOf),
        r = productionTiming(db, today);
      return q.format === "csv"
        ? csv(reply, `late-jobs-${today}`, [
            ["Job order", "Customer", "Due", "Status", "Document link"],
            ...values(r.late, [
              "number",
              "customerName",
              "dueDate",
              "stage",
              "documentPath",
            ]),
          ])
        : { asOf: today, rows: r.late };
    },
  );
  app.get(
    "/api/rpt/job-margin",
    { config: { permission: "pay.run.view" } },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>,
        r = jobMargins(db);
      return q.format === "csv"
        ? csv(reply, "job-margin", [
            [
              "Job order",
              "Customer",
              "Invoice net PHP",
              "Tagged piece labor PHP",
              "Margin PHP",
              "Document link",
            ],
            ...values(r.rows, [
              "number",
              "customerName",
              "invoiceNetCents",
              "pieceLaborCents",
              "marginCents",
              "documentPath",
            ]),
          ])
        : r;
    },
  );
}
