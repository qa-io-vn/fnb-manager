import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { Sql } from "postgres";
import { requireTenant } from "../admin/tenants.js";
import {
	type CommandContext,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

export const MAX_CODES_PER_IMPORT = 1000;
export const MAX_IMPORT_BYTES = 1_048_576;
export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
export const REWARD_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const EXPORT_STATES = ["used", "quarantined"] as const;
export const HEADER_WORDS =
	/^(code|codes|voucher|vouchers|coupon|coupons|ma|ma_voucher|mavoucher|serial)$/i;
export const CALLBACK_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

export type ExportState = (typeof EXPORT_STATES)[number];

export interface ParsedCodeFile {
	readonly codes: string[];
	readonly rows: number;
	readonly header: boolean;
	readonly malformed: number;
	readonly duplicates: number;
}

export interface ImportCounts {
	readonly received: number;
	readonly inserted: number;
	readonly malformed: number;
	readonly duplicates: number;
	readonly already_present: number;
	readonly conflicting: number;
}

function firstField(line: string): string {
	const trimmed = line.trim();
	if (trimmed.startsWith('"')) {
		const end = trimmed.indexOf('"', 1);
		return end > 0 ? trimmed.slice(1, end).trim() : trimmed.slice(1).trim();
	}
	return (trimmed.split(/[,;\t]/)[0] ?? "").trim();
}

export function parseCodeCsv(text: string): ParsedCodeFile {
	const lines = text
		.replace(/^﻿/, "")
		.split(/\r\n|\n|\r/)
		.map(firstField);
	const filled = lines.filter((value) => value !== "");
	const first = filled[0] ?? "";
	const header =
		filled.length > 0 &&
		(!CODE_PATTERN.test(first) || HEADER_WORDS.test(first));
	const rows = header ? filled.slice(1) : filled;
	const seen = new Set<string>();
	const codes: string[] = [];
	let malformed = 0;
	let duplicates = 0;
	for (const value of rows) {
		if (!CODE_PATTERN.test(value)) {
			malformed += 1;
			continue;
		}
		const key = value.toUpperCase();
		if (seen.has(key)) {
			duplicates += 1;
			continue;
		}
		seen.add(key);
		codes.push(value);
	}
	return { codes, rows: rows.length, header, malformed, duplicates };
}

export function importLine(file: ParsedCodeFile, counts: ImportCounts): string {
	return [
		`codes import: ${file.rows} row(s) read${file.header ? " after a header" : ""}`,
		`${file.malformed} malformed and ${file.duplicates} duplicate row(s) refused`,
		`${counts.inserted} inserted, ${counts.already_present} already in the pool, ${counts.conflicting} used by another pool or redemption, ${counts.malformed + counts.duplicates} refused by the database`,
	].join("; ");
}

export function isInside(root: string, path: string): boolean {
	const local = relative(resolve(root), resolve(path));
	return local === "" || (!local.startsWith("..") && !isAbsolute(local));
}

function refuseInCi(context: CommandContext, what: string): void {
	if (context.output.ci) {
		throw new UsageError(
			`fnb loyalty ${what} handles live codes; run it on the owner's machine, not in CI`,
		);
	}
}

async function storeOf(
	sql: Sql,
	tenantId: string,
	reference: string,
): Promise<string> {
	const rows = await sql<{ id: string }[]>`
		select s.id::text as id
		from public.stores s
		where s.tenant_id = ${tenantId}::uuid
			and (s.code = ${reference} or s.external_id = ${reference})
		order by (s.code = ${reference}) desc
	`;
	const store = rows[0];
	if (store === undefined) {
		throw new UsageError("no store of the tenant has that code or external id");
	}
	return store.id;
}

function expiry(values: OptionValues, now: Date): Date | null {
	const text = stringOption(values, "expires");
	if (text === undefined) {
		return null;
	}
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime()) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) {
		throw new UsageError(
			"--expires takes an ISO instant with its offset, such as 2026-12-31T23:59:59+07:00",
		);
	}
	if (parsed.getTime() <= now.getTime()) {
		throw new UsageError("--expires lies in the future");
	}
	return parsed;
}

