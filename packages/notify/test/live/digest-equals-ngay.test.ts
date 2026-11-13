import {
	addDays,
	argumentNames,
	asOfDate,
	createRpcAnalyticsSource,
	dayReport,
	isAnalyticsFunctionName,
	type RpcClient,
	runReport,
} from "@fnb/reports";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ARGUMENT_TYPES,
	compareDigestWithNgay,
	createZaloBotAdapter,
	type DueDigest,
	providerBaseUrl,
	USER_AGENT,
} from "../../src/index.js";
import {
	activeStoreIds,
	asMember,
	buildScopeDigest,
	manualStoreFacts,
	scopeKeyOf,
	scopeStores,
	unlimitedOwner,
} from "../../src/postgres/index.js";
import { renderDigest } from "../../src/render/index.js";
import {
	type MockProviders,
	SYNTHETIC_BOT_TOKEN,
	startMockProviders,
} from "../../src/testing/index.js";

const LIVE =
	process.env.LIVE === "1" && (process.env.DATABASE_URL ?? "") !== "";
const TENANT_SLUG = process.env.LIVE_TENANT ?? "live-local";
const DAYS = 3;
const TOLERANCE_ABSOLUTE = 1_000;
const TOLERANCE_RELATIVE = 0.0005;
const ZALO_UNITS = 1900;

const rawText = (value: string) => value;

function report(
	check: string,
	facts: Record<string, boolean | number | string>,
): void {
	console.info(JSON.stringify({ check, ...facts }));
}

function arrayLiteral(values: readonly unknown[]): string {
	return `{${values.map((value) => `"${String(value).replaceAll('"', '\\"')}"`).join(",")}}`;
}

function nativeMemberClient(sql: postgres.Sql, userId: string): RpcClient {
	return {
		async rpc(fn, args) {
			if (!isAnalyticsFunctionName(fn)) {
				return {
					data: null,
					error: { message: "unknown function", code: "invalid_call" },
				};
			}
			const known = new Set(argumentNames(fn));
			const params: unknown[] = [];
			const parts: string[] = [];
			for (const [name, value] of Object.entries(args)) {
				if (value === undefined) continue;
				const type = ARGUMENT_TYPES[name];
				if (!known.has(name) || type === undefined) {
					return {
						data: null,
						error: { message: "unknown argument", code: "invalid_call" },
					};
				}
				params.push(
					Array.isArray(value)
						? arrayLiteral(value)
						: typeof value === "number"
							? String(value)
							: value,
				);
				parts.push(`${name} => $${params.length}::${type}`);
			}
			try {
				const rows = await asMember(sql, userId, (transaction) =>
					transaction.unsafe(
						`select * from public.${fn}(${parts.join(", ")})`,
						params as postgres.ParameterOrJSON<never>[],
					),
				);
				return { data: [...rows], error: null };
			} catch (error) {
				const code = (error as { code?: string }).code;
				return {
					data: null,
					error: { message: "the call failed", ...(code ? { code } : {}) },
				};
			}
		},
	};
}

