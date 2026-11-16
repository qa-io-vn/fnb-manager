import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	constants,
	cpSync,
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { MENU } from "@fnb/connector-mock";
import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	addDays,
	addMonths,
	argumentNames,
	type DateRange,
	firstOfMonth,
	type IsoDate,
	minDate,
} from "@fnb/reports";
import { adjustmentEvents, mapSale, mapShift } from "@fnb/sync";
import type postgres from "postgres";
import {
	createDemoAnalyticsSource,
	DEMO_POS_ACCOUNT_ID,
	DEMO_SEED,
	DEMO_TENANT_PROFILE,
	type DemoAnalyticsSource,
	DemoDayCache,
	type DemoStoreDefinition,
	type DemoStoreId,
	demoPromotionCatalogue,
	demoRoles,
	demoStoreProfiles,
	minorUnits,
} from "../../src/index.js";
import {
	type ParityClock,
	type ParityDataset,
	providedText,
} from "./datasets.js";

export const repositoryRoot = join(import.meta.dirname, "..", "..", "..", "..");
export const migrationsRoot = join(repositoryRoot, "supabase", "migrations");

export const PGLITE_STUB = [
	"create role anon nologin;",
	"create role authenticated nologin;",
	"create role service_role nologin bypassrls;",
	"create schema auth;",
	"create schema extensions;",
	"create table auth.users (id uuid primary key);",
	"create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
	"create schema app;",
].join("\n");

const EXTENSION_SCHEMAS: Readonly<Record<string, string>> = {
	pg_cron: "cron",
	pg_net: "net",
};

export const REAL_TENANT_REFUSAL =
	"refusing to run parity against a database that holds real tenants";
export const REAL_TENANT_COUNT_SQL =
	"select count(*)::integer as real_tenants from public.tenants where slug not like 'demo-%' and slug not like 'parity-%'";

const REFRESH_CHUNK_DAYS = 92;
const INSERT_CHUNK_ROWS = 500;

export type ParityMode = "pglite" | "postgres";

export function parityMode(): ParityMode {
	return process.env.PARITY_DATABASE === "postgres" ? "postgres" : "pglite";
}

export function migrationFiles(): string[] {
	return readdirSync(migrationsRoot)
		.filter((name) => name.endsWith(".sql"))
		.sort();
}

export function pgliteMigrationSql(source: string): string {
	return source
		.replaceAll("compression lz4", "")
		.replace(
			/create extension if not exists (\w+)[^;]*;/gi,
			(statement, name: string) => {
				const schema = EXTENSION_SCHEMAS[name];
				return schema === undefined
					? statement
					: `create schema if not exists ${schema};`;
			},
		);
}

export type SqlRow = Record<string, unknown>;

export interface SqlConnection {
	readonly mode: ParityMode;
	rows(text: string, params?: readonly unknown[]): Promise<SqlRow[]>;
	exec(text: string): Promise<void>;
	close(): Promise<void>;
}

const rawText = (value: string) => value;

async function pgliteConnection(dataDir?: string): Promise<SqlConnection> {
	const { PGlite } = await import("@electric-sql/pglite");
	const migrated =
		dataDir !== undefined && existsSync(join(dataDir, "PG_VERSION"));
	const db: PGlite = await PGlite.create({
		parsers: { 1082: rawText, 1114: rawText, 1184: rawText },
		...(dataDir === undefined ? {} : { dataDir }),
	});
	if (!migrated) {
		await db.exec(PGLITE_STUB);
		for (const name of migrationFiles()) {
			await db.exec(
				pgliteMigrationSql(readFileSync(join(migrationsRoot, name), "utf8")),
			);
		}
	}
	return {
		mode: "pglite",
		async rows(text, params = []) {
			const result = await db.query<SqlRow>(text, [...params]);
			return result.rows;
		},
		async exec(text) {
			await db.exec(text);
		},
		async close() {
			await db.close();
			if (dataDir !== undefined) {
				rmSync(dataDir, { recursive: true, force: true });
			}
		},
	};
}