async function codesImport(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	refuseInCi(context, "codes import");
	const slug = requiredString(values, "tenant").trim();
	const storeReference = requiredString(values, "store").trim();
	const reward = requiredString(values, "reward").trim();
	const path = requiredString(values, "file");
	if (!REWARD_KEY_PATTERN.test(reward)) {
		throw new UsageError("--reward is a reward key such as free-drink");
	}
	const expires = expiry(values, context.now());
	let text: string;
	try {
		const bytes = readFileSync(path);
		if (bytes.byteLength > MAX_IMPORT_BYTES) {
			throw new UsageError("the code file is larger than 1 MB");
		}
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		if (error instanceof UsageError) {
			throw error;
		}
		throw new UsageError(
			"the code file cannot be read as UTF-8 text; save the vendor's export as CSV UTF-8",
		);
	}
	const file = parseCodeCsv(text);
	if (file.codes.length > MAX_CODES_PER_IMPORT) {
		throw new UsageError(
			`the file holds ${file.codes.length} codes; one import takes at most ${MAX_CODES_PER_IMPORT}, as one vendor export does`,
		);
	}
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const storeId = await storeOf(sql, tenant.id, storeReference);
	const [row] = await sql<{ counts: ImportCounts }[]>`
		select app.import_coupon_codes(
			${tenant.id}::uuid, ${storeId}::uuid, ${reward}::text, ${file.codes}::text[], ${expires?.toISOString() ?? null}::timestamptz, ${context.now().toISOString()}::timestamptz
		) as counts
	`;
	if (row === undefined) {
		throw new Error("app.import_coupon_codes answered no row");
	}
	const line = importLine(file, row.counts);
	context.output.line(line);
	context.output.summary(`- ${line}`);
	return 0;
}

async function codesStatus(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant").trim();
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const rows = await sql<
		{
			store_id: string;
			store_code: string | null;
			store_external_id: string;
			reward_key: string;
			state: string;
			codes: string;
		}[]
	>`
		select store_id::text as store_id, store_code, store_external_id, reward_key, state::text as state, codes::text as codes
		from app.coupon_code_status(${tenant.id}::uuid)
	`;
	const stores = [...new Set(rows.map((row) => row.store_id))];
	const groups = new Map<string, Map<string, string>>();
	for (const row of rows) {
		const label = context.output.ci
			? `store ${stores.indexOf(row.store_id) + 1}`
			: (row.store_code ?? row.store_external_id);
		const key = `${label} ${row.reward_key}`;
		const states = groups.get(key) ?? new Map<string, string>();
		states.set(row.state, row.codes);
		groups.set(key, states);
	}
	if (groups.size === 0) {
		context.output.line("codes status: no pool code yet");
		return 0;
	}
	for (const [key, states] of groups) {
		const parts = [
			"available",
			"assigned",
			"used",
			"quarantined",
			"expired",
		].map((state) => `${state} ${states.get(state) ?? "0"}`);
		context.output.line(`codes status: ${key}: ${parts.join(", ")}`);
	}
	return 0;
}

function csvCell(value: string | null): string {
	const text = value ?? "";
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function codesExport(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	refuseInCi(context, "codes export");
	const slug = requiredString(values, "tenant").trim();
	const state = requiredString(values, "state").trim();
	if (!(EXPORT_STATES as readonly string[]).includes(state)) {
		throw new UsageError("--state is used or quarantined");
	}
	const out = resolve(requiredString(values, "out"));
	if (isInside(context.rootDir, out)) {
		throw new UsageError(
			"--out names a file outside the repository: the export holds live codes",
		);
	}
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const rows = await sql<
		{
			store_code: string | null;
			store_external_id: string;
			reward_key: string;
			code: string;
			crm_programme_external_id: string | null;
			state_at: Date | null;
			invoice_external_id: string | null;
		}[]
	>`
		select store_code, store_external_id, reward_key, code, crm_programme_external_id, state_at, invoice_external_id
		from app.coupon_codes_in_state(${tenant.id}::uuid, ${state}::public.coupon_code_state)
	`;
	const lines = [
		"store,reward,code,crm_programme,state,state_at,invoice",
		...rows.map((row) =>
			[
				csvCell(row.store_code ?? row.store_external_id),
				csvCell(row.reward_key),
				csvCell(row.code),
				csvCell(row.crm_programme_external_id),
				state,
				row.state_at ? new Date(row.state_at).toISOString() : "",
				csvCell(row.invoice_external_id),
			].join(","),
		),
	];
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `﻿${lines.join("\r\n")}\r\n`, { mode: 0o600 });
	const line = `codes export: ${rows.length} ${state} code(s) written`;
	context.output.line(line);
	context.output.summary(`- ${line}`);
	return 0;
}

