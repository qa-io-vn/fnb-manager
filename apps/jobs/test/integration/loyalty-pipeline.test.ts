// Component and system integration of the loyalty pipeline on the local stack:
// a sale on the till reaches the synced invoice through the real incremental
// run of @fnb/runner (runIncrementalStore with PostgresSyncRepository and
// PostgresRunnerDatabase, on the mock connector), the run's app.reconcile_loyalty
// step earns it on path A, B or C, and the member sees it in app.customer_wallet.
// Voids and edits of a later sync are clawed back by the nightly step; a held
// redemption is confirmed by the discount entry or the pool code on a synced
// invoice and released when its hold ends; re-running changes nothing.
//
// The mock connector is the seeded synthetic shop (a few sales a day) with the
// test's own sales laid over it, the way a cashier would ring them. Gated by
// LOYALTY_INTEGRATION=1 and a loopback DATABASE_URL; it creates a loyalty-it-
// tenant and removes it at the end. It never reads .env, never touches the real
// tenant and calls neither the POS nor Zalo.
import { randomBytes, randomUUID } from "node:crypto";
import type { BusinessDateWindow } from "@fnb/connector-core";
import { businessDate, type CanonicalSale } from "@fnb/core";
import {
	type IncrementalStoreOutcome,
	MemoryNotifier,
	runIncrementalStore,
} from "@fnb/runner";
import { PostgresRunnerDatabase } from "@fnb/runner/postgres";
import { createRedactor } from "@fnb/sync";
import {
	createPostgresClient,
	isLocalDatabaseUrl,
	PostgresSyncRepository,
} from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import { simulatedSale } from "../../src/commands/loyalty-sale.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ENABLED = process.env.LOYALTY_INTEGRATION === "1" && DATABASE_URL !== "";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
const DISCOUNT_NAME = "IT free drink";

// The sales the test rings on the till, by store external id and business date.
const till = vi.hoisted(() => ({
	sales: new Map<string, CanonicalSale[]>(),
}));

vi.mock("@fnb/connector-mock", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@fnb/connector-mock")>();
	const key = (storeId: string, date: string) => `${storeId}|${date}`;
	const counted = (sales: readonly CanonicalSale[]) =>
		sales.filter((sale) => sale.status !== "voided");
	const createMockConnector: typeof actual.createMockConnector = (
		options = {},
	) => {
		const inner = actual.createMockConnector({
			...options,
			profile: { averageSalesPerDay: 4, ...(options.profile ?? {}) },
		});
		return {
			...inner,
			async *fetchSales(store, window, context) {
				for await (const batch of inner.fetchSales(store, window, context)) {
					const date = batch[0]?.businessDate;
					yield date === undefined
						? batch
						: [
								...batch,
								...(till.sales.get(key(store.externalId, date)) ?? []),
							];
				}
			},
			async fetchControlTotals(store, window, context) {
				const totals = await inner.fetchControlTotals(store, window, context);
				return totals.map((total) => {
					const extra = counted(
						till.sales.get(key(store.externalId, total.businessDate)) ?? [],
					);
					return {
						...total,
						invoiceCount: total.invoiceCount + extra.length,
						grossAmount:
							(total.grossAmount ?? 0) +
							extra.reduce((sum, sale) => sum + sale.grossAmount, 0),
						discountAmount:
							(total.discountAmount ?? 0) +
							extra.reduce(
								(sum, sale) =>
									sum + sale.itemDiscountAmount + sale.billDiscountAmount,
								0,
							),
						voucherAmount:
							(total.voucherAmount ?? 0) +
							extra.reduce((sum, sale) => sum + sale.voucherAmount, 0),
						netAmount:
							total.netAmount +
							extra.reduce((sum, sale) => sum + sale.netAmount, 0),
					};
				});
			},
		};
	};
	return {
		...actual,
		createMockConnector,
		mockConnectorFactory: {
			...actual.mockConnectorFactory,
			create: (options?: Parameters<typeof createMockConnector>[0]) =>
				createMockConnector(options ?? {}),
		},
	};
});

interface StoreRow {
	readonly id: string;
	readonly externalId: string;
	readonly code: string;
	readonly timezone: string;
	readonly dayStart: number;
}

interface Member {
	readonly name: string;
	readonly phone: string;
	readonly userId: string;
	readonly zaloUserId: string;
	customerId: string;
	membershipId: string;
}

