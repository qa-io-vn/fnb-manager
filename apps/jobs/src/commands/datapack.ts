import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	aggregatesOnlyIssues,
	type BuiltPack,
	buildDataPack,
	chatBundle,
	comparePackTexts,
	DataPackError,
	DEFAULT_HORIZON,
	HORIZONS,
	type Horizon,
	MAX_PACK_STORES,
	PACK_LANGUAGES,
	type PackErrorCode,
	type PackLanguage,
	parsePack,
	TOKEN_LIMIT,
} from "@fnb/datapack";
import { findMemberByEmail, unlimitedOwner } from "@fnb/notify/postgres";
import { isValidIsoDate, type ReportSource } from "@fnb/reports";
import type { TransactionSql } from "postgres";
import { requireTenant } from "../admin/tenants.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	stringList,
	stringOption,
	UsageError,
} from "../context.js";
import {
	assertPrivateOutput,
	defaultPackPath,
	PACK_ID_PREFIX_LENGTH,
	PathRefusedError,
	packScopeName,
	resolveUserPath,
	shownPath,
} from "../datapack/files.js";
import { withReportSnapshot } from "../datapack/snapshot.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import { EMAIL_PATTERN, SLUG_PATTERN } from "./tenant.js";

export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_PACK_INVALID = 4;

export const DATA_ROLES = ["owner", "manager", "staff", "viewer"] as const;
export const DEFAULT_LANGUAGE: PackLanguage = "vi";

const STORE_LABEL = /^[Ss]([1-9][0-9]?)$/;
const STORE_UUID =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const BYTE_ORDER_MARK = "﻿";
const PROFILE_CHUNK = 50;

const BUILD_OPTIONS = [
	"store",
	"as-of",
	"horizon",
	"language",
	"focus",
	"note-file",
	"out",
	"bundle",
] as const;

const USAGE_ERRORS: ReadonlySet<PackErrorCode> = new Set([
	"pack_stores_invalid",
	"pack_as_of_not_complete",
	"pack_text_contact_details",
	"pack_text_too_long",
]);
const INVALID_PACK_ERRORS: ReadonlySet<PackErrorCode> = new Set([
	"pack_invalid",
	"pack_over_budget",
	"pack_not_aggregate",
]);

export interface BuildOptions {
	readonly kind: "build";
	readonly tenant: string;
	readonly stores: readonly string[];
	readonly member: string | null;
	readonly asOf: string | null;
	readonly horizon: Horizon;
	readonly language: PackLanguage;
	readonly focus: string | null;
	readonly noteFile: string | null;
	readonly out: string | null;
	readonly bundle: string | null;
	readonly json: boolean;
}

export interface CheckOptions {
	readonly kind: "check";
	readonly file: string;
	readonly against: string | null;
	readonly json: boolean;
}

export interface ListOptions {
	readonly kind: "list";
	readonly tenant: string;
	readonly member: string | null;
	readonly json: boolean;
}

export type DatapackOptions = BuildOptions | CheckOptions | ListOptions;

export interface PackMember {
	readonly userId: string;
	readonly role: string;
	readonly email: string | null;
}

export interface VisibleStore {
	readonly id: string;
	readonly label: string;
	readonly name: string;
	readonly active: boolean;
}

export interface DatapackSnapshot {
	readonly source: ReportSource;
	stores(): Promise<VisibleStore[]>;
}

export interface DatapackBackend {
	tenant(context: CommandContext, slug: string): Promise<{ id: string }>;
	member(
		context: CommandContext,
		tenantId: string,
		email: string | null,
	): Promise<PackMember>;
	snapshot<T>(
		context: CommandContext,
		tenantId: string,
		member: PackMember,
		run: (snapshot: DatapackSnapshot) => Promise<T>,
	): Promise<T>;
}

class CommandExit extends Error {
	readonly code: number;

	constructor(code: number) {
		super(`exit ${code}`);
		this.name = "CommandExit";
		this.code = code;
	}
}