async function callbackPathIssue(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	if (context.output.ci) {
		throw new UsageError(
			"fnb loyalty callback-path issue prints a secret once; run it on the owner's machine, not in CI",
		);
	}
	const slug = requiredString(values, "tenant").trim();
	const label = (stringOption(values, "label") ?? "pos-crm").trim();
	if (!CALLBACK_LABEL_PATTERN.test(label)) {
		throw new UsageError("--label is a short key such as pos-crm");
	}
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, false);
	const [row] = await sql<{ segment: string }[]>`
		select app.issue_voucher_callback_path(${tenant.id}::uuid, ${label}::text) as segment
	`;
	if (row === undefined) {
		throw new Error("app.issue_voucher_callback_path answered no row");
	}
	context.output.raw(
		`callback path for ${label} (shown once; the database keeps only its hash, and a new one replaces it):`,
	);
	context.output.raw(
		`<SUPABASE_URL>/functions/v1/voucher-callback/${row.segment}`,
	);
	return 0;
}

async function callbackPathRevoke(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant").trim();
	const label = requiredString(values, "label").trim();
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const [row] = await sql<{ revoked: number }[]>`
		select app.revoke_voucher_callback_path(${tenant.id}::uuid, ${label}::text) as revoked
	`;
	context.output.line(`callback path: ${row?.revoked ?? 0} revoked`);
	return 0;
}

export const loyaltyCodeCommands: readonly CommandSpec[] = [
	{
		path: ["loyalty", "codes", "import"],
		summary:
			"Import one vendor export of single-use codes into a reward's pool at a store (counts only)",
		usage:
			"fnb loyalty codes import --tenant <slug> --store <code> --reward <key> --file <codes.csv> [--expires <ISO instant>]",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			store: { type: "string" },
			reward: { type: "string" },
			file: { type: "string" },
			expires: { type: "string" },
		},
		details: [
			"The file is the CRM export saved as CSV UTF-8: one code per row in the first column, an optional header row, at most 1,000 codes (one export run). A code is 3 to 64 letters, digits, dashes or underscores.",
			"Malformed and duplicate rows are counted and refused; codes already in the pool are skipped, so importing the same export twice changes nothing. The reward needs its coupon_rail_rewards mapping at the store first; --store takes the store's code or external id.",
			"Prints counts only, never a code. Refused with CI set: the file holds live codes.",
		],
		run: codesImport,
	},
	{
		path: ["loyalty", "codes", "status"],
		summary: "Count the pool codes per store, reward and state",
		usage: "fnb loyalty codes status --tenant <slug>",
		options: { ...HELP_OPTION, tenant: { type: "string" } },
		details: [
			"States: available, assigned (held for a redemption), used (on a synced invoice), quarantined (a hold expired unused), expired. With CI set, stores are numbered.",
		],
		run: codesStatus,
	},
	{
		path: ["loyalty", "codes", "export"],
		summary:
			"Write the used or quarantined pool codes to a CSV outside the repository, for reconciliation with the vendor",
		usage:
			"fnb loyalty codes export --tenant <slug> --state used|quarantined --out <path outside the repository>",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			state: { type: "string" },
			out: { type: "string" },
		},
		details: [
			"Columns: store, reward, code, crm_programme, state, state_at, invoice (the external id of the invoice that used the code). The file is created readable by its owner only.",
			"Prints the count only. Refused with CI set and for a path inside the repository.",
		],
		run: codesExport,
	},
	{
		path: ["loyalty", "callback-path", "issue"],
		summary:
			"Draw the secret path of the tenant's voucher callback URL and print it once",
		usage: "fnb loyalty callback-path issue --tenant <slug> [--label <key>]",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			label: { type: "string" },
		},
		details: [
			"The URL goes into the POS CRM programme's callback setting. The database keeps only the SHA-256 of the path; issuing again under the same label (default pos-crm) revokes the previous path.",
			"Refused with CI set.",
		],
		run: callbackPathIssue,
	},
	{
		path: ["loyalty", "callback-path", "revoke"],
		summary: "Revoke the tenant's voucher callback path of a label",
		usage: "fnb loyalty callback-path revoke --tenant <slug> --label <key>",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			label: { type: "string" },
		},
		details: [
			"The callback then answers 404 to that path without a database write.",
		],
		run: callbackPathRevoke,
	},
];