async function postgresConnection(url: string): Promise<SqlConnection> {
	const { default: connect } = await import("postgres");
	const sql: postgres.Sql = connect(url, {
		max: 1,
		onnotice: () => {},
		connection: { application_name: "fnb-parity", jit: "off" },
		types: {
			rawDates: {
				to: 1082,
				from: [1082, 1114, 1184],
				serialize: rawText,
				parse: rawText,
			},
		},
	});
	return {
		mode: "postgres",
		async rows(text, params = []) {
			return (await sql.unsafe(
				text,
				params as postgres.ParameterOrJSON<never>[],
			)) as unknown as SqlRow[];
		},
		async exec(text) {
			await sql.unsafe(text).simple();
		},
		async close() {
			await sql.end({ timeout: 5 });
		},
	};
}

export async function assertNoRealTenants(
	connection: SqlConnection,
): Promise<void> {
	const [row] = await connection.rows(REAL_TENANT_COUNT_SQL);
	if (Number(row?.real_tenants ?? 0) !== 0) {
		throw new Error(REAL_TENANT_REFUSAL);
	}
}

export async function openConnection(
	mode: ParityMode = parityMode(),
): Promise<SqlConnection> {
	if (mode === "pglite") return pgliteConnection();
	const url = process.env.DATABASE_URL;
	if (url === undefined || url === "") {
		throw new Error("PARITY_DATABASE=postgres needs DATABASE_URL");
	}
	const connection = await postgresConnection(url);
	try {
		await assertNoRealTenants(connection);
	} catch (error) {
		await connection.close();
		throw error;
	}
	return connection;
}

export function literal(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new RangeError(`cannot write ${value}`);
		return String(value);
	}
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "object") {
		return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
	}
	return `'${String(value).replaceAll("'", "''")}'`;
}

export function insertStatements(
	table: string,
	columns: readonly string[],
	rows: readonly Readonly<Record<string, unknown>>[],
): string[] {
	const statements: string[] = [];
	for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
		const values = rows
			.slice(start, start + INSERT_CHUNK_ROWS)
			.map(
				(row) =>
					`(${columns.map((column) => literal(row[column])).join(", ")})`,
			);
		statements.push(
			`insert into ${table} (${columns.join(", ")}) values ${values.join(",\n")};`,
		);
	}
	return statements;
}