const MINUTE = 60_000;
// Counts that report the state after a run rather than what the run changed:
// rail_evidence is the number of app.invoice_rail_evidence rows the run
// replaced, so it is the same non-zero number on every run.
const GAUGES = new Set(["rail_evidence"]);

describe.skipIf(!ENABLED)(
	"the loyalty pipeline from the till to the wallet on the local stack",
	() => {
		const suffix = randomBytes(4).toString("hex");
		const slug = `loyalty-it-${suffix}`;
		const accountKey = `loyalty-it-${suffix}-till`;
		const entries = [
			{ key: accountKey, connector: "mock" as const, seed: 23, storeCount: 2 },
		];
		const env = {
			DATABASE_URL,
			POS_ACCOUNTS_JSON: JSON.stringify(entries),
			IPOS_REAL_API: "off",
		};
		const members = new Map<string, Member>();
		const userIds: string[] = [];
		let sql: Sql;
		let repository: PostgresSyncRepository;
		let runner: PostgresRunnerDatabase;
		let tenantId = "";
		let programmeId = "";
		let couponId = "";
		let staffId = "";
		let appId = "";
		let stores: StoreRow[] = [];
		let receipt = 4200;

		async function fnb(argv: string[]): Promise<void> {
			const io = capture();
			const code = await runCli(argv, env, {
				streams: io.streams,
				loadEnvFile: false,
			});
			if (code !== 0) {
				throw new Error(`fnb ${argv[0]} exited ${code}: ${io.stderr()}`);
			}
		}

		function store(index: 0 | 1): StoreRow {
			const found = stores[index];
			if (!found) {
				throw new Error(`no store ${index + 1}`);
			}
			return found;
		}

		function member(name: string): Member {
			const found = members.get(name);
			if (!found) {
				throw new Error(`no member ${name}`);
			}
			return found;
		}

		function ring(
			at: Date,
			storeRow: StoreRow,
			amount: number,
			options: {
				readonly phone?: string | null;
				readonly discountName?: string;
				readonly voucherCode?: string;
				readonly discountAmount?: number;
			} = {},
		): CanonicalSale {
			receipt += 1;
			const date = businessDate(at, storeRow.timezone, storeRow.dayStart);
			const sale = simulatedSale({
				externalId: `${slug}-${receipt}`,
				receiptNo: String(receipt),
				soldAt: at,
				businessDate: date,
				amount,
				phone: options.phone ?? null,
				reward: {
					discountName: options.discountName ?? null,
					voucherCode: options.voucherCode ?? null,
					discountAmount: options.discountAmount ?? 0,
				},
			});
			const key = `${storeRow.externalId}|${date}`;
			till.sales.set(key, [...(till.sales.get(key) ?? []), sale]);
			return sale;
		}

		function replace(sale: CanonicalSale, next: CanonicalSale): void {
			for (const [key, sales] of till.sales) {
				till.sales.set(
					key,
					sales.map((entry) =>
						entry.externalId === sale.externalId ? next : entry,
					),
				);
			}
		}

		async function sync(at: Date): Promise<IncrementalStoreOutcome[]> {
			const outcomes: IncrementalStoreOutcome[] = [];
			for (const storeRow of stores) {
				outcomes.push(
					await runIncrementalStore({
						repository,
						database: runner,
						entries,
						environment: env,
						storeId: storeRow.id,
						notifier: new MemoryNotifier(),
						redact: createRedactor(),
						triggeredBy: "loyalty-pipeline-it",
						now: () => at,
						log: () => {},
					}),
				);
			}
			return outcomes;
		}

		function loyaltyCounts(
			outcomes: readonly IncrementalStoreOutcome[],
		): Record<string, number> {
			const total: Record<string, number> = {};
			for (const outcome of outcomes) {
				expect(outcome.kind).toBe("ran");
				if (outcome.kind !== "ran") {
					continue;
				}
				expect(outcome.loyalty?.status).toBe("reconciled");
				if (outcome.loyalty?.status !== "reconciled") {
					continue;
				}
				for (const [name, value] of Object.entries(outcome.loyalty.counts)) {
					total[name] = (total[name] ?? 0) + value;
				}
			}
			return total;
		}

		async function wallet(name: string, at: Date) {
			const person = member(name);
			return sql.begin(async (transaction) => {
				await transaction`
					select set_config('request.jwt.claims', ${JSON.stringify({
						sub: person.userId,
						role: "authenticated",
						app_metadata: {
							kind: "customer",
							tenant_id: tenantId,
							customer_id: person.customerId,
						},
					})}, true)
				`;
				const [row] = await transaction<
					{
						wallet: {
							stamp_cards: { stamps: number; pending: number }[];
							points: { balance: number; pending: number };
							card: { purchases: number };
							history: {
								kind: string;
								state: string;
								stamps: number;
								points: number;
								matched_path: string | null;
								receipt_no: string | null;
								reason: string | null;
							}[];
						};
					}[]
				>`select app.customer_wallet(${at.toISOString()}::timestamptz) as wallet`;
				if (!row) {
					throw new Error("no wallet");
				}
				return row.wallet;
			});
		}

		async function asCustomer<T>(
			name: string,
			query: (transaction: Sql) => Promise<T>,
		): Promise<T> {
			const person = member(name);
			return sql.begin(async (transaction) => {
				await transaction`
					select set_config('request.jwt.claims', ${JSON.stringify({
						sub: person.userId,
						role: "authenticated",
						app_metadata: {
							kind: "customer",
							tenant_id: tenantId,
							customer_id: person.customerId,
						},
					})}, true)
				`;
				return query(transaction as unknown as Sql);
			}) as Promise<T>;
		}

		async function balance(name: string) {
			const [row] = await sql<{ stamps: number; points: number }[]>`
				select stamps, points from app.loyalty_balance(${member(name).membershipId}::uuid, null)
			`;
			return row;
		}

		async function ledgerFingerprint(): Promise<string> {
			const [row] = await sql<{ digest: string }[]>`
				select concat_ws('|',
					(select count(*) from public.loyalty_ledger where tenant_id = ${tenantId}::uuid),
					(select count(*) from public.loyalty_refusals where tenant_id = ${tenantId}::uuid),
					(select string_agg(state::text || coalesce(confirmed_invoice_id::text, '-'), ',' order by id) from public.redemptions where tenant_id = ${tenantId}::uuid),
					(select string_agg(status::text, ',' order by id) from public.pending_checkins where tenant_id = ${tenantId}::uuid),
					(select string_agg(status::text, ',' order by id) from public.receipt_claims where tenant_id = ${tenantId}::uuid),
					(select count(*) from public.invoices where tenant_id = ${tenantId}::uuid),
					(select count(*) from public.loyalty_queue where tenant_id = ${tenantId}::uuid),
					(select count(*) from app.invoice_rail_evidence where tenant_id = ${tenantId}::uuid)
				) as digest
			`;
			return row?.digest ?? "";
		}

		async function join(name: string, phone: string, at: Date): Promise<void> {
			const userId = randomUUID();
			const zaloUserId = `it${randomBytes(6).toString("hex")}`;
			userIds.push(userId);
			await sql`
				insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
				values (${AUTH_INSTANCE_ID}::uuid, ${userId}::uuid, 'authenticated', 'authenticated', ${`${slug}-${name}@example.com`},
					${JSON.stringify({ kind: "customer", tenant_id: tenantId, customer_id: null })}::text::jsonb, '{}'::jsonb, now(), now())
			`;
			await sql`select app.zalo_customer_sign_in(${appId}::uuid, ${zaloUserId}, null, ${userId}::uuid)`;
			const joinedAt = new Date(at.getTime() - MINUTE);
			await sql`
				select app.customer_join(${userId}::uuid, ${appId}::uuid, ${zaloUserId}, ${`Khách ${name}`}, ${phone},
					true, false, 'privacy-it-1', ${`join-${name}`}, ${joinedAt.toISOString()}::timestamptz, ${store(0).code}, 'mini_app', ${at.toISOString()}::timestamptz)
			`;
			const [row] = await sql<{ customer_id: string; membership_id: string }[]>`
				select l.customer_id::text, m.id::text as membership_id
				from app.customer_logins l
				join public.memberships m on m.customer_id = l.customer_id
				where l.user_id = ${userId}::uuid
			`;
			if (!row) {
				throw new Error(`member ${name} did not join`);
			}
			members.set(name, {
				name,
				phone,
				userId,
				zaloUserId,
				customerId: row.customer_id,
				membershipId: row.membership_id,
			});
		}

		async function staffVerify(storeRow: StoreRow, code: string, at: Date) {
			return sql.begin(async (transaction) => {
				await transaction`
					select set_config('request.jwt.claims', ${JSON.stringify({ sub: staffId, role: "authenticated" })}, true)
				`;
				const [row] = await transaction<{ answer: { state: string } }[]>`
					select app.staff_verify_redemption(${storeRow.id}::uuid, ${code}, ${at.toISOString()}::timestamptz) as answer
				`;
				return row?.answer.state;
			});
		}

		async function redeem(name: string, storeRow: StoreRow, at: Date) {
			const [row] = await sql<
				{
					answer: {
						redemption_id: string;
						code: string;
						state: string;
						hold_expires_at: string;
					};
				}[]
			>`
				select app.redeem_coupon(${member(name).membershipId}::uuid, ${couponId}::uuid, ${storeRow.id}::uuid, ${at.toISOString()}::timestamptz) as answer
			`;
			if (row?.answer.state !== "held") {
				throw new Error(`redemption for ${name} was not held`);
			}
			return row.answer;
		}

		async function credit(name: string, points: number, at: Date) {
			await sql`
				insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
				values (${tenantId}::uuid, ${programmeId}::uuid, ${member(name).membershipId}::uuid, 'adjust', 0, ${points}, ${points * 500},
					'synthetic credit', ${new Date(at.getTime() + 90 * 86_400_000).toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)
			`;
		}

		beforeAll(async () => {
			if (!isLocalDatabaseUrl(DATABASE_URL)) {
				throw new Error(
					"LOYALTY_INTEGRATION runs on the local stack only: DATABASE_URL must name a loopback host",
				);
			}
			sql = createPostgresClient(DATABASE_URL, {
				maxConnections: 2,
			}) as unknown as Sql;
			repository = new PostgresSyncRepository(sql as never);
			runner = new PostgresRunnerDatabase(sql as never);
			await fnb([
				"tenant",
				"create",
				"--name",
				"Loyalty IT shop",
				"--slug",
				slug,
			]);
			await fnb(["onboard", "--tenant", slug, "--account", accountKey]);
			const [tenant] = await sql<{ id: string }[]>`
				select id::text from public.tenants where slug = ${slug}
			`;
			if (!tenant || !slug.startsWith("loyalty-it-")) {
				throw new Error("the fixture tenant was not created");
			}
			tenantId = tenant.id;
			await sql`
				update public.stores set code = 'lit-' || right(external_id, 1)
				where tenant_id = ${tenantId}::uuid
			`;
			stores = await sql<StoreRow[]>`
				select id::text, external_id as "externalId", code, timezone, business_day_start_minutes as "dayStart"
				from public.stores where tenant_id = ${tenantId}::uuid order by external_id
			`;
			expect(stores.map((row) => row.externalId)).toEqual([
				"MOCK-S1",
				"MOCK-S2",
			]);
			const [programme] = await sql<{ id: string }[]>`
				insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
				values (${tenantId}::uuid, 'IT programme', date '2026-01-01', 'below_threshold', 'active', 2)
				returning id::text
			`;
			programmeId = programme?.id ?? "";
			const [brand] = await sql<{ id: string }[]>`
				insert into public.brands (tenant_id, brand_key, display_name, store_ids)
				values (${tenantId}::uuid, 'brand-1', 'IT brand', ${stores.map((row) => row.id)}::uuid[])
				returning id::text
			`;
			const [app] = await sql<{ id: string }[]>`
				insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name, status)
				values (${tenantId}::uuid, ${brand?.id ?? ""}::uuid, ${`mock-it-${suffix}`}, 'ZALO_APP_SECRET_BRAND_1', 'active')
				returning id::text
			`;
			appId = app?.id ?? "";
			await sql`
				insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
				values (${tenantId}::uuid, 'privacy_notice', 'vi', 'privacy-it-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published', now() - interval '30 days')
			`;
			staffId = randomUUID();
			userIds.push(staffId);
			await sql`
				insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
				values (${AUTH_INSTANCE_ID}::uuid, ${staffId}::uuid, 'authenticated', 'authenticated', ${`${slug}-staff@example.com`}, '{}'::jsonb, '{}'::jsonb, now(), now())
			`;
			await sql`
				insert into public.tenant_members (tenant_id, user_id, role, store_ids)
				values (${tenantId}::uuid, ${staffId}::uuid, 'staff', ${stores.map((row) => row.id)}::uuid[])
			`;
			await sql`
				insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
				values (${tenantId}::uuid, ${store(0).id}::uuid, 'pos_payment_discount', '{}', now() - interval '30 days'),
					(${tenantId}::uuid, ${store(1).id}::uuid, 'crm_code_pool', '{IT-POOL}', now() - interval '30 days')
			`;
			await sql`
				insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
				values (${tenantId}::uuid, ${store(0).id}::uuid, 'points-drink', ${DISCOUNT_NAME}, null, 'discount'),
					(${tenantId}::uuid, ${store(1).id}::uuid, 'points-drink', null, 'IT-POOL', 'discount')
			`;
			await sql`
				insert into public.coupon_codes (tenant_id, store_id, reward_key, code)
				select ${tenantId}::uuid, ${store(1).id}::uuid, 'points-drink', 'ITP' || upper(${suffix}) || n
				from generate_series(1, 3) n
			`;
			const [coupon] = await sql<{ id: string }[]>`
				insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, store_ids, status)
				values (${tenantId}::uuid, ${programmeId}::uuid, 'points-drink', 'Points drink', 'free_item', 0, 10, null, 'active')
				returning id::text
			`;
			couponId = coupon?.id ?? "";
		}, 120_000);

		afterAll(async () => {
			till.sales.clear();
			if (!sql) {
				return;
			}
			if (slug.startsWith("loyalty-it-")) {
				await sql`delete from public.tenants where slug = ${slug}`;
			}
			if (userIds.length > 0) {
				await sql`delete from auth.users where id = any(${userIds}::uuid[])`;
			}
			await sql.end({ timeout: 5 });
		}, 60_000);

		it("earns paths A, B and C from one incremental run and shows each earn in the member's wallet", async () => {
			const now = new Date();
			const minutes = (offset: number) =>
				new Date(now.getTime() + offset * MINUTE);
			await join("a", "0900000901", minutes(-24 * 60));
			await join("b", "0900000902", minutes(-24 * 60));
			await join("c", "0900000903", minutes(-24 * 60));

			ring(minutes(-50), store(0), 75_000, { phone: "0900000901" });

			const code = await asCustomer("b", async (transaction) => {
				const [row] = await transaction<{ answer: { code: string } }[]>`
					select app.customer_member_code(${store(0).code}, ${minutes(-40).toISOString()}::timestamptz) as answer
				`;
				return row?.answer.code ?? "";
			});
			await sql`
				select app.loyalty_record_checkin(${store(0).id}::uuid, ${code}, ${staffId}::uuid, 61500, ${minutes(-39).toISOString()}::timestamptz)
			`;
			ring(minutes(-35), store(0), 61_500);

			const claimSale = ring(minutes(-45), store(0), 58_000);
			const claim = await asCustomer("c", async (transaction) => {
				const [row] = await transaction<{ answer: { state: string } }[]>`
					select app.customer_submit_claim(${store(0).code}, ${claimSale.receiptNo ?? ""}, 58000,
						${claimSale.businessDate}::date, ${minutes(-30).toISOString()}::timestamptz) as answer
				`;
				return row?.answer.state;
			});
			expect(claim).toBe("pending");

			const counts = loyaltyCounts(await sync(now));
			expect(counts).toMatchObject({ a_earned: 1, b_matched: 1, c_matched: 1 });

			const expected = [
				{ name: "a", path: "phone", points: 7 },
				{ name: "b", path: "member_code", points: 6 },
				{ name: "c", path: "receipt_claim", points: 5 },
			];
			for (const { name, path, points } of expected) {
				const shown = await wallet(name, minutes(1));
				const earns = shown.history.filter((entry) => entry.kind === "earn");
				expect(earns).toHaveLength(1);
				expect(earns[0]).toMatchObject({
					state: "confirmed",
					matched_path: path,
					stamps: 1,
					points,
				});
				expect(shown.stamp_cards[0]?.stamps).toBe(3);
				expect(shown.points.balance).toBe(points);
				expect(shown.card.purchases).toBe(1);
			}
		}, 180_000);

		it("claws back a sale voided and a sale edited in a later sync, taking back no more than is left once the earn was spent (ADR-046: a balance never goes negative)", async () => {
			const now = new Date();
			const minutes = (offset: number) =>
				new Date(now.getTime() + offset * MINUTE);
			await join("void", "0900000911", minutes(-24 * 60));
			await join("edit", "0900000912", minutes(-24 * 60));
			const voided = ring(minutes(-60), store(0), 100_000, {
				phone: "0900000911",
			});
			const edited = ring(minutes(-55), store(0), 80_000, {
				phone: "0900000912",
			});
			expect(loyaltyCounts(await sync(now))).toMatchObject({ a_earned: 2 });
			expect(await balance("void")).toEqual({ stamps: 3, points: 10 });

			// The earn is written at the run's moment (now), so the member spends it after the run.
			const hold = await redeem("void", store(0), minutes(1));
			expect(await balance("void")).toEqual({ stamps: 3, points: 0 });

			replace(voided, { ...voided, status: "voided" });
			replace(edited, {
				...simulatedSale({
					externalId: edited.externalId,
					receiptNo: edited.receiptNo ?? "",
					soldAt: edited.soldAt,
					businessDate: edited.businessDate,
					amount: 70_000,
					phone: "0900000912",
				}),
				status: "edited",
			});
			const later = minutes(10);
			const resync = await sync(later);
			const days = resync.flatMap((outcome) =>
				outcome.kind === "ran" ? outcome.summary.days : [],
			);
			expect(days.some((day) => day.outcome !== "unchanged")).toBe(true);
			const statuses = await sql<{ external_id: string; status: string }[]>`
				select external_id, status::text from public.invoices
				where tenant_id = ${tenantId}::uuid and external_id in (${voided.externalId}, ${edited.externalId})
				order by external_id
			`;
			expect(
				Object.fromEntries(
					statuses.map((row) => [row.external_id, row.status]),
				),
			).toEqual({
				[voided.externalId]: "voided",
				[edited.externalId]: "edited",
			});

			const nightly = await runner.loyaltyNightly(tenantId, minutes(20));
			expect(nightly.clawbacks).toBe(2);

			// ADR-046: the 10 points were spent (held), so there is nothing of them to take back: the balance stays at
			// 0, never -10, and the 10 points the programme absorbs are written on the row and counted in the answer.
			expect(await balance("void")).toEqual({ stamps: 2, points: 0 });
			expect(nightly.written_off_points).toBe(10);
			expect(nightly.written_off_stamps).toBe(0);
			const shown = await wallet("void", minutes(21));
			expect(shown.points.balance).toBe(0);
			expect(shown.history.find((entry) => entry.kind === "earn")?.state).toBe(
				"reversed",
			);
			expect(
				shown.history.find((entry) => entry.kind === "reversal")?.reason,
			).toBe("invoice_voided; short by 10 points");
			const [redemption] = await sql<{ state: string }[]>`
				select state::text from public.redemptions where id = ${hold.redemption_id}::uuid
			`;
			expect(redemption?.state).toBe("held");

			expect(await balance("edit")).toEqual({ stamps: 2, points: 0 });
			const editWallet = await wallet("edit", minutes(21));
			expect(
				editWallet.history.find((entry) => entry.kind === "reversal")?.reason,
			).toBe("invoice_edited");

			const again = await runner.loyaltyNightly(tenantId, minutes(30));
			expect(again.clawbacks).toBe(0);
		}, 180_000);

		it("confirms held redemptions from the discount entry and the pool code on synced invoices, and releases the one without an invoice when its hold ends", async () => {
			const now = new Date();
			const minutes = (offset: number) =>
				new Date(now.getTime() + offset * MINUTE);
			await join("discount", "0900000921", minutes(-24 * 60));
			await join("pool", "0900000922", minutes(-24 * 60));
			await join("unused", "0900000923", minutes(-24 * 60));
			for (const name of ["discount", "pool", "unused"]) {
				await credit(name, 10, minutes(-24 * 60));
			}

			const discountHold = await redeem("discount", store(0), minutes(-40));
			expect(await staffVerify(store(0), discountHold.code, minutes(-35))).toBe(
				"verified",
			);
			const discountSale = ring(minutes(-30), store(0), 45_000, {
				discountName: DISCOUNT_NAME.toUpperCase(),
				discountAmount: 15_000,
			});

			const poolHold = await redeem("pool", store(1), minutes(-40));
			expect(poolHold.code.startsWith(`ITP${suffix.toUpperCase()}`)).toBe(true);
			const poolSale = ring(minutes(-25), store(1), 45_000, {
				voucherCode: poolHold.code.toLowerCase(),
				discountAmount: 15_000,
			});

			const unusedHold = await redeem("unused", store(0), minutes(-40));

			const counts = loyaltyCounts(await sync(now));
			expect(counts).toMatchObject({ d_confirmed: 1, discount_confirmed: 1 });

			const redemptions = await sql<
				{ id: string; state: string; external_id: string | null }[]
			>`
				select r.id::text, r.state::text, i.external_id
				from public.redemptions r left join public.invoices i on i.id = r.confirmed_invoice_id
				where r.id = any(${[discountHold.redemption_id, poolHold.redemption_id, unusedHold.redemption_id]}::uuid[])
			`;
			const byId = new Map(redemptions.map((row) => [row.id, row]));
			expect(byId.get(discountHold.redemption_id)).toMatchObject({
				state: "confirmed",
				external_id: discountSale.externalId,
			});
			expect(byId.get(poolHold.redemption_id)).toMatchObject({
				state: "confirmed",
				external_id: poolSale.externalId,
			});
			expect(byId.get(unusedHold.redemption_id)?.state).toBe("held");
			const [code] = await sql<{ state: string }[]>`
				select state::text from public.coupon_codes where tenant_id = ${tenantId}::uuid and upper(code) = ${poolHold.code.toUpperCase()}
			`;
			expect(code?.state).toBe("used");
			const poolWallet = await wallet("pool", minutes(1));
			expect(
				poolWallet.history.find((entry) => entry.kind === "redeem")?.state,
			).toBe("confirmed");

			const holdEnd = new Date(unusedHold.hold_expires_at);
			const early = await runner.loyaltyNightly(
				tenantId,
				new Date(holdEnd.getTime() - MINUTE),
			);
			expect(early.released_holds).toBe(0);
			const released = await runner.loyaltyNightly(
				tenantId,
				new Date(holdEnd.getTime() + MINUTE),
			);
			expect(released.released_holds).toBe(1);
			expect(await balance("unused")).toEqual({ stamps: 2, points: 10 });
			const unusedWallet = await wallet(
				"unused",
				new Date(holdEnd.getTime() + 2 * MINUTE),
			);
			expect(
				unusedWallet.history.find((entry) => entry.kind === "redeem")?.state,
			).toBe("reversed");
		}, 180_000);

		it("adds nothing when sync, reconcile and the nightly step run again (confirmation of the idempotency defect class)", async () => {
			const now = new Date();
			const before = await ledgerFingerprint();
			const outcomes = await sync(new Date(now.getTime() + MINUTE));
			for (const outcome of outcomes) {
				expect(outcome.kind).toBe("ran");
				if (outcome.kind === "ran") {
					expect(
						outcome.summary.days.every((day) => day.outcome === "unchanged"),
					).toBe(true);
				}
			}
			const counts = loyaltyCounts(outcomes);
			const moved = Object.entries(counts).filter(
				([name, value]) => value !== 0 && !GAUGES.has(name),
			);
			expect(moved).toEqual([]);
			const window: BusinessDateWindow = {
				fromDate: businessDate(
					new Date(now.getTime() - 3 * 86_400_000),
					store(0).timezone,
					store(0).dayStart,
				),
				toDate: businessDate(now, store(0).timezone, store(0).dayStart),
			};
			const direct = await runner.reconcileLoyalty(
				tenantId,
				window,
				new Date(now.getTime() + 2 * MINUTE),
			);
			expect(
				Object.entries(direct ?? {}).filter(
					([name, value]) => value !== 0 && !GAUGES.has(name),
				),
			).toEqual([]);
			const nightly = await runner.loyaltyNightly(
				tenantId,
				new Date(now.getTime() + 3 * MINUTE),
			);
			expect(nightly.clawbacks).toBe(0);
			expect(nightly.released_holds).toBe(0);
			expect(await ledgerFingerprint()).toBe(before);
		}, 180_000);
	},
);
