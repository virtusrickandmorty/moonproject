import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, newId } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { parseCSV, validateRow } from './csv.ts';
import { stamp } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';

const auth = { config: { permission: 'mig.run' } };

const uploadBody = z.object({
  filename: z.string(),
  csv: z.string()
}).strict();

const rowParams = z.object({
  id: z.string()
}).strict();

const uploadParams = z.object({
  uploadId: z.string()
}).strict();

const fixBody = z.object({
  manualData: z.record(z.string(), z.any())
}).strict();

export function migRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.post('/api/mig/upload', auth, async (req) => {
    const u = currentUser(req);

    const parsedBody = uploadBody.safeParse(req.body);
    if (!parsedBody.success) {
      throw new AppError('VALIDATION', 'Invalid body.', 422, parsedBody.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    }
    const body = parsedBody.data;

    const { objects: rows, lineNumbers } = parseCSV(body.csv);
    if (rows.length === 0) {
      throw new AppError('EMPTY_CSV', 'The uploaded CSV contains no data rows.', 400);
    }

    const uploadId = newId();
    const now = stamp(clock);

    const seenIdentifiers = new Set<string>();

    const parsedRows = rows.map((r, i) => {
      const parsed = validateRow(r, seenIdentifiers);
      return {
        id: newId(),
        upload_id: uploadId,
        row_number: lineNumbers[i]!,
        raw_json: JSON.stringify(parsed.raw),
        row_type: parsed.rowType,
        status: parsed.status,
        issues_json: JSON.stringify(parsed.issues),
        legacy_id: parsed.legacyId,
        legacy_type: parsed.legacyId ? parsed.rowType : null,
        created_at: now,
      };
    });

    tx(db, () => {
      db.prepare(`INSERT INTO mig_uploads (id, filename, uploaded_at, uploaded_by, status) VALUES (?, ?, ?, ?, 'staged')`)
        .run(uploadId, body.filename, now, u.userId);

      const insert = db.prepare(
        `INSERT INTO mig_rows (id, upload_id, row_number, raw_json, row_type, status, issues_json, legacy_id, legacy_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of parsedRows) {
        insert.run(r.id, r.upload_id, r.row_number, r.raw_json, r.row_type, r.status, r.issues_json, r.legacy_id, r.legacy_type, r.created_at);
      }
    });

    return {
      uploadId,
      totalRows: parsedRows.length,
      needsReview: parsedRows.filter((r) => r.status === 'needs_review').length,
    };
  });

  app.get('/api/mig/uploads', auth, async () => {
    const uploads = db.prepare(
      `SELECT id, filename, uploaded_at, uploaded_by, status FROM mig_uploads ORDER BY uploaded_at DESC`
    ).all() as any[];

    return {
      uploads: uploads.map((u) => ({
        id: u.id,
        filename: u.filename,
        uploadedAt: u.uploaded_at,
        uploadedBy: u.uploaded_by,
        status: u.status,
      }))
    };
  });

  app.get('/api/mig/uploads/:uploadId/review', auth, async (req) => {
    const params = uploadParams.safeParse(req.params);
    if (!params.success) throw new AppError('VALIDATION', 'Invalid param.', 422);

    const rows = db.prepare(
      `SELECT id, row_number, raw_json, row_type, status, issues_json, manual_data_json
       FROM mig_rows WHERE upload_id = ? AND status IN ('needs_review', 'accepted', 'excluded')
       ORDER BY row_number ASC`
    ).all(params.data.uploadId) as any[];

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

  app.post('/api/mig/rows/:id/accept', auth, async (req) => {
    const u = currentUser(req);
    const params = rowParams.safeParse(req.params);
    if (!params.success) throw new AppError('VALIDATION', 'Invalid param.', 422);

    const rowId = params.data.id;
    const now = stamp(clock);

    const res = db.prepare(`UPDATE mig_rows SET status = 'accepted', resolved_by = ?, resolved_at = ? WHERE id = ? AND status IN ('needs_review', 'excluded')`)
      .run(u.userId, now, rowId);
    if (res.changes === 0) throw new AppError('NOT_FOUND', 'Row not found or not in a reviewable state.', 404);
    return { success: true };
  });

  app.post('/api/mig/rows/:id/fix', auth, async (req) => {
    const u = currentUser(req);
    const params = rowParams.safeParse(req.params);
    if (!params.success) throw new AppError('VALIDATION', 'Invalid param.', 422);

    const parsedBody = fixBody.safeParse(req.body);
    if (!parsedBody.success) throw new AppError('VALIDATION', 'Invalid body.', 422);

    const rowId = params.data.id;
    const now = stamp(clock);
    const res = db.prepare(
      `UPDATE mig_rows SET status = 'accepted', manual_data_json = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status IN ('needs_review', 'excluded')`
    ).run(JSON.stringify(parsedBody.data.manualData), u.userId, now, rowId);

    if (res.changes === 0) throw new AppError('NOT_FOUND', 'Row not found or not in a reviewable state.', 404);
    return { success: true };
  });

  app.post('/api/mig/rows/:id/exclude', auth, async (req) => {
    const u = currentUser(req);
    const params = rowParams.safeParse(req.params);
    if (!params.success) throw new AppError('VALIDATION', 'Invalid param.', 422);

    const rowId = params.data.id;
    const now = stamp(clock);
    const res = db.prepare(`UPDATE mig_rows SET status = 'excluded', resolved_by = ?, resolved_at = ? WHERE id = ? AND status IN ('needs_review', 'accepted')`)
      .run(u.userId, now, rowId);
    if (res.changes === 0) throw new AppError('NOT_FOUND', 'Row not found or not in a reviewable state.', 404);
    return { success: true };
  });

  app.post('/api/mig/uploads/:uploadId/dry-run', auth, async (req) => {
    const params = uploadParams.safeParse(req.params);
    if (!params.success) throw new AppError('VALIDATION', 'Invalid param.', 422);
    const uploadId = params.data.uploadId;

    const upload = db.prepare(`SELECT id, status FROM mig_uploads WHERE id = ?`).get(uploadId) as { id: string, status: string } | undefined;
    if (!upload) throw new AppError('NOT_FOUND', 'Upload not found.', 404);

    const rows = db.prepare(
      `SELECT raw_json, row_type, status, manual_data_json FROM mig_rows
       WHERE upload_id = ? AND status IN ('valid', 'accepted')`
    ).all(uploadId) as any[];

    const pending = db.prepare(`SELECT count(*) as c FROM mig_rows WHERE upload_id = ? AND status = 'needs_review'`).get(uploadId) as { c: number };
    if (pending.c > 0) {
      throw new AppError('PENDING_REVIEW', `There are ${pending.c} rows that still need review.`, 400);
    }

    let customers = 0;
    let employees = 0;
    let measurements = 0;
    let measurementCellSum = 0;

    for (const r of rows) {
      if (r.row_type === 'customer') customers++;
      if (r.row_type === 'employee') {
          employees++;
          // Sum up daily rate cents for employees if present in manual data or raw json
          const raw = JSON.parse(r.raw_json);
          const data = r.manual_data_json ? { ...raw, ...JSON.parse(r.manual_data_json) } : raw;
          if (data.daily_rate_cents) measurementCellSum += Number(data.daily_rate_cents);
      }
      if (r.row_type === 'measurement') {
        measurements++;
        const raw = JSON.parse(r.raw_json);
        const data = r.manual_data_json ? { ...raw, ...JSON.parse(r.manual_data_json) } : raw;
        const measurementFields = [
          'shoulder', 'chest', 'upper_waist', 'collar', 'bust_point', 'figure_point',
          'bust_distance', 'arm_hole', 'sleeve_hole', 'sleeve_length', 'upper_length',
          'lower_waist', 'hips', 'crotch', 'thigh', 'calf', 'ankle', 'lower_length'
        ];
        for (const [key, value] of Object.entries(data)) {
           const lowerKey = key.toLowerCase();
           if (measurementFields.includes(lowerKey)) {
             const n = Number(value);
             if (!isNaN(n)) {
               // Values in tenths according to instructions
               measurementCellSum += Math.round(n * 10);
             }
           }
        }
      }
    }

    return {
      success: true,
      counts: { customers, employees, measurements },
      checksums: { measurementCellSum },
      message: `Dry run passed. This would create ${customers} customers, ${employees} employees, and ${measurements} measurements.`
    };
  });
}