describe.skipIf(!LIVE)(
	"digest equals Ngày on the live tenant (read-only)",
	() => {
		let sql: postgres.Sql;
		let native: postgres.Sql;
		let mock: MockProviders;
		let tenantId: string;
		let ownerId: string;
		let storeIds: string[];
		let asOf: string;

		beforeAll(async () => {
			sql = postgres(process.env.DATABASE_URL ?? "", {
				max: 2,
				onnotice: () => {},
			});
			native = postgres(process.env.DATABASE_URL ?? "", {
				max: 2,
				onnotice: () => {},
				types: {
					rawDates: {
						to: 1082,
						from: [1082, 1114, 1184],
						serialize: rawText,
						parse: rawText,
					},
				},
			});
			mock = await startMockProviders();
			mock.registerZaloBot(SYNTHETIC_BOT_TOKEN);
			const [tenant] = await sql<{ id: string }[]>`
			select id::text as id from public.tenants where slug = ${TENANT_SLUG}
		`;
			if (!tenant) {
				throw new Error("the live tenant does not exist");
			}
			tenantId = tenant.id;
			const owner = await unlimitedOwner(sql, tenantId);
			if (!owner) {
				throw new Error("the live tenant has no unlimited owner");
			}
			ownerId = owner.userId;
			storeIds = await activeStoreIds(sql, tenantId);
			asOf = asOfDate(await scopeStores(sql, storeIds), new Date());
			report("setup", { stores: storeIds.length, days: DAYS });
		}, 60_000);

		afterAll(async () => {
			await mock?.close();
			await sql?.end({ timeout: 5 });
			await native?.end({ timeout: 5 });
		});

		it("builds every scope of the last three complete days equal to Ngày, the POS and metric_value", async () => {
			const days = Array.from({ length: DAYS }, (_, index) =>
				addDays(asOf, index - DAYS + 1),
			);
			const scopes = [
				{ label: "all", ids: storeIds, allStores: true },
				...(storeIds.length > 1
					? storeIds.map((id, index) => ({
							label: `store ${index + 1}`,
							ids: [id],
							allStores: false,
						}))
					: []),
			];
			let equal = 0;
			let checked = 0;
			for (const day of days) {
				for (const scope of scopes) {
					checked += 1;
					const started = performance.now();
					const at = new Date();
					const due: DueDigest = {
						tenantId,
						businessDate: day,
						scopeKey: await scopeKeyOf(sql, scope.ids),
						storeIds: [...scope.ids].sort(),
						allStores: scope.allStores,
						trigger: "manual",
						runAs: ownerId,
						channelIds: [],
						storeFacts: await manualStoreFacts(sql, scope.ids, day, at, 30),
					};
					const outcome = await buildScopeDigest(sql, due, {
						at,
						dryRun: true,
						keepBuild: true,
					});
					const builtMs = Math.round(performance.now() - started);
					expect(outcome.status).toBe("dry_run");
					const build = outcome.build;
					if (build === null || outcome.model === null) {
						throw new Error("the dry run kept no build");
					}
					const ngay = await runReport(
						dayReport,
						build.context,
						createRpcAnalyticsSource(
							nativeMemberClient(native, ownerId),
							"postgres",
						),
					);
					const comparison = compareDigestWithNgay(outcome.model, ngay);
					const [pos] = await sql<
						{ invoices: string | null; net: string | null }[]
					>`
					select sum(source_invoice_count)::text as invoices, sum(source_net_amount)::text as net
					from public.sync_checks
					where store_id in (select jsonb_array_elements_text(${JSON.stringify(scope.ids)}::text::jsonb)::uuid)
						and business_date = ${day}::date
				`;
					const posInvoices = Number(pos?.invoices ?? 0);
					const posNet = Number(pos?.net ?? 0);
					const net = outcome.model.totals.net ?? Number.NaN;
					const [metric] = await asMember(sql, ownerId, (transaction) =>
						transaction.unsafe(
							"select public.metric_value($1::uuid[], $2, $3::date, $4::date)::text as value",
							[`{${scope.ids.join(",")}}`, "net_revenue", day, day],
						),
					);
					const metricValue =
						metric?.value === null || metric?.value === undefined
							? Number.NaN
							: Number(metric.value);
					const zaloText = renderDigest(outcome.model, {
						channel: "zalo_bot",
						appBaseUrl: null,
						timeZone: build.context.stores[0]?.timeZone ?? "Asia/Ho_Chi_Minh",
						currencyCode: "VND",
					});
					const units = zaloText.units;
					const adapter = createZaloBotAdapter();
					const before = mock.zaloMessages().length;
					const sent = await adapter.send(
						{
							messageId: "11111111-1111-4111-8111-111111111111",
							kind: "digest",
							subject: null,
							text: zaloText.text,
							html: null,
							webhookBody: null,
						},
						{
							channelId: "22222222-2222-4222-8222-222222222222",
							kind: "zalo_bot",
							provider: "zalo_bot",
							address: "synthetic-chat-live",
							config: {},
						},
						{
							secret: SYNTHETIC_BOT_TOKEN,
							fetch: (input, init) => fetch(input, init),
							baseUrl: providerBaseUrl("zalo_bot", mock.environment()),
							timeoutMs: 10_000,
							userAgent: USER_AGENT,
							now: () => new Date(),
						},
					);
					const facts = {
						day: days.indexOf(day) + 1,
						scope: scope.label,
						fields: comparison.fields,
						equal: comparison.equal,
						pos_invoices: outcome.model.totals.invoices === posInvoices,
						pos_net:
							Math.abs(net - posNet) <=
							Math.max(
								TOLERANCE_ABSOLUTE,
								Math.abs(posNet) * TOLERANCE_RELATIVE,
							),
						metric_value: Math.abs(net - metricValue) < 0.005,
						fits_zalo: units <= ZALO_UNITS,
						delivered_once:
							sent.kind === "sent" && mock.zaloMessages().length === before + 1,
						build_ms: builtMs,
					};
					report("digest_equals_ngay", facts);
					expect(comparison.differing).toEqual([]);
					expect(facts.pos_invoices).toBe(true);
					expect(facts.pos_net).toBe(true);
					expect(facts.metric_value).toBe(true);
					expect(facts.fits_zalo).toBe(true);
					expect(facts.delivered_once).toBe(true);
					equal += 1;
				}
			}
			report("summary", { days: DAYS, scopes: scopes.length, equal, checked });
			expect(equal).toBe(checked);
		}, 300_000);
	},
);
