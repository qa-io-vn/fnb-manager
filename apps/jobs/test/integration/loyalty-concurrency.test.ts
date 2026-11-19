import { createHash, randomBytes, randomInt } from "node:crypto";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ISTQB error guessing on races (test-gaps G-01 and G-07): competing calls on
// separate Postgres connections, started behind a barrier. The test holds an
// exclusive advisory lock; every worker opens a transaction and asks for the
// shared lock first, so all of them are blocked until the test releases it, and
// then they run at once. The unit under test is the SQL of the till rails and
// the voucher callback; nothing here calls iPOS or Zalo.

const DATABASE_URL = process.env.DATABASE_URL;

type Tx = Sql;

describe.skipIf(!DATABASE_URL)(
	"competing redemption, verification and callback calls on the local stack",
	() => {
		let control: Sql;
		const slug = `it-loyalty-${randomBytes(4).toString("hex")}`;
		const staffIds = [crypto.randomUUID(), crypto.randomUUID()];
		let tenantId = "";
		let storeCallback = "";
		let storeFallback = "";
		let programmeId = "";
		let pathSegment = "";
		let pathSha256 = "";
		let phoneCounter = 0;
		const coupons: Record<string, string> = {};

		async function race<T>(
			count: number,
			work: (tx: Tx, index: number) => Promise<T>,
		): Promise<T[]> {
			const key = randomInt(1, 2 ** 31 - 1);
			const clients = Array.from({ length: count }, () =>
				createPostgresClient(DATABASE_URL ?? "", {
					maxConnections: 1,
					applicationName: "it-loyalty-race",
				}),
			);
			await control`select pg_advisory_lock(${key})`;
			try {
				const running = clients.map((client, index) =>
					client.begin(async (tx) => {
						await tx`select pg_advisory_xact_lock_shared(${key})`;
						return work(tx as unknown as Tx, index);
					}),
				);
				for (let attempt = 0; attempt < 200; attempt += 1) {
					const [waiting] = await control<{ n: number }[]>`
						select count(*)::int as n from pg_locks
						where locktype = 'advisory' and not granted and classid = 0 and objid = ${key}
					`;
					if ((waiting?.n ?? 0) >= count) {
						break;
					}
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				await control`select pg_advisory_unlock(${key})`;
				return await Promise.all(running);
			} finally {
				await control`select pg_advisory_unlock_all()`;
				await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
			}
		}

		async function newMember(stamps: number, points: number): Promise<string> {
			phoneCounter += 1;
			const phone = `0900000${String(phoneCounter).padStart(3, "0")}`;
			const [row] = await control<{ id: string }[]>`
				select app.loyalty_join(
					${tenantId}::uuid,
					app.loyalty_customer_for_phone(${tenantId}::uuid, ${phone}, now() - interval '10 days'),
					'mini_app', ${storeFallback}::uuid, null, null, now() - interval '10 days') as id
			`;
			const membership = row?.id ?? "";
			const [credit] = await control<{ id: string }[]>`
				insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
				values (${tenantId}::uuid, ${programmeId}::uuid, ${membership}::uuid, 'adjust', ${stamps}, ${points}, 0, 'synthetic credit', now() + interval '90 days', now() - interval '5 days')
				returning id
			`;
			if (stamps > 0) {
				await control`
					insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
					select ${tenantId}::uuid, ${membership}::uuid, ${credit?.id ?? ""}::uuid, now() - interval '5 days', now() + interval '90 days'
					from generate_series(1, ${stamps})
				`;
			}
			return membership;
		}

		async function hold(
			member: string,
			reward: string,
			store: string,
		): Promise<{ id: string; code: string }> {
			const [row] = await control<{ a: Record<string, string> }[]>`
				select app.redeem_coupon(${member}::uuid, ${coupons[reward] ?? ""}::uuid, ${store}::uuid, now()) as a
			`;
			const answer = row?.a;
			if (!answer?.redemption_id) {
				throw new Error(`no hold: ${JSON.stringify(answer)}`);
			}
			return { id: answer.redemption_id, code: answer.code ?? "" };
		}

		function callbackLines() {
			return [{ item: "ITEM-A", quantity: 2, amount: 60000 }];
		}

		async function callback(
			tx: Tx,
			code: string,
			sale: string,
			path = pathSha256,
		): Promise<{ outcome: string; discount_amount: number }> {
			const [row] = await tx<
				{ a: { outcome: string; discount_amount: number } }[]
			>`
				select app.answer_voucher_callback(
					${path}, '203.0.113.5'::inet, 'POS-1', 'PRG-1', ${code}, ${sale}, null,
					${tx.json(callbackLines())}, clock_timestamp(), clock_timestamp()) as a
			`;
			return row?.a ?? { outcome: "none", discount_amount: -1 };
		}

		async function verify(
			tx: Tx,
			staff: string,
			store: string,
			code: string,
		): Promise<string> {
			await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: staff, role: "authenticated" })}, true)`;
			const [row] = await tx<
				{ a: { state: string; refusal: string | null } }[]
			>`
				select app.staff_verify_redemption(${store}::uuid, ${code}, clock_timestamp()) as a
			`;
			return row?.a.refusal ?? row?.a.state ?? "none";
		}

		beforeAll(async () => {
			control = createPostgresClient(DATABASE_URL ?? "", {
				maxConnections: 1,
				applicationName: "it-loyalty-control",
			});
			const [fixture] = await control<
				{ tenant: string; callback: string; fallback: string }[]
			>`
				with tenant as (
					insert into public.tenants (slug, name, country_code) values (${slug}, 'IT loyalty concurrency', 'VN') returning id
				),
				account as (
					insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
					select id, 'mock', ${`${slug}-account`}, 'IT account' from tenant returning id, tenant_id
				),
				stores as (
					insert into public.stores (tenant_id, pos_account_id, external_id, code, name)
					select tenant_id, id, ${`${slug}-s1`}, 'ITC1', 'IT callback store' from account
					union all
					select tenant_id, id, ${`${slug}-s2`}, 'ITC2', 'IT fallback store' from account
					returning id, code, tenant_id
				)
				select
					(select id::text from tenant) as tenant,
					(select id::text from stores where code = 'ITC1') as callback,
					(select id::text from stores where code = 'ITC2') as fallback
			`;
			if (!fixture) {
				throw new Error("no fixture");
			}
			tenantId = fixture.tenant;
			storeCallback = fixture.callback;
			storeFallback = fixture.fallback;
			for (const [index, staff] of staffIds.entries()) {
				await control`
					insert into auth.users (id, instance_id, aud, role, email)
					values (${staff}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', ${`${slug}-staff${index}@example.com`})
				`;
				await control`
					insert into public.tenant_members (tenant_id, user_id, role, store_ids)
					values (${tenantId}::uuid, ${staff}::uuid, 'staff', array[${storeCallback}::uuid, ${storeFallback}::uuid])
				`;
			}
			const [programme] = await control<{ id: string }[]>`
				insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
				values (${tenantId}::uuid, 'IT programme', date '2026-01-01', 'below_threshold', 'active', 0)
				returning id
			`;
			programmeId = programme?.id ?? "";
			await control`
				insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, callback_ip_allowlist, active_from, callback_store_ref, callback_enabled)
				values (${tenantId}::uuid, ${storeCallback}::uuid, 'crm_callback', '{PRG-1}', '{}', now() - interval '30 days', 'POS-1', true)
			`;
			await control`
				insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
				values (${tenantId}::uuid, ${storeFallback}::uuid, 'pos_payment_discount', '{}', now() - interval '30 days')
			`;
			await control`
				insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
				values
					(${tenantId}::uuid, ${storeCallback}::uuid, 'ten-pct', null, 'PRG-1', 'discount'),
					(${tenantId}::uuid, ${storeFallback}::uuid, 'free-a', 'IT free a', null, 'discount'),
					(${tenantId}::uuid, ${storeFallback}::uuid, 'free-b', 'IT free b', null, 'discount'),
					(${tenantId}::uuid, ${storeFallback}::uuid, 'free-lim', 'IT free limited', null, 'discount')
			`;
			const inserted = await control<{ reward_key: string; id: string }[]>`
				insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, per_member_limit, store_ids, status)
				values
					(${tenantId}::uuid, ${programmeId}::uuid, 'ten-pct', 'Giảm 10%', 'percent_off', 10, 0, 10, null, array[${storeCallback}::uuid], 'active'),
					(${tenantId}::uuid, ${programmeId}::uuid, 'free-a', 'Free A', 'free_item', null, 8, 0, null, array[${storeFallback}::uuid], 'active'),
					(${tenantId}::uuid, ${programmeId}::uuid, 'free-b', 'Free B', 'free_item', null, 8, 0, null, array[${storeFallback}::uuid], 'active'),
					(${tenantId}::uuid, ${programmeId}::uuid, 'free-lim', 'Free limited', 'free_item', null, 4, 0, 1, array[${storeFallback}::uuid], 'active')
				returning reward_key, id
			`;
			for (const row of inserted) {
				coupons[row.reward_key] = row.id;
			}
			const [segment] = await control<{ segment: string }[]>`
				select app.issue_voucher_callback_path(${tenantId}::uuid, 'it-pos-crm') as segment
			`;
			pathSegment = segment?.segment ?? "";
			pathSha256 = createHash("sha256").update(pathSegment).digest("hex");
		});

		afterAll(async () => {
			if (control) {
				await control`delete from public.tenants where slug = ${slug}`;
				for (const staff of staffIds) {
					await control`delete from auth.users where id = ${staff}::uuid`;
				}
				await control.end({ timeout: 5 });
			}
		});

		it("two verifications of one code at different stores: the right store verifies once, the other is told wrong_store", async () => {
			const member = await newMember(16, 0);
			const { id, code } = await hold(member, "free-a", storeFallback);
			const answers = await race(2, (tx, index) =>
				verify(
					tx,
					staffIds[index] ?? "",
					index === 0 ? storeFallback : storeCallback,
					code,
				),
			);
			expect([...answers].sort()).toEqual(["verified", "wrong_store"]);
			const [row] = await control<{ verified: number; held: number }[]>`
				select count(*) filter (where verified_at is not null)::int as verified,
					count(*) filter (where state = 'held')::int as held
				from public.redemptions where id = ${id}::uuid
			`;
			expect(row).toEqual({ verified: 1, held: 1 });
		});

		it("two staff verifying one code at the same store: exactly one verified, the other is told used", async () => {
			const member = await newMember(16, 0);
			const { id, code } = await hold(member, "free-a", storeFallback);
			const answers = await race(2, (tx, index) =>
				verify(tx, staffIds[index] ?? "", storeFallback, code),
			);
			expect([...answers].sort()).toEqual(["used", "verified"]);
			const [row] = await control<{ verified_by: string | null }[]>`
				select verified_by::text from public.redemptions where id = ${id}::uuid
			`;
			expect(staffIds).toContain(row?.verified_by);
		});

		it("two redemptions of the same reward at the member's limit: one held, one refused, one redeem row", async () => {
			const member = await newMember(16, 0);
			const answers = await race(2, async (tx) => {
				const [row] = await tx<
					{ a: { state: string | null; refusal: string | null } }[]
				>`
					select app.redeem_coupon(${member}::uuid, ${coupons["free-lim"] ?? ""}::uuid, ${storeFallback}::uuid, clock_timestamp()) as a
				`;
				return row?.a.refusal ?? row?.a.state ?? "none";
			});
			expect(answers.filter((answer) => answer === "held")).toHaveLength(1);
			expect(
				answers.filter((answer) =>
					["already_held", "member_limit_reached"].includes(answer),
				),
			).toHaveLength(1);
			const [row] = await control<
				{ redeems: number; held: number; stamps: number }[]
			>`
				select
					(select count(*)::int from public.loyalty_ledger where membership_id = ${member}::uuid and entry_kind = 'redeem') as redeems,
					(select count(*)::int from public.redemptions where membership_id = ${member}::uuid and state = 'held') as held,
					(select stamps from app.loyalty_balance(${member}::uuid, null)) as stamps
			`;
			expect(row).toEqual({ redeems: 1, held: 1, stamps: 12 });
		});

		it("a member with 8 stamps redeeming two 8-stamp rewards at once: one held, one insufficient_stamps, nothing left to spend", async () => {
			const member = await newMember(8, 0);
			const answers = await race(2, async (tx, index) => {
				const reward = index === 0 ? "free-a" : "free-b";
				const [row] = await tx<
					{ a: { state: string | null; refusal: string | null } }[]
				>`
					select app.redeem_coupon(${member}::uuid, ${coupons[reward] ?? ""}::uuid, ${storeFallback}::uuid, clock_timestamp()) as a
				`;
				return row?.a.refusal ?? row?.a.state ?? "none";
			});
			expect([...answers].sort()).toEqual(["held", "insufficient_stamps"]);
			const [row] = await control<
				{ redeems: number; spendable: number; stamps: number }[]
			>`
				select
					(select count(*)::int from public.loyalty_ledger where membership_id = ${member}::uuid and entry_kind = 'redeem') as redeems,
					(select count(*)::int from app.redemption_spendable_stamps(${member}::uuid, now())) as spendable,
					(select stamps from app.loyalty_balance(${member}::uuid, null)) as stamps
			`;
			expect(row).toEqual({ redeems: 1, spendable: 0, stamps: 0 });
		});

		it("two callback decisions for one code under different sale ids: one discount, the other used with 0", async () => {
			const member = await newMember(0, 1000);
			const { code } = await hold(member, "ten-pct", storeCallback);
			const answers = await race(2, (tx, index) =>
				callback(tx, code, `SALE-PAIR-${index}`),
			);
			expect(answers.map((answer) => answer.outcome).sort()).toEqual([
				"accepted",
				"used",
			]);
			expect(
				answers.reduce((sum, a) => sum + Number(a.discount_amount), 0),
			).toBe(6000);
			const [row] = await control<{ n: number }[]>`
				select count(*)::int as n from app.voucher_callback_answers a
				join public.redemptions r on r.id = a.redemption_id
				where r.tenant_id = ${tenantId}::uuid and upper(r.code) = upper(${code}) and a.discount_amount > 0
			`;
			expect(row?.n).toBe(1);
		});

		it("20 callback posts of one code with 20 sale ids: exactly one answer with a discount, 19 with 0, one stored answer", async () => {
			const member = await newMember(0, 1000);
			const { code } = await hold(member, "ten-pct", storeCallback);
			const answers = await race(20, (tx, index) =>
				callback(tx, code, `SALE-TWENTY-${index}`),
			);
			expect(answers.filter((a) => a.outcome === "accepted")).toHaveLength(1);
			expect(answers.filter((a) => a.outcome === "used")).toHaveLength(19);
			expect(answers.filter((a) => Number(a.discount_amount) > 0)).toHaveLength(
				1,
			);
			expect(
				answers.reduce((sum, a) => sum + Number(a.discount_amount), 0),
			).toBe(6000);
			const [row] = await control<{ n: number }[]>`
				select count(*)::int as n from app.voucher_callback_answers a
				join public.redemptions r on r.id = a.redemption_id
				where r.tenant_id = ${tenantId}::uuid and upper(r.code) = upper(${code})
			`;
			expect(row?.n).toBe(1);
		});

		it("the same sale id posted 30 times at once: one accepted, every other post replays the first answer", async () => {
			const member = await newMember(0, 1000);
			const { code } = await hold(member, "ten-pct", storeCallback);
			const answers = await race(30, (tx) => callback(tx, code, "SALE-SAME"));
			expect(answers.filter((a) => a.outcome === "accepted")).toHaveLength(1);
			expect(answers.filter((a) => a.outcome === "replayed")).toHaveLength(29);
			expect(new Set(answers.map((a) => Number(a.discount_amount)))).toEqual(
				new Set([6000]),
			);
			const [row] = await control<{ rows: number; replays: number }[]>`
				select count(*)::int as rows, coalesce(sum(a.replays), 0)::int as replays
				from app.voucher_callback_answers a
				join public.redemptions r on r.id = a.redemption_id
				where r.tenant_id = ${tenantId}::uuid and upper(r.code) = upper(${code})
			`;
			expect(row?.rows).toBe(1);
			expect(row?.replays).toBe(29);
		});

		it("a burst of 200 posts to random wrong paths: every answer unknown_path, no log row, p95 under 300 ms", async () => {
			const [before] = await control<{ n: number }[]>`
				select count(*)::int as n from app.voucher_callback_log where tenant_id = ${tenantId}::uuid
			`;
			const timings: number[] = [];
			const outcomes = await race(10, async (tx, worker) => {
				const seen: string[] = [];
				for (let call = 0; call < 20; call += 1) {
					const path = randomBytes(32).toString("hex");
					const started = performance.now();
					const answer = await callback(
						tx,
						"ABCDEFGH",
						`WRONG-${worker}-${call}`,
						path,
					);
					timings.push(performance.now() - started);
					seen.push(answer.outcome);
				}
				return seen;
			});
			const flat = outcomes.flat();
			expect(flat).toHaveLength(200);
			expect(new Set(flat)).toEqual(new Set(["unknown_path"]));
			const [after] = await control<{ n: number }[]>`
				select count(*)::int as n from app.voucher_callback_log where tenant_id = ${tenantId}::uuid
			`;
			expect(after?.n).toBe(before?.n);
			const sorted = [...timings].sort((a, b) => a - b);
			const p95 = sorted[Math.floor(sorted.length * 0.95) - 1] ?? Number.NaN;
			expect(p95).toBeLessThan(300);
		});
	},
);