function given(values: OptionValues, name: string): boolean {
	const value = values[name];
	return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

function refuseWith(
	values: OptionValues,
	names: readonly string[],
	mode: string,
): void {
	const extra = names.find((name) => given(values, name));
	if (extra !== undefined) {
		throw new UsageError(`--${extra} does not go with ${mode}`);
	}
}

function tenantOption(values: OptionValues): string {
	const tenant = stringOption(values, "tenant")?.trim() ?? "";
	if (tenant === "") throw new UsageError("--tenant is required");
	if (!SLUG_PATTERN.test(tenant)) {
		throw new UsageError(
			"--tenant must be 2–63 lower-case letters, digits or hyphens",
		);
	}
	return tenant;
}

function memberOption(values: OptionValues): string | null {
	const member = stringOption(values, "member")?.trim();
	if (member === undefined) return null;
	if (!EMAIL_PATTERN.test(member)) {
		throw new UsageError("--member must be a login e-mail address");
	}
	return member;
}

function storeOptions(values: OptionValues): string[] {
	const stores = stringList(values, "store").map((raw) => {
		const value = raw.trim();
		const label = STORE_LABEL.exec(value);
		if (label !== null) return `S${label[1]}`;
		if (STORE_UUID.test(value)) return value.toLowerCase();
		throw new UsageError(
			"--store takes a store label such as S1 or a store id",
		);
	});
	if (new Set(stores).size !== stores.length) {
		throw new UsageError("--store names the same store twice");
	}
	if (stores.length > MAX_PACK_STORES) {
		throw new UsageError(`a pack covers at most ${MAX_PACK_STORES} stores`);
	}
	return stores;
}

function choice<T extends string>(
	values: OptionValues,
	name: string,
	allowed: readonly T[],
	fallback: T,
): T {
	const value = stringOption(values, name);
	if (value === undefined) return fallback;
	if (!(allowed as readonly string[]).includes(value)) {
		throw new UsageError(`--${name} must be one of ${allowed.join(", ")}`);
	}
	return value as T;
}

function pathOption(values: OptionValues, name: string): string | null {
	const value = stringOption(values, name);
	if (value === undefined) return null;
	if (value.trim() === "") throw new UsageError(`--${name} needs a file`);
	return value;
}

export function datapackOptions(
	values: OptionValues,
	ci: boolean,
): DatapackOptions {
	const json = flag(values, "json");
	const check = pathOption(values, "check");
	if (check !== null) {
		refuseWith(
			values,
			["tenant", "member", "list-stores", ...BUILD_OPTIONS],
			"--check",
		);
		return {
			kind: "check",
			file: check,
			against: pathOption(values, "against"),
			json,
		};
	}
	if (given(values, "against")) {
		throw new UsageError("--against needs --check <file>");
	}
	if (flag(values, "list-stores")) {
		if (ci) {
			throw new UsageError(
				"--list-stores is refused in CI: it prints store names and ids",
			);
		}
		refuseWith(values, BUILD_OPTIONS, "--list-stores");
		return {
			kind: "list",
			tenant: tenantOption(values),
			member: memberOption(values),
			json,
		};
	}
	const asOf = stringOption(values, "as-of") ?? null;
	if (asOf !== null && (!ISO_DATE.test(asOf) || !isValidIsoDate(asOf))) {
		throw new UsageError("--as-of must be a date written YYYY-MM-DD");
	}
	const focus = stringOption(values, "focus")?.trim() ?? "";
	return {
		kind: "build",
		tenant: tenantOption(values),
		stores: storeOptions(values),
		member: memberOption(values),
		asOf,
		horizon: choice(values, "horizon", HORIZONS, DEFAULT_HORIZON),
		language: choice(values, "language", PACK_LANGUAGES, DEFAULT_LANGUAGE),
		focus: focus === "" ? null : focus,
		noteFile: pathOption(values, "note-file"),
		out: pathOption(values, "out"),
		bundle: pathOption(values, "bundle"),
		json,
	};
}

function shown(context: CommandContext, path: string): string {
	return shownPath(path, context.rootDir, context.output.ci);
}

function privateOutput(
	context: CommandContext,
	option: string,
	path: string,
): string {
	try {
		return assertPrivateOutput(path, context.rootDir);
	} catch (error) {
		if (error instanceof PathRefusedError) {
			context.output.error(
				`${option} refused: ${shown(context, error.path)} ${error.reason}`,
			);
			throw new CommandExit(EXIT_USAGE);
		}
		throw error;
	}
}

function readUserFile(
	context: CommandContext,
	option: string,
	path: string,
): string {
	const absolute = resolveUserPath(path, context.env);
	let text: string;
	try {
		text = readFileSync(absolute, "utf8");
	} catch {
		context.output.error(`${option}: cannot read ${shown(context, absolute)}`);
		throw new CommandExit(EXIT_USAGE);
	}
	return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
}

function writePrivate(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
}

function packIdShown(
	context: CommandContext,
	packId: string | null,
): string | null {
	if (packId === null) return null;
	return context.output.ci ? packId.slice(0, PACK_ID_PREFIX_LENGTH) : packId;
}

function printResult(
	context: CommandContext,
	json: boolean,
	result: Readonly<Record<string, unknown>>,
): void {
	if (json) {
		context.output.line(JSON.stringify(result));
		return;
	}
	for (const [key, value] of Object.entries(result)) {
		const text = Array.isArray(value)
			? value.length === 0
				? "none"
				: value.join(", ")
			: value === null
				? "–"
				: String(value);
		context.output.line(`${key}: ${text}`);
	}
}

function labelNumber(label: string): number {
	return Number(label.slice(1));
}

export function chosenStoreIds(
	stores: readonly VisibleStore[],
	wanted: readonly string[],
): string[] {
	if (wanted.length === 0) {
		const active = stores.filter((store) => store.active);
		if (active.length === 0) {
			throw new DataPackError(
				"pack_stores_invalid",
				"the member sees no active store of the tenant",
			);
		}
		return active.map((store) => store.id);
	}
	return wanted.map((value) => {
		if (!STORE_LABEL.test(value)) return value;
		const store = stores.find((entry) => entry.label === value);
		if (store === undefined) {
			throw new DataPackError(
				"pack_stores_invalid",
				`no store the member can see has the label ${value}`,
			);
		}
		return store.id;
	});
}

async function checkFiles(
	context: CommandContext,
	options: CheckOptions,
): Promise<number> {
	const left = readUserFile(context, "--check", options.file);
	if (options.against !== null) {
		const right = readUserFile(context, "--against", options.against);
		const comparison = await comparePackTexts(left, right);
		printResult(context, options.json, {
			valid: comparison.valid,
			identical_apart_from_generated_at:
				comparison.identical_apart_from_generated_at,
			pack_id_equal: comparison.pack_id_equal,
			tables_differing: comparison.tables_differing,
		});
		if (!comparison.valid) return EXIT_PACK_INVALID;
		return comparison.identical_apart_from_generated_at ? 0 : EXIT_FAILED;
	}
	const parsed = await parsePack(left);
	const pack = parsed.pack;
	printResult(context, options.json, {
		valid: parsed.valid,
		aggregates_only: pack !== null && aggregatesOnlyIssues(pack).length === 0,
		pack_id: packIdShown(context, parsed.packId),
		sample: pack?.sample ?? null,
		as_of: pack?.request.as_of ?? null,
		stores: pack?.request.stores.length ?? null,
		estimated_tokens: pack?.budget.estimated_tokens ?? null,
		limit: TOKEN_LIMIT,
		trimmed: pack?.budget.trimmed ?? [],
		issues: parsed.issues.length,
	});
	if (!options.json) {
		for (const issue of parsed.issues) {
			const detail =
				context.output.ci || issue.detail === null ? "" : ` (${issue.detail})`;
			context.output.line(
				`issue: ${issue.code} at ${issue.path ?? "the pack"}${detail}`,
			);
		}
	}
	return parsed.valid ? 0 : EXIT_PACK_INVALID;
}

async function listStores(
	context: CommandContext,
	options: ListOptions,
	backend: DatapackBackend,
): Promise<number> {
	const tenant = await backend.tenant(context, options.tenant);
	const member = await backend.member(context, tenant.id, options.member);
	const stores = await backend.snapshot(
		context,
		tenant.id,
		member,
		(snapshot) => snapshot.stores(),
	);
	if (options.json) {
		context.output.line(JSON.stringify(stores));
		return 0;
	}
	if (stores.length === 0) {
		context.output.line("the member sees no store of the tenant");
		return 0;
	}
	context.output.table(
		["label", "id", "active", "name"],
		stores.map((store) => [
			store.label,
			store.id,
			store.active ? "yes" : "no",
			store.name,
		]),
	);
	return 0;
}

function memberText(context: CommandContext, member: PackMember): string {
	if (context.output.ci) return member.role;
	return member.email === null
		? `the first owner with every store (${member.role})`
		: `${member.email} (${member.role})`;
}

async function buildPack(
	context: CommandContext,
	options: BuildOptions,
	backend: DatapackBackend,
): Promise<number> {
	const outFile =
		options.out === null
			? null
			: privateOutput(
					context,
					"--out",
					resolveUserPath(options.out, context.env),
				);
	const bundleFile =
		options.bundle === null
			? null
			: privateOutput(
					context,
					"--bundle",
					resolveUserPath(options.bundle, context.env),
				);
	if (outFile !== null && outFile === bundleFile) {
		throw new UsageError("--out and --bundle must name different files");
	}
	const ownerNote =
		options.noteFile === null
			? null
			: readUserFile(context, "--note-file", options.noteFile);
	const tenant = await backend.tenant(context, options.tenant);
	const member = await backend.member(context, tenant.id, options.member);
	const built: BuiltPack = await backend.snapshot(
		context,
		tenant.id,
		member,
		async (snapshot) =>
			buildDataPack(
				{
					storeIds: chosenStoreIds(await snapshot.stores(), options.stores),
					asOf: options.asOf,
					horizon: options.horizon,
					language: options.language,
					focus: options.focus,
					ownerNote,
					sample: false,
				},
				{ source: snapshot.source, clock: { now: context.now }, fence: null },
			),
	);
	const { pack } = built;
	const packFile =
		outFile ??
		privateOutput(
			context,
			"--out",
			defaultPackPath(
				context.rootDir,
				pack.request.as_of,
				packScopeName(
					options.stores.length === 0
						? null
						: pack.request.stores.map((store) => store.label),
				),
				built.packId,
			),
		);
	writePrivate(packFile, built.text);
	if (bundleFile !== null) writePrivate(bundleFile, chatBundle(pack));
	const written = await parsePack(readFileSync(packFile, "utf8"));
	const aggregatesOnly =
		written.pack !== null && aggregatesOnlyIssues(written.pack).length === 0;
	if (!options.json) {
		context.output.line(
			`datapack: pack written to ${shown(context, packFile)}`,
		);
		if (bundleFile !== null) {
			context.output.line(
				`datapack: chat bundle written to ${shown(context, bundleFile)}`,
			);
		}
	}
	printResult(context, options.json, {
		valid: written.valid,
		aggregates_only: aggregatesOnly,
		pack_id: packIdShown(context, written.packId),
		as_of: pack.request.as_of,
		horizon: pack.request.horizon,
		language: pack.request.language,
		stores: pack.request.stores.map((store) => store.label),
		member: memberText(context, member),
		estimated_tokens: pack.budget.estimated_tokens,
		limit: pack.budget.limit,
		trimmed: pack.budget.trimmed,
		...(options.json
			? {
					out: shown(context, packFile),
					bundle: bundleFile === null ? null : shown(context, bundleFile),
				}
			: {}),
	});
	return written.valid && aggregatesOnly ? 0 : EXIT_PACK_INVALID;
}

function exitOf(code: PackErrorCode): number {
	if (USAGE_ERRORS.has(code)) return EXIT_USAGE;
	if (INVALID_PACK_ERRORS.has(code)) return EXIT_PACK_INVALID;
	return EXIT_FAILED;
}

async function visibleStores(
	transaction: TransactionSql,
	source: ReportSource,
	tenantId: string,
): Promise<VisibleStore[]> {
	const rows = await transaction<
		{ id: string; name: string; active: boolean }[]
	>`
		select id::text as id, name, active
		from public.stores
		where tenant_id = ${tenantId}::uuid
		order by id
	`;
	const labels = new Map<string, string>();
	for (let start = 0; start < rows.length; start += PROFILE_CHUNK) {
		const ids = rows.slice(start, start + PROFILE_CHUNK).map((row) => row.id);
		for (const profile of await source.callTheme("store_profiles", {
			store_ids: ids,
		})) {
			labels.set(profile.store_id, profile.label);
		}
	}
	return rows
		.flatMap((row) => {
			const label = labels.get(row.id);
			return label === undefined
				? []
				: [{ id: row.id, label, name: row.name, active: row.active }];
		})
		.sort((left, right) => labelNumber(left.label) - labelNumber(right.label));
}

export const postgresDatapackBackend: DatapackBackend = {
	async tenant(context, slug) {
		const { sql } = context.services.db();
		return requireTenant(sql, slug, context.output.ci);
	},
	async member(context, tenantId, email) {
		const { sql } = context.services.db();
		if (email === null) {
			const owner = await unlimitedOwner(sql, tenantId);
			if (owner === null) {
				throw new Error(
					"the tenant has no owner with every store; pass --member <login e-mail>",
				);
			}
			return { userId: owner.userId, role: "owner", email: null };
		}
		const member = await findMemberByEmail(sql, tenantId, email);
		if (member === null) {
			throw new Error(
				"no member of the tenant has that login e-mail; add them with fnb tenant add-member",
			);
		}
		if (!(DATA_ROLES as readonly string[]).includes(member.role)) {
			throw new Error(
				`a ${member.role} login reads no figures, so it cannot build a pack; use an owner, manager, staff or viewer login`,
			);
		}
		return { userId: member.userId, role: member.role, email };
	},
	snapshot(context, tenantId, member, run) {
		const { sql } = context.services.db();
		return withReportSnapshot(sql, member.userId, (source, transaction) =>
			run({
				source,
				stores: () => visibleStores(transaction, source, tenantId),
			}),
		);
	},
};

export async function runDatapack(
	context: CommandContext,
	values: OptionValues,
	backend: DatapackBackend = postgresDatapackBackend,
): Promise<number> {
	const options = datapackOptions(values, context.output.ci);
	try {
		switch (options.kind) {
			case "check":
				return await checkFiles(context, options);
			case "list":
				return await listStores(context, options, backend);
			case "build":
				return await buildPack(context, options, backend);
		}
	} catch (error) {
		if (error instanceof CommandExit) return error.code;
		if (error instanceof DataPackError) {
			context.output.error(`datapack: ${error.message}`);
			return exitOf(error.code);
		}
		throw error;
	}
}

export const datapackCommand: CommandSpec = {
	path: ["datapack"],
	summary:
		"Build the AI data pack as a member, or check and compare pack files, written only to private folders",
	usage:
		"fnb datapack --tenant <slug> [--store <S1|id>]... [--member <login e-mail>] [--as-of YYYY-MM-DD] [--horizon 30d|90d|180d|12m] [--language vi|en] [--focus <text>] [--note-file <path>] [--out <file>] [--bundle <file>] [--json] | fnb datapack --check <file> [--against <file>] [--json] | fnb datapack --tenant <slug> --list-stores [--member <login e-mail>]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		store: { type: "string", multiple: true },
		member: { type: "string" },
		"as-of": { type: "string" },
		horizon: { type: "string" },
		language: { type: "string" },
		focus: { type: "string" },
		"note-file": { type: "string" },
		out: { type: "string" },
		bundle: { type: "string" },
		json: { type: "boolean" },
		check: { type: "string" },
		against: { type: "string" },
		"list-stores": { type: "boolean" },
	},
	details: [
		"Needs DATABASE_URL (SUPABASE_DB_URL first in CI) to build or list; --check reads only files and opens no connection.",
		"Builds with the same code as the browser's \"Tải gói dữ liệu cho AI\", inside one read-only repeatable-read transaction as role authenticated with the member's claims, never as the service role, so the pack equals the browser's apart from generated_at.",
		"The member is --member (a login of the tenant holding owner, manager, staff or viewer; a publisher is refused), else the tenant's first owner with every store. Without --store the pack covers every active store the member sees; --store takes a label (S1) or a store id, up to 10.",
		"--as-of defaults to the last complete business day, --horizon to 90d, --language to vi. --note-file holds the owner note (at most 1,000 characters).",
		"Files are written only outside the repository or below docs/private/ where git ignores them (symbolic links followed); anything else is refused with exit 2. Relative paths start from the folder where the command was typed (INIT_CWD under pnpm). The default is docs/private/strategy/packs/<as_of>_<tat-ca|s1…>_<8 hex>.json under the repository root; --bundle also writes the prompt and the pack for a chat.",
		"--check prints valid, aggregates_only and the estimate of a pack file; with --against it prints valid, identical_apart_from_generated_at, pack_id_equal and tables_differing.",
		"In CI (CI or GITHUB_ACTIONS set) the output names no tenant, store name, member, e-mail, path or amount: base names only, pack ids as 8-character prefixes, and --list-stores is refused.",
		"Exit codes: 0 success; 1 failure, or --check --against found two valid packs that differ; 2 usage, a refused path or a refused request; 4 the pack is invalid or over budget.",
	],
	run: (context, values) => runDatapack(context, values),
};
