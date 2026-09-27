import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, newId } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { parseCSV, validateRow } from './csv.ts';
import { stamp } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';

const auth = { config: { permission: 'mig.run' } };

export function migRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.post('/api/mig/upload', auth, async (req) => {
    const u = currentUser(req);
    const body = req.body as { filename: string; csv: string };
    if (!body || typeof body.csv !== 'string' || typeof body.filename !== 'string') {
      throw new AppError('INVALID_INPUT', 'Expected filename and csv text.', 400);
    }

    const rows = parseCSV(body.csv);
    if (rows.length === 0) {
      throw new AppError('EMPTY_CSV', 'The uploaded CSV contains no data rows.', 400);
    }

    const uploadId = newId();
    const now = stamp(clock);

    const parsedRows = rows.map((r, i) => {
      const parsed = validateRow(r);
      return {
        id: newId(),
        upload_id: uploadId,
        row_number: i + 2, // header is line 1
        raw_json: JSON.stringify(parsed.raw),
        row_type: parsed.rowType,
        status: parsed.status,
        issues_json: JSON.stringify(parsed.issues),
        created_at: now,
      };
    });

    tx(db, () => {
      db.prepare(`INSERT INTO mig_uploads (id, filename, uploaded_at, uploaded_by, status) VALUES (?, ?, ?, ?, 'staged')`)
        .run(uploadId, body.filename, now, u.userId);

      const insert = db.prepare(
        `INSERT INTO mig_rows (id, upload_id, row_number, raw_json, row_type, status, issues_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of parsedRows) {
        insert.run(r.id, r.upload_id, r.row_number, r.raw_json, r.row_type, r.status, r.issues_json, r.created_at);
      }
    });

    return {
      uploadId,
      totalRows: parsedRows.length,
      needsReview: parsedRows.filter((r) => r.status === 'needs_review').length,
    };
  });

  app.get('/api/mig/review', auth, async (req) => {
    // Only looking at the most recently staged upload for simplicity
    const upload = db.prepare(`SELECT id FROM mig_uploads WHERE status = 'staged' ORDER BY uploaded_at DESC LIMIT 1`).get() as { id: string } | undefined;
    if (!upload) return { rows: [] };

    const rows = db.prepare(
      `SELECT id, row_number, raw_json, row_type, status, issues_json, manual_data_json
       FROM mig_rows WHERE upload_id = ? AND status IN ('needs_review', 'accepted', 'excluded')
       ORDER BY row_number ASC`
    ).all(upload.id) as any[];

    return {
      rows: rows.map((r) => ({
        id: r.id,
        rowNumber: r.row_number,
        rowType: r.row_type,
        status: r.status,
        raw: JSON.parse(r.raw_json),
        issues: JSON.parse(r.issues_json),
        manualData: r.manual_data_json ? JSON.parse(r.manual_data_json) : null,
      }))
    };
  });

  app.post<{ Params: { id: string } }>('/api/mig/rows/:id/accept', auth, async (req) => {
    const u = currentUser(req);
    const rowId = req.params.id;
    const now = stamp(clock);
    const res = db.prepare(`UPDATE mig_rows SET status = 'accepted', resolved_by = ?, resolved_at = ? WHERE id = ?`)
      .run(u.userId, now, rowId);
    if (res.changes === 0) throw new AppError('NOT_FOUND', 'Row not found.', 404);
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/mig/rows/:id/fix', auth, async (req) => {
    const u = currentUser(req);
    const rowId = req.params.id;
    const body = req.body as { manualData: any };
    if (!body || !body.manualData) throw new AppError('INVALID_INPUT', 'Expected manualData.', 400);

    const now = stamp(clock);
    const res = db.prepare(
      `UPDATE mig_rows SET status = 'accepted', manual_data_json = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`
    ).run(JSON.stringify(body.manualData), u.userId, now, rowId);

    if (res.changes === 0) throw new AppError('NOT_FOUND', 'Row not found.', 404);
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/mig/rows/:id/exclude', auth, async (req) => {
    const u = currentUser(req);
    const rowId = req.params.id;
    const now = stamp(clock);
    const res = db.prepare(`UPDATE mig_rows SET status = 'excluded', resolved_by = ?, resolved_at = ? WHERE id = ?`)
      .run(u.userId, now, rowId);
    if (res.changes === 0) throw new AppError('NOT_FOUND', 'Row not found.', 404);
    return { success: true };
  });

  app.post('/api/mig/dry-run', auth, async (req) => {
    const upload = db.prepare(`SELECT id FROM mig_uploads WHERE status = 'staged' ORDER BY uploaded_at DESC LIMIT 1`).get() as { id: string } | undefined;
    if (!upload) throw new AppError('NOT_FOUND', 'No staged upload found.', 404);

    const rows = db.prepare(
      `SELECT raw_json, row_type, status, manual_data_json FROM mig_rows
       WHERE upload_id = ? AND status IN ('valid', 'accepted')`
    ).all(upload.id) as any[];

    // Ensure there are no rows that still need review
    const pending = db.prepare(`SELECT count(*) as c FROM mig_rows WHERE upload_id = ? AND status = 'needs_review'`).get(upload.id) as { c: number };
    if (pending.c > 0) {
      throw new AppError('PENDING_REVIEW', `There are ${pending.c} rows that still need review.`, 400);
    }

    let customers = 0;
    let employees = 0;
    let measurements = 0;
    let measurementCellSum = 0;

    for (const r of rows) {
      if (r.row_type === 'customer') customers++;
      if (r.row_type === 'employee') employees++;
      if (r.row_type === 'measurement') {
        measurements++;
        const data = JSON.parse(r.raw_json);
        // checksum logic
        for (const [key, value] of Object.entries(data)) {
           // We just sum numeric cells blindly for checksum purpose
           const n = Number(value);
           if (!isNaN(n) && key !== 'Measurement_ID' && key !== 'Row_Number') {
             measurementCellSum += n;
           }
        }
      }
    }

    // Mark as dry run passed
    db.prepare(`UPDATE mig_uploads SET status = 'dry_run_passed' WHERE id = ?`).run(upload.id);

    return {
      success: true,
      counts: { customers, employees, measurements },
      checksums: { measurementCellSum },
      message: `Dry run passed. This would create ${customers} customers, ${employees} employees, and ${measurements} measurements.`
    };
  });
}
