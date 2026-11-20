import { z } from "zod";
import { EXPORT_TABLES, type ExportTable, type SubjectExport } from "./source";

const count = z.number().int().min(0);

const rows = z.array(z.record(z.string(), z.unknown()));

export const subjectExportSchema = z.object({
	request: z.object({
		id: z.string(),
		request_type: z.string(),
		received_at: z.string(),
	}),
	exported_at: z.string(),
	customer: z.object({
		id: z.string(),
		name: z.string().nullable(),
		phone: z.string().nullable(),
		first_seen_at: z.string(),
		last_seen_at: z.string(),
	}),
	invoices: rows,
	memberships: rows,
	loyalty_ledger: rows,
	stamps: rows,
	receipt_claims: rows,
	redemptions: rows,
	consent_records: rows,
	messages: rows,
	counts: z.object({
		invoices: count,
		memberships: count,
		loyalty_ledger: count,
		stamps: count,
		receipt_claims: count,
		redemptions: count,
		consent_records: count,
		messages: count,
	}),
});

export type SubjectExportJson = z.infer<typeof subjectExportSchema>;

export class ExportShapeError extends Error {
	constructor() {
		super("the export does not have the expected shape");
		this.name = "ExportShapeError";
	}
}

/**
 * Checks the JSON of dsr_export and returns it as the file to hand over, with
 * the counts. Every count must equal the length of its array.
 */
export function parseSubjectExport(data: unknown): SubjectExport {
	const parsed = subjectExportSchema.safeParse(data);
	if (!parsed.success) throw new ExportShapeError();
	const json = parsed.data;
	for (const table of EXPORT_TABLES) {
		if (json[table].length !== json.counts[table]) throw new ExportShapeError();
	}
	const counts = Object.fromEntries(
		EXPORT_TABLES.map((table) => [table, json.counts[table]]),
	) as Record<ExportTable, number>;
	return { counts, json: JSON.stringify(data, null, 2) };
}
