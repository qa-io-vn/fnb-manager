import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// jobs:integration/ordering-concurrency (ADR-061, native-till.md 5.3 to 5.6, threat S10): competing calls on separate
// Postgres connections, started behind a barrier as in loyalty-concurrency. The test holds an exclusive advisory lock;
// every worker opens a transaction and asks for the shared lock first, so all of them wait until the test releases it
// and then run at once. The units under test are the order functions of the database; nothing calls iPOS or Zalo.

const DATABASE_URL = process.env.DATABASE_URL;

type Tx = Sql;

interface Answer {
	state: string;
	refusal: string | null;
	replayed: boolean;
	order: { id: string; order_no: number | null; version: number } | null;
}

describe.skipIf(!DATABASE_URL)(
	"competing order placements and counter actions on the local stack",
	() => {
		let control: Sql;
		const slug = `it-ordering-${randomBytes(4).toString("hex")}`;
		const tenantId = randomUUID();
		const storeId = randomUUID();
		const brandId = randomUUID();
		const appId = randomUUID();
		const sizeId = randomUUID();
		const tableId = randomUUID();
		const staff = [randomUUID(), randomUUID()];
		const customers = Array.from({ length: 21 }, () => randomUUID());
		let token = "";

		async function race<T>(
			count: number,
			work: (tx: Tx, index: number) => Promise<T>,
		): Promise<T[]> {
			const key = randomInt(1, 2 ** 31 - 1);
			const clients = Array.from({ length: count }, () =>
				createPostgresClient(DATABASE_URL ?? "", {
					maxConnections: 1,
					applicationName: "it-ordering-race",
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

		function request(
			requestId: string,
			total = 29000,
		): Record<string, unknown> {
			return {
				request_id: requestId,
				store: `${slug}-a1`,
				type: "table",
				table_token: token,
				payment: "counter",
				lines: [{ size: sizeId, qty: 1 }],
				expected_total: total,
			};
		}

		async function asCustomer(tx: Tx, user: string): Promise<void> {
			await tx`select set_config('request.jwt.claims', ${JSON.stringify({
				sub: user,
				role: "authenticated",
				app_metadata: { kind: "customer", tenant_id: tenantId },
			})}, true)`;
		}

		async function asStaff(tx: Tx, user: string): Promise<void> {
			await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated" })}, true)`;
		}

		async function place(
			tx: Tx,
			user: string,
			body: Record<string, unknown>,
		): Promise<Answer> {
			await asCustomer(tx, user);
			const [row] = await tx<{ r: Answer }[]>`
				select app.customer_place_order(${tx.json(body as never)}::jsonb, now()) as r
			`;
			if (!row) {
				throw new Error("no answer");
			}
			return row.r;
		}

		beforeAll(async () => {
			control = createPostgresClient(DATABASE_URL ?? "", {
				maxConnections: 1,
				applicationName: "it-ordering-control",
			});
			const accountId = randomUUID();
			const categoryId = randomUUID();
			const itemId = randomUUID();
			await control`insert into public.tenants (id, slug, name) values (${tenantId}, ${slug}, 'IT ordering concurrency')`;
			await control`
				insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
				values (${accountId}, ${tenantId}, 'mock', ${`${slug}-account`}, 'IT account')
			`;
			await control`
				insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
				values (${storeId}, ${tenantId}, ${accountId}, ${`${slug}-s1`}, ${`${slug}-a1`}, 'IT store',
					'{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb)
			`;
			for (const user of [...staff, ...customers]) {
				const customer = customers.includes(user);
				await control`
					insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
					values (${user}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
						${`${slug}-${user.slice(0, 8)}@example.com`},
						${customer ? JSON.stringify({ kind: "customer", tenant_id: tenantId }) : "{}"}::jsonb)
				`;
			}
			for (const user of staff) {
				await control`
					insert into public.tenant_members (tenant_id, user_id, role, store_ids)
					values (${tenantId}, ${user}, 'staff', array[${storeId}::uuid])
				`;
			}
			await control`
				insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
				values (${brandId}, ${tenantId}, 'brand-1', 'IT brand', array[${storeId}::uuid])
			`;
			await control`
				insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
				values (${appId}, ${tenantId}, ${brandId}, ${`${slug}-app`}, 'ZALO_APP_SECRET_BRAND_1', 'active')
			`;
			for (const [index, user] of customers.entries()) {
				await control`
					insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
					values (${tenantId}, ${appId}, ${`${slug}-zalo-${index}`}, ${user})
				`;
			}
			await control`
				insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required, max_waiting_orders)
				values (${storeId}, ${tenantId}, 'native', true, array['table'], array['counter'], false, 200)
			`;
			await control`insert into public.menu_categories (id, tenant_id, brand_id, name) values (${categoryId}, ${tenantId}, ${brandId}, 'Đồ uống')`;
			await control`insert into public.menu_items (id, tenant_id, brand_id, category_id, name) values (${itemId}, ${tenantId}, ${brandId}, ${categoryId}, 'Cà phê')`;
			await control`
				insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, price, is_default)
				values (${sizeId}, ${tenantId}, ${brandId}, ${itemId}, 29000, true)
			`;
			await control`insert into public.store_tables (id, tenant_id, store_id, label) values (${tableId}, ${tenantId}, ${storeId}, 'Bàn 1')`;
			const [row] = await control<{ token: string }[]>`
				select app.table_qr_token(${tenantId}::uuid, ${tableId}::uuid, 1) as token
			`;
			token = row?.token ?? "";
		});

		afterAll(async () => {
			if (control) {
				await control`delete from public.tenants where slug = ${slug}`;
				for (const user of [...staff, ...customers]) {
					await control`delete from auth.users where id = ${user}::uuid`;
				}
				await control.end({ timeout: 5 });
			}
		});

		it("twelve parallel calls with one request_id make one order and eleven replays", async () => {
			const requestId = randomUUID();
			const customer = customers[0] ?? "";
			const answers = await race(12, (tx) =>
				place(tx, customer, request(requestId)),
			);
			const ids = new Set(answers.map((answer) => answer.order?.id));
			expect(ids.size).toBe(1);
			expect(answers.filter((answer) => answer.replayed)).toHaveLength(11);
			expect(answers.every((answer) => answer.state === "placed")).toBe(true);
			const [count] = await control<{ n: number }[]>`
				select count(*)::int as n from public.orders where tenant_id = ${tenantId} and request_id = ${requestId}
			`;
			expect(count?.n).toBe(1);
		});

		it("twenty customers ordering at once take numbers without a gap or a repeat", async () => {
			const answers = await race(20, (tx, index) =>
				place(tx, customers[index + 1] ?? "", request(randomUUID())),
			);
			expect(answers.every((answer) => answer.state === "placed")).toBe(true);
			const rows = await control<{ order_no: number }[]>`
				select order_no from public.orders where store_id = ${storeId} order by order_no
			`;
			expect(rows.map((row) => row.order_no)).toEqual(
				Array.from({ length: 21 }, (_, index) => index + 1),
			);
		});

		it("two counter devices acting on one version: one moves the order, the other gets a conflict", async () => {
			const [order] = await control<{ id: string; version: number }[]>`
				select id, version from public.orders where store_id = ${storeId} and status = 'accepted' order by order_no limit 1
			`;
			if (!order) {
				throw new Error("no order");
			}
			const actions: [string, string | null][] = [
				["start", null],
				["cancel", "store_busy"],
			];
			const answers = await race(2, async (tx, index) => {
				const [action, reason] = actions[index] ?? ["start", null];
				await asStaff(tx, staff[index] ?? "");
				const [row] = await tx<{ r: Answer }[]>`
					select app.counter_order_act(${order.id}::uuid, ${action}, ${order.version}, ${reason}, now()) as r
				`;
				return row?.r;
			});
			const states = answers.map((answer) => answer?.state).sort();
			expect(states).toEqual(["conflict", "ok"]);
			const [events] = await control<{ n: number }[]>`
				select count(*)::int as n from public.order_events where order_id = ${order.id}
			`;
			expect(events?.n).toBe(2);
		});

		it("two customers taking the last place of a takeaway slot at once: one wins, the other is told it is full (C17-I2)", async () => {
			await control`
				update public.store_ordering_settings
				set order_types = array['table', 'takeaway'], payment_methods = array['counter', 'vietqr'], prep_minutes = 15, takeaway_slot_limit = 1
				where store_id = ${storeId}
			`;
			// the first bookable slot on the store's 15-minute grid, with a minute to spare for the race itself
			const grid = 15 * 60_000;
			const pickup = new Date(
				Math.ceil((Date.now() + 16 * 60_000) / grid) * grid,
			).toISOString();
			const answers = await race(2, (tx, index) =>
				place(tx, customers[index + 1] ?? "", {
					request_id: randomUUID(),
					store: `${slug}-a1`,
					type: "takeaway",
					payment: "vietqr",
					pickup_at: pickup,
					lines: [{ size: sizeId, qty: 1 }],
					expected_total: 29000,
				}),
			);
			const outcomes = answers
				.map((answer) => answer.refusal ?? answer.state)
				.sort();
			expect(outcomes).toEqual(["awaiting_payment", "slot_full"]);
			const [count] = await control<{ n: number }[]>`
				select count(*)::int as n from public.orders
				where store_id = ${storeId} and order_type = 'takeaway' and pickup_at = ${pickup}::timestamptz
			`;
			expect(count?.n).toBe(1);
		});

		it("eight parallel double taps at the counter make one order", async () => {
			const requestId = randomUUID();
			const body = {
				request_id: requestId,
				type: "table",
				table_id: tableId,
				lines: [{ size: sizeId, qty: 2 }],
			};
			const answers = await race(8, async (tx) => {
				await asStaff(tx, staff[0] ?? "");
				const [row] = await tx<{ r: Answer }[]>`
					select app.counter_create_order(${storeId}::uuid, ${tx.json(body as never)}::jsonb, now()) as r
				`;
				return row?.r;
			});
			expect(new Set(answers.map((answer) => answer?.order?.id)).size).toBe(1);
			expect(answers.filter((answer) => answer?.replayed)).toHaveLength(7);
		});
	},
);