export function pgArray(values: readonly string[]): string {
	return `{${values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
}

const ARGUMENT_TYPES: Readonly<Record<string, string>> = {
	store_ids: "uuid[]",
	grain: "text",
	anchor: "date",
	from_date: "date",
	to_date: "date",
	compare_from: "date",
	compare_to: "date",
	metric_ids: "text[]",
	target_date: "date",
	weeks: "integer",
	as_of_date: "date",
	as_of: "date",
	month_start: "date",
	days: "integer",
	abs_threshold: "numeric",
	rel_threshold: "numeric",
	period_kind: "public.period_kind",
	period_start: "date",
	include_stores: "boolean",
};

export interface SeededStore {
	readonly definition: DemoStoreDefinition;
	readonly uuid: string;
}

export interface SeededDataset {
	readonly dataset: ParityDataset;
	readonly tenantId: string;
	readonly slug: string;
	readonly posAccountId: string;
	readonly window: DateRange;
	readonly stores: Readonly<Record<DemoStoreId, SeededStore>>;
	readonly days: DemoDayCache;
	readonly engine: DemoAnalyticsSource;
	readonly counts: SeededCounts;
	uuidOf(storeId: DemoStoreId): string;
	demoIdOf(uuid: string): DemoStoreId | undefined;
}

export interface SeededCounts {
	invoices: number;
	lines: number;
	shifts: number;
	events: number;
	checks: number;
}

interface SeededRecord {
	readonly dataset: ParityDataset;
	readonly tenantId: string;
	readonly slug: string;
	readonly posAccountId: string;
	readonly window: DateRange;
	readonly storeUuids: Readonly<Record<DemoStoreId, string>>;
	readonly counts: SeededCounts;
}

export interface ParityContext {
	readonly mode: ParityMode;
	readonly clock: ParityClock;
	readonly datasets: readonly SeededDataset[];
	readonly connection: SqlConnection;
	call<N extends AnalyticsFunctionName>(
		seeded: SeededDataset,
		name: N,
		args: AnalyticsArgs<N>,
	): Promise<SqlRow[]>;
	scalar(text: string, params?: readonly unknown[]): Promise<unknown>;
}

function syntheticToken(): string {
	return randomBytes(4).toString("hex");
}

function storeUuid(token: string, index: number): string {
	return `${token}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function cashByShift(
	sales: readonly {
		status: string;
		shiftExternalId?: string | undefined;
		payments: readonly { methodExternalId: string; amount: number }[];
	}[],
): Map<string, number> {
	const cashMethods = new Set(
		MENU.catalog.paymentMethods
			.filter((method) => method.kind === "cash")
			.map((method) => method.externalId),
	);
	const minor = new Map<string, number>();
	for (const sale of sales) {
		if (sale.status === "voided" || sale.shiftExternalId === undefined)
			continue;
		for (const payment of sale.payments) {
			if (!cashMethods.has(payment.methodExternalId)) continue;
			minor.set(
				sale.shiftExternalId,
				(minor.get(sale.shiftExternalId) ?? 0) + minorUnits(payment.amount),
			);
		}
	}
	return new Map(
		[...minor.entries()].map(([shift, cents]) => [shift, cents / 100]),
	);
}

const INVOICE_COLUMNS = [
	"id",
	"tenant_id",
	"store_id",
	"pos_account_id",
	"external_id",
	"receipt_no",
	"sold_at",
	"business_date",
	"opened_at",
	"closed_at",
	"table_name",
	"area_name",
	"sale_type",
	"source_external_id",
	"source_name",
	"employee_external_id",
	"employee_name",
	"shift_external_id",
	"device_code",
	"guest_count",
	"customer_phone",
	"customer_name",
	"gross_amount",
	"item_discount_amount",
	"bill_discount_amount",
	"extra_discount_amount",
	"bill_discount_name",
	"voucher_code",
	"voucher_name",
	"voucher_amount",
	"partner_marketing_amount",
	"service_charge_amount",
	"shipping_fee_amount",
	"vat_amount",
	"net_amount",
	"paid_amount",
	"primary_payment_method_external_id",
	"primary_payment_method_name",
	"status",
];

const LINE_COLUMNS = [
	"tenant_id",
	"store_id",
	"invoice_id",
	"external_id",
	"parent_line_external_id",
	"line_kind",
	"item_external_id",
	"item_name",
	"base_name",
	"size_label",
	"item_type_external_id",
	"item_type_name",
	"item_class_external_id",
	"item_class_name",
	"unit_external_id",
	"unit_name",
	"package_external_id",
	"quantity",
	"list_unit_price",
	"unit_price",
	"gross_amount",
	"discount_amount",
	"net_amount",
	"promotion_external_id",
	"promotion_name",
	"note",
];

const PAYMENT_COLUMNS = [
	"tenant_id",
	"store_id",
	"invoice_id",
	"sequence_no",
	"business_date",
	"payment_method_external_id",
	"payment_method_name",
	"amount",
	"fee_amount",
	"reference_no",
	"partner_transaction_id",
];

const SHIFT_COLUMNS = [
	"tenant_id",
	"store_id",
	"external_id",
	"name",
	"cashier_external_id",
	"cashier_name",
	"opened_at",
	"closed_at",
	"sales_amount",
	"orders_count",
	"cash_drawer_amount",
	"opening_float_amount",
	"expected_cash_amount",
	"changed_after_close",
	"status",
	"device_code",
];

const EVENT_COLUMNS = [
	"tenant_id",
	"store_id",
	"invoice_id",
	"invoice_external_id",
	"kind",
	"occurred_at",
	"amount",
	"reason",
	"source",
];

const CHECK_COLUMNS = [
	"tenant_id",
	"store_id",
	"business_date",
	"source_invoice_count",
	"source_net_amount",
	"local_invoice_count",
	"local_net_amount",
	"is_matched",
];

function monthsOf(window: DateRange): IsoDate[] {
	const months: IsoDate[] = [];
	for (
		let month = firstOfMonth(window.from);
		month <= window.to;
		month = addMonths(month, 1)
	) {
		months.push(month);
	}
	return months;
}

function datasetWindow(dataset: ParityDataset, clock: ParityClock): DateRange {
	return { from: dataset.from, to: minDate(dataset.to, clock.today) };
}

function datasetDays(dataset: ParityDataset, clock: ParityClock): DemoDayCache {
	return new DemoDayCache({
		now: () => clock.now,
		volumeScale: dataset.volumeScale,
		window: datasetWindow(dataset, clock),
		...(dataset.rewriteDay === undefined
			? {}
			: { rewriteDay: dataset.rewriteDay }),
	});
}

function seededDataset(
	record: SeededRecord,
	clock: ParityClock,
	days: DemoDayCache = datasetDays(record.dataset, clock),
): SeededDataset {
	const stores = Object.fromEntries(
		days
			.stores()
			.map((definition) => [
				definition.id,
				{ definition, uuid: record.storeUuids[definition.id] },
			]),
	) as Record<DemoStoreId, SeededStore>;
	const demoIdByUuid = new Map(
		Object.values(stores).map((store) => [store.uuid, store.definition.id]),
	);
	const engine = createDemoAnalyticsSource({
		now: () => clock.now,
		days,
		volumeScale: record.dataset.volumeScale,
		validateRows: true,
	});
	return {
		dataset: record.dataset,
		tenantId: record.tenantId,
		slug: record.slug,
		posAccountId: record.posAccountId,
		window: record.window,
		stores,
		days,
		engine,
		counts: record.counts,
		uuidOf: (storeId) => stores[storeId].uuid,
		demoIdOf: (uuid) => demoIdByUuid.get(uuid),
	};
}

async function seedDataset(
	connection: SqlConnection,
	clock: ParityClock,
	dataset: ParityDataset,
): Promise<{ record: SeededRecord; days: DemoDayCache }> {
	const token = syntheticToken();
	const tenantId = `${token}-0000-4000-8000-000000000000`;
	const posAccountId = `${token}-0000-4000-8000-0000000000ac`;
	const slug = `parity-${token}`;
	const window = datasetWindow(dataset, clock);
	const days = datasetDays(dataset, clock);
	const definitions = days.stores();
	const profiles = new Map(
		demoStoreProfiles(clock.asOf).map((profile) => [profile.storeId, profile]),
	);
	const stores = Object.fromEntries(
		definitions.map((definition) => [
			definition.id,
			{ definition, uuid: storeUuid(token, definition.index) },
		]),
	) as Record<DemoStoreId, SeededStore>;

	const statements: string[] = [
		...insertStatements(
			"public.tenants",
			[
				"id",
				"slug",
				"name",
				"country_code",
				"currency_code",
				"timezone",
				"legal_form",
				"default_language",
			],
			[
				{
					id: tenantId,
					slug,
					name: `Parity ${dataset.id}`,
					country_code: "VN",
					currency_code: "VND",
					timezone: "Asia/Ho_Chi_Minh",
					legal_form: DEMO_TENANT_PROFILE.legalForm,
					default_language: DEMO_TENANT_PROFILE.defaultLanguage,
				},
			],
		),
		...insertStatements(
			"public.pos_accounts",
			["id", "tenant_id", "connector", "account_key", "display_name"],
			[
				{
					id: posAccountId,
					tenant_id: tenantId,
					connector: "mock",
					account_key: `parity-${dataset.id}`,
					display_name: "Parity",
				},
			],
		),
		...insertStatements(
			"public.stores",
			[
				"id",
				"tenant_id",
				"pos_account_id",
				"external_id",
				"code",
				"name",
				"timezone",
				"business_day_start_minutes",
				"opening_hours",
				"opened_on",
				"e_invoice_status",
				"tran_no_reset_period",
				"member_capture_status",
			],
			Object.values(stores).map(({ definition, uuid }) => {
				const profile = profiles.get(definition.id);
				return {
					id: uuid,
					tenant_id: tenantId,
					pos_account_id: posAccountId,
					external_id: definition.id,
					code: definition.id,
					name: definition.name,
					timezone: definition.timeZone,
					business_day_start_minutes: definition.businessDayStartMinutes,
					opening_hours: profile?.openingHours ?? null,
					opened_on: definition.openedOn,
					e_invoice_status: profile?.eInvoiceStatus ?? "unknown",
					tran_no_reset_period: profile?.tranNoResetPeriod ?? "unknown",
					member_capture_status: profile?.memberCaptureStatus ?? "unknown",
				};
			}),
		),
		...insertStatements(
			"public.payment_methods",
			["tenant_id", "pos_account_id", "external_id", "name", "kind"],
			MENU.catalog.paymentMethods.map((method) => ({
				tenant_id: tenantId,
				pos_account_id: posAccountId,
				external_id: method.externalId,
				name: method.name,
				kind: method.kind,
			})),
		),
		...insertStatements(
			"public.promotions",
			["tenant_id", "pos_account_id", "external_id", "name", "active"],
			demoPromotionCatalogue(DEMO_POS_ACCOUNT_ID).map((promotion) => ({
				tenant_id: tenantId,
				pos_account_id: posAccountId,
				external_id: promotion.externalId,
				name: promotion.name,
				active: promotion.active,
			})),
		),
		...insertStatements(
			"public.item_type_roles",
			["tenant_id", "pos_account_id", "item_type_external_id", "role"],
			demoRoles().map((role) => ({
				tenant_id: tenantId,
				pos_account_id: posAccountId,
				item_type_external_id: role.itemTypeExternalId,
				role: role.role,
			})),
		),
	];
	const targets: Record<string, unknown>[] = [];
	for (const { definition, uuid } of Object.values(stores)) {
		for (const month of monthsOf(window)) {
			const target = days.target(definition, "month", month);
			if (target !== null) {
				targets.push({
					tenant_id: tenantId,
					store_id: uuid,
					period_kind: "month",
					period_start: month,
					net_target_amount: target,
				});
			}
		}
	}
	statements.push(
		...insertStatements(
			"public.targets",
			[
				"tenant_id",
				"store_id",
				"period_kind",
				"period_start",
				"net_target_amount",
			],
			targets,
		),
	);
	await connection.exec(statements.join("\n"));

	const counts: SeededCounts = {
		invoices: 0,
		lines: 0,
		shifts: 0,
		events: 0,
		checks: 0,
	};
	for (const { definition, uuid } of Object.values(stores)) {
		const invoices: Record<string, unknown>[] = [];
		const lines: Record<string, unknown>[] = [];
		const payments: Record<string, unknown>[] = [];
		const shifts: Record<string, unknown>[] = [];
		const events: Record<string, unknown>[] = [];
		const checks: Record<string, unknown>[] = [];
		const range = days.storeRange(definition);
		for (
			let date = range?.from ?? window.to;
			range !== null && date <= range.to;
			date = addDays(date, 1)
		) {
			const day = days.generatedNow(definition.id, date);
			const check = days.syncCheck(definition, date);
			if (check !== null) {
				const count = day?.dailyTotal.invoiceCount ?? 0;
				const net = day?.dailyTotal.netAmount ?? 0;
				checks.push({
					tenant_id: tenantId,
					store_id: uuid,
					business_date: date,
					source_invoice_count: count,
					source_net_amount: net.toFixed(2),
					local_invoice_count: check.matched ? count : count + 1,
					local_net_amount: net.toFixed(2),
					is_matched: check.matched,
				});
			}
			if (day === null) continue;
			const invoiceIds = new Map<string, string>();
			for (const sale of day.sales) {
				const write = mapSale(sale, {
					tenantId,
					storeId: uuid,
					posAccountId,
					businessDate: date,
				}).write;
				const id = randomUUID();
				invoiceIds.set(sale.externalId, id);
				invoices.push({ ...write.invoice, id });
				for (const line of write.lines) lines.push({ ...line, invoice_id: id });
				for (const payment of write.payments)
					payments.push({ ...payment, invoice_id: id });
			}
			const cash = cashByShift(day.sales);
			for (const shift of day.shifts) {
				shifts.push({
					...mapShift(shift, { tenantId, storeId: uuid, cashByShift: cash }),
				});
			}
			for (const event of adjustmentEvents(day.adjustments, {
				tenantId,
				storeId: uuid,
			}).events) {
				events.push({
					...event,
					invoice_id: invoiceIds.get(event.invoice_external_id) ?? null,
				});
			}
		}
		counts.invoices += invoices.length;
		counts.lines += lines.length;
		counts.shifts += shifts.length;
		counts.events += events.length;
		counts.checks += checks.length;
		for (const statement of [
			...insertStatements("public.invoices", INVOICE_COLUMNS, invoices),
			...insertStatements("public.invoice_lines", LINE_COLUMNS, lines),
			...insertStatements("public.invoice_payments", PAYMENT_COLUMNS, payments),
			...insertStatements("public.shifts", SHIFT_COLUMNS, shifts),
			...insertStatements("public.invoice_events", EVENT_COLUMNS, events),
			...insertStatements("public.sync_checks", CHECK_COLUMNS, checks),
		]) {
			await connection.exec(statement);
		}
	}
	for (
		let from = window.from;
		from <= window.to;
		from = addDays(from, REFRESH_CHUNK_DAYS)
	) {
		const to = minDate(addDays(from, REFRESH_CHUNK_DAYS - 1), window.to);
		await connection.rows(
			"select app.refresh_analytics($1::uuid, $2::date, $3::date)",
			[tenantId, from, to],
		);
	}
	const record: SeededRecord = {
		dataset,
		tenantId,
		slug,
		posAccountId,
		window,
		storeUuids: Object.fromEntries(
			Object.values(stores).map(({ definition, uuid }) => [
				definition.id,
				uuid,
			]),
		) as Record<DemoStoreId, string>,
		counts,
	};
	return { record, days };
}

interface ParityTemplate {
	readonly now: string;
	readonly dataPath: string;
	readonly records: readonly SeededRecord[];
}

const CLONE_TREE = { recursive: true, mode: constants.COPYFILE_FICLONE };

function datasetKey(dataset: ParityDataset): string {
	return [dataset.id, dataset.from, dataset.to, dataset.volumeScale].join("|");
}

function readTemplates(
	directory: string,
	clock: ParityClock,
): ParityTemplate[] {
	const now = clock.now.toISOString();
	return readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.map(
			(name) =>
				JSON.parse(
					readFileSync(join(directory, name), "utf8"),
				) as ParityTemplate,
		)
		.filter((template) => template.now === now);
}

function closestTemplate(
	templates: readonly ParityTemplate[],
	requested: readonly ParityDataset[],
): ParityTemplate | null {
	const wanted = new Set(requested.map(datasetKey));
	let best: ParityTemplate | null = null;
	let bestShared = 0;
	for (const template of templates) {
		const shared = template.records.filter((record) =>
			wanted.has(datasetKey(record.dataset)),
		).length;
		const fewerExtras =
			best !== null && template.records.length < best.records.length;
		if (
			shared > bestShared ||
			(shared > 0 && shared === bestShared && fewerExtras)
		) {
			best = template;
			bestShared = shared;
		}
	}
	return best;
}

function saveTemplate(
	directory: string,
	clock: ParityClock,
	records: readonly SeededRecord[],
	workDir: string,
): void {
	const name = createHash("sha256")
		.update(clock.now.toISOString())
		.update(records.map((record) => datasetKey(record.dataset)).join(","))
		.digest("hex")
		.slice(0, 24);
	const staging = join(directory, `${name}.${process.pid}.staging`);
	const dataPath = join(directory, `${name}.pgdata`);
	cpSync(workDir, staging, CLONE_TREE);
	renameSync(staging, dataPath);
	const template: ParityTemplate = {
		now: clock.now.toISOString(),
		dataPath,
		records,
	};
	writeFileSync(staging, JSON.stringify(template));
	renameSync(staging, join(directory, `${name}.json`));
}

async function openSeededConnection(
	datasets: readonly ParityDataset[],
	clock: ParityClock,
): Promise<{
	connection: SqlConnection;
	records: SeededRecord[];
	seededDays: Map<SeededRecord, DemoDayCache>;
}> {
	const directory =
		parityMode() === "pglite" ? providedText("parityTemplateDirectory") : null;
	const template =
		directory === null
			? null
			: closestTemplate(readTemplates(directory, clock), datasets);
	const workDir =
		directory === null
			? null
			: join(directory, `work-${process.pid}-${syntheticToken()}`);
	if (workDir !== null && template !== null) {
		cpSync(template.dataPath, workDir, CLONE_TREE);
	}
	const connection =
		workDir === null ? await openConnection() : await pgliteConnection(workDir);
	const records = [...(template?.records ?? [])];
	const seededDays = new Map<SeededRecord, DemoDayCache>();
	const loaded = new Set(records.map((record) => datasetKey(record.dataset)));
	try {
		const missing = datasets.filter(
			(dataset) => !loaded.has(datasetKey(dataset)),
		);
		for (const dataset of missing) {
			const { record, days } = await seedDataset(connection, clock, dataset);
			records.push(record);
			seededDays.set(record, days);
		}
		if (missing.length > 0) {
			await connection.exec("analyze");
			if (directory !== null && workDir !== null) {
				await connection.exec("checkpoint");
				saveTemplate(directory, clock, records, workDir);
			}
		}
	} catch (error) {
		await closeAndForget(connection, records);
		throw error;
	}
	return { connection, records, seededDays };
}

async function closeAndForget(
	connection: SqlConnection,
	records: readonly SeededRecord[],
): Promise<void> {
	try {
		if (connection.mode === "postgres" && records.length > 0) {
			await connection.rows(
				"delete from public.tenants where id = any($1::uuid[])",
				[pgArray(records.map((record) => record.tenantId))],
			);
		}
	} finally {
		await connection.close();
	}
}

function sqlArgument(value: unknown): unknown {
	if (Array.isArray(value)) return pgArray(value.map(String));
	if (typeof value === "number") return String(value);
	return value;
}

export function callSql<N extends AnalyticsFunctionName>(
	seeded: SeededDataset,
	name: N,
	args: AnalyticsArgs<N>,
): { text: string; params: unknown[] } {
	const known = new Set(argumentNames(name));
	const params: unknown[] = [];
	const parts: string[] = [];
	for (const [argument, value] of Object.entries(args)) {
		if (value === undefined) continue;
		if (!known.has(argument))
			throw new Error(`${name} has no argument ${argument}`);
		const type = ARGUMENT_TYPES[argument];
		if (type === undefined)
			throw new Error(`no SQL type for argument ${argument}`);
		const translated =
			argument === "store_ids"
				? (value as readonly string[]).map(
						(id) => seeded.stores[id as DemoStoreId]?.uuid ?? id,
					)
				: value;
		params.push(sqlArgument(translated));
		parts.push(`${argument} => $${params.length}::${type}`);
	}
	return { text: `select * from public.${name}(${parts.join(", ")})`, params };
}

export interface OpenParityDatabase extends ParityContext {
	close(): Promise<void>;
}

export async function openParityDatabase(
	datasets: readonly ParityDataset[],
	clock: ParityClock,
): Promise<OpenParityDatabase> {
	const { connection, records, seededDays } = await openSeededConnection(
		datasets,
		clock,
	);
	const close = () => closeAndForget(connection, records);
	const byKey = new Map(
		records.map((record) => [datasetKey(record.dataset), record]),
	);
	const seeded = datasets.flatMap((dataset) => {
		const record = byKey.get(datasetKey(dataset));
		return record === undefined
			? []
			: [seededDataset({ ...record, dataset }, clock, seededDays.get(record))];
	});
	if (seeded.length !== datasets.length) {
		await close();
		throw new Error("the parity database lacks a requested dataset");
	}
	return {
		mode: connection.mode,
		clock,
		datasets: seeded,
		connection,
		async call(target, name, args) {
			const { text, params } = callSql(target, name, args);
			return connection.rows(text, params);
		},
		async scalar(text, params = []) {
			const [row] = await connection.rows(text, params);
			return row === undefined ? undefined : Object.values(row)[0];
		},
		close,
	};
}

export async function withParityDatabase<T>(
	datasets: readonly ParityDataset[],
	clock: ParityClock,
	run: (context: ParityContext) => Promise<T>,
): Promise<T> {
	const database = await openParityDatabase(datasets, clock);
	try {
		return await run(database);
	} finally {
		await database.close();
	}
}

export const PARITY_GENERATION_SEED = DEMO_SEED;
