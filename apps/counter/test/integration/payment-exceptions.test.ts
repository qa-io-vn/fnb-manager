import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RpcError, rpc } from "../../src/lib/rpc";
import {
	checkNote,
	exceptionsFor,
	managerPaymentExceptions,
	resolveOutcome,
	resolvePaymentException,
} from "../../src/manager/payment-exceptions";
import { act, orderDetail } from "../../src/orders/api";
import {
	BANK_SETTINGS,
	counterAttempt,
	counterOrderAs,
	dropPaymentRows,
	settleTransfer,
	shortTransfer,
	unknownTransfer,
	vietqrProvider,
} from "../support/payment-exceptions";
import {
	COFFEE_M,
	connect,
	dropCounterTenant,
	type LocalStack,
	localStackFromEnv,
	type SeededPerson,
	type SeededTenant,
	seedCounterTenant,
	TEA,
} from "../support/seed";

// counter:integration/payment-exceptions: Quản lý → Tiền chờ xử lý's calls (src/manager/payment-exceptions.ts) against
// manager_payment_exceptions and manager_resolve_payment_exception (ADR-068, docs/api.md 3.29), through PostgREST
// with real sessions; the money is made the server's way (a VietQR account with the mock adapter, the counter's attempt
// by app.checkout_begin, the bank's news by app.checkout_settle as bank-webhook calls it), on two synthetic tenants
// (ct-pe-…, ct-pe2-…), removed at the end with their attempts, exceptions and accounts.
// - Equivalence partitions of the four kinds: amount_differs (1,000 short), duplicate (a second exact transfer of a
//   paid order), late (a transfer after the order was cancelled), unknown_reference (a reference nobody issued); each
//   read by the page's reader with its amount, the order's, the reference, the order and the account that received it
//   (the store's own: its bank and last 4 digits); nothing applied to an order.
// - Decision table of who reads which: the store's manager reads store A's, not B's, not the brand-wide account's,
//   not another tenant's; the owner with every store reads A's and the brand-wide one (said to be the brand's); staff
//   are refused (42501).
// - Boundary values: the limit (0 and 1 give one row, 201 gives at most 200; "resolved" with 1 gives the newest of
//   both resolutions), a status unknown to the server (22023); the note's check on the client agrees with the
//   server's on a table of classes and boundaries (empty, blank, 1, 200, 201, 200 astral characters, C0, DEL, C1,
//   U+2028, markup).
// - State transitions: open → refunded with the trimmed note, who (by name) and when, an event on the order; the same
//   again a replay; dismissed after it already_resolved; the filters move it from open to resolved in one call each.
// - Decision table of who resolved it: the manager by the roster's name, the owner (never on the roster) by the name of
//   their Zalo sign-in.
// - Security (IDOR, error guessing): staff, the manager of store A on store B's exception, on the other tenant's and on
//   an unknown id are all refused 42501 and change nothing; the list holds no payer name, no account name and no full
//   account number.

const stack: LocalStack | null = localStackFromEnv();

describe.skipIf(stack === null)(
	"the managers' payment exceptions on the local stack",
	() => {
		let sql: Sql;
		let seeded: SeededTenant;
		let other: SeededTenant;
		let providerA: string;
		let providerB: string;
		let providerBrand: string;
		let providerOther: string;
		const clients = new Map<string, SupabaseClient>();

		async function as(person: SeededPerson): Promise<SupabaseClient> {
			const held = clients.get(person.id);
			if (held !== undefined) return held;
			const client = createClient(
				stack?.supabaseUrl ?? "",
				stack?.publishableKey ?? "",
				{ auth: { persistSession: false, autoRefreshToken: false } },
			);
			const { error } = await client.auth.signInWithPassword({
				email: person.email,
				password: person.password,
			});
			if (error !== null) throw error;
			clients.set(person.id, client);
			return client;
		}

		const code = (error: unknown) =>
			error instanceof RpcError ? error.code : String(error);

		async function statusOf(id: string) {
			const [row] = await sql<
				{
					status: string;
					resolved_by: string | null;
					resolution_note: string | null;
				}[]
			>`select status, resolved_by::text, resolution_note from public.payment_exceptions where id = ${id}`;
			return row;
		}

		beforeAll(async () => {
			if (stack === null) return;
			sql = connect(stack);
			seeded = await seedCounterTenant(stack, sql, "ct-pe");
			other = await seedCounterTenant(stack, sql, "ct-pe2");
			// store A and store B each have their own account; the brand has one for every store
			providerA = await vietqrProvider(
				sql,
				seeded.tenantId,
				seeded.brandId,
				seeded.storeA,
			);
			providerB = await vietqrProvider(
				sql,
				seeded.tenantId,
				seeded.brandId,
				seeded.storeB,
			);
			providerBrand = await vietqrProvider(
				sql,
				seeded.tenantId,
				seeded.brandId,
				null,
			);
			providerOther = await vietqrProvider(
				sql,
				other.tenantId,
				other.brandId,
				other.storeA,
			);
			await sql`update public.store_ordering_settings set payment_methods = array['counter', 'vietqr']
				where tenant_id in (${seeded.tenantId}, ${other.tenantId})`;
		});

		afterAll(async () => {
			if (stack === null) return;
			for (const tenant of [seeded, other]) {
				if (tenant === undefined) continue;
				await dropPaymentRows(sql, tenant.tenantId);
				await dropCounterTenant(stack, sql, tenant);
			}
			await sql.end({ timeout: 5 });
		});

		it("the four kinds (EP): each is held, never applied, and read by the page's reader with its fields", async () => {
			const manager = await as(seeded.people.manager);
			const staff = seeded.people.staff;
			// 1,000 short: amount_differs, linked to its order
			const short = await shortTransfer(
				sql,
				providerA,
				staff.id,
				seeded.storeA,
				seeded.sizes.coffeeM,
			);
			// the exact amount pays the order, then a second exact transfer is a duplicate
			const confirmed = await settleTransfer(
				sql,
				providerA,
				short.total,
				short.reference,
			);
			expect(confirmed.outcome).toBe("confirmed");
			const again = await settleTransfer(
				sql,
				providerA,
				short.total,
				short.reference,
			);
			expect(again).toMatchObject({
				outcome: "exception",
				reason: "duplicate",
			});
			// a transfer after the order was cancelled is late
			const order = await counterOrderAs(
				sql,
				staff.id,
				seeded.storeA,
				seeded.sizes.tea,
			);
			const reference = await counterAttempt(sql, staff.id, order.id);
			const staffClient = await as(staff);
			const cancelled = await act(
				staffClient,
				await orderDetail(staffClient, order.id),
				"cancel",
				"customer_request",
			);
			expect(cancelled.state).toBe("ok");
			const late = await settleTransfer(sql, providerA, TEA, reference);
			expect(late).toMatchObject({ outcome: "exception", reason: "late" });
			// a reference nobody issued
			const unknown = await unknownTransfer(sql, providerA, 50_000);

			const list = await managerPaymentExceptions(
				manager,
				seeded.storeA,
				"open",
			);
			expect(list.open).toBe(4);
			expect(list.exceptions.map((row) => row.reason)).toEqual([
				"unknown_reference",
				"late",
				"duplicate",
				"amount_differs",
			]);
			const byReason = new Map(list.exceptions.map((row) => [row.reason, row]));
			expect(byReason.get("amount_differs")).toMatchObject({
				id: short.exception,
				method: "vietqr",
				amount: COFFEE_M - 1_000,
				expected_amount: COFFEE_M,
				reference: short.reference,
				order_id: short.order,
				order_no: short.displayNo,
				status: "open",
				resolved_at: null,
				resolved_by: null,
				resolved_by_name: null,
				resolution_note: null,
				account: {
					scope: "store",
					bank_name: BANK_SETTINGS.bank_name,
					account_tail: BANK_SETTINGS.account_number.slice(-4),
				},
			});
			expect(byReason.get("duplicate")).toMatchObject({
				amount: COFFEE_M,
				expected_amount: COFFEE_M,
				order_id: short.order,
			});
			expect(byReason.get("late")).toMatchObject({
				amount: TEA,
				expected_amount: TEA,
				reference,
				order_id: order.id,
				order_no: order.display_no,
			});
			expect(byReason.get("unknown_reference")).toMatchObject({
				id: unknown,
				amount: 50_000,
				expected_amount: null,
				order_id: null,
				order_no: null,
			});
			expect(byReason.get("unknown_reference")?.reference).toMatch(
				/^FNB[2-9A-HJ-NP-Z]{8}$/,
			);
			// never applied: one succeeded payment (the exact transfer), the cancelled order unpaid
			const payments = await sql<{ order_id: string; status: string }[]>`
				select order_id::text, status::text from public.order_payments
				where order_id in (${short.order}, ${order.id}) and status = 'succeeded'`;
			expect(payments).toEqual([
				{ order_id: short.order, status: "succeeded" },
			]);
			// no payer name or account number in the answer
			const text = JSON.stringify(list);
			expect(text).not.toContain(BANK_SETTINGS.account_number);
			expect(text).not.toContain(BANK_SETTINGS.account_name);
		});

		it("who reads which (decision table): the manager of A, the owner, staff; store B, the brand's account, another tenant", async () => {
			const manager = await as(seeded.people.manager);
			const owner = await as(seeded.people.owner);
			const atB = await unknownTransfer(sql, providerB, 21_000);
			const brandWide = await unknownTransfer(sql, providerBrand, 22_000);
			const elsewhere = await unknownTransfer(sql, providerOther, 23_000);
			const ids = async (client: SupabaseClient, store: string) =>
				(await exceptionsFor(client, store, "all")).exceptions.map(
					(row) => row.id,
				);
			const managerA = await ids(manager, seeded.storeA);
			expect(managerA).not.toContain(atB);
			expect(managerA).not.toContain(brandWide);
			expect(managerA).not.toContain(elsewhere);
			const ownerA = await ids(owner, seeded.storeA);
			expect(ownerA).toContain(brandWide);
			expect(ownerA).not.toContain(atB);
			expect(ownerA).not.toContain(elsewhere);
			const ownerB = await ids(owner, seeded.storeB);
			expect(ownerB).toContain(atB);
			expect(ownerB).toContain(brandWide);
			// each says which account received it: store B's own, the brand's shared one
			const ownerBList = await exceptionsFor(owner, seeded.storeB, "all");
			const accountOf = (id: string) =>
				ownerBList.exceptions.find((row) => row.id === id)?.account?.scope;
			expect(accountOf(atB)).toBe("store");
			expect(accountOf(brandWide)).toBe("brand");
			// the owner's open count holds the brand's account; the manager's does not
			const managerOpen = (
				await managerPaymentExceptions(manager, seeded.storeA, "open", 1)
			).open;
			const ownerOpen = (
				await managerPaymentExceptions(owner, seeded.storeA, "open", 1)
			).open;
			expect(ownerOpen).toBe(managerOpen + 1);
			// refused: staff of A, the manager of A at store B, at the other tenant's store, at a store that is not one
			for (const [client, store] of [
				[await as(seeded.people.staff), seeded.storeA],
				[await as(seeded.people.staffB), seeded.storeB],
				[manager, seeded.storeB],
				[manager, other.storeA],
				[owner, other.storeA],
				[manager, randomUUID()],
			] as const) {
				expect(
					await managerPaymentExceptions(client, store, "open").catch(code),
				).toBe("42501");
			}
		});

		it("the list's boundaries (BVA): limit 0 and 1 give one row, 201 at most 200; resolved with 1 the newest; an unknown status 22023", async () => {
			const manager = await as(seeded.people.manager);
			for (const limit of [0, 1]) {
				const list = await managerPaymentExceptions(
					manager,
					seeded.storeA,
					null,
					limit,
				);
				expect(list.exceptions).toHaveLength(1);
			}
			const all = await managerPaymentExceptions(
				manager,
				seeded.storeA,
				null,
				201,
			);
			expect(all.exceptions.length).toBeGreaterThan(1);
			expect(all.exceptions.length).toBeLessThanOrEqual(200);
			// two resolved, one of each: "resolved" with limit 1 gives only the newer of both
			const refunded = await unknownTransfer(sql, providerA, 11_000);
			await resolvePaymentException(manager, refunded, "refunded", "Đã trả");
			const dismissed = await unknownTransfer(sql, providerA, 12_000);
			await resolvePaymentException(manager, dismissed, "dismissed", "Bỏ qua");
			const newest = await managerPaymentExceptions(
				manager,
				seeded.storeA,
				"resolved",
				1,
			);
			expect(newest.exceptions.map((row) => row.id)).toEqual([dismissed]);
			const both = await managerPaymentExceptions(
				manager,
				seeded.storeA,
				"resolved",
				200,
			);
			expect(both.exceptions.map((row) => row.id)).toEqual(
				expect.arrayContaining([refunded, dismissed]),
			);
			expect(both.exceptions.every((row) => row.status !== "open")).toBe(true);
			for (const status of ["closed", "Resolved", ""]) {
				expect(
					await rpc(manager, "manager_payment_exceptions", {
						p_store: seeded.storeA,
						p_status: status,
					}).catch(code),
				).toBe("22023");
			}
		});

		it("resolving (state transitions): open → refunded with the note, who and when; a replay; already_resolved; the filters", async () => {
			const manager = await as(seeded.people.manager);
			const { exception, order } = await shortTransfer(
				sql,
				providerA,
				seeded.people.staff.id,
				seeded.storeA,
				seeded.sizes.coffeeM,
				2_000,
			);
			const note = checkNote("  Đã chuyển lại 27.000đ cho khách lúc 15:00  ");
			expect(note.problem).toBeNull();
			const first = await resolvePaymentException(
				manager,
				exception,
				"refunded",
				note.note ?? "",
			);
			expect(first).toEqual({
				state: "refunded",
				replayed: false,
				refusal: null,
			});
			expect(resolveOutcome(first, "refunded")).toEqual({
				kind: "resolved",
				replayed: false,
			});
			expect(await statusOf(exception)).toEqual({
				status: "refunded",
				resolved_by: seeded.people.manager.id,
				resolution_note: "Đã chuyển lại 27.000đ cho khách lúc 15:00",
			});
			// the same resolution again is a replay, the first note kept
			const replay = await resolvePaymentException(
				manager,
				exception,
				"refunded",
				"Một ghi chú khác",
			);
			expect(resolveOutcome(replay, "refunded")).toEqual({
				kind: "resolved",
				replayed: true,
			});
			// another resolution after it is refused in words
			const late = await resolvePaymentException(
				manager,
				exception,
				"dismissed",
				"Chuyển thử",
			);
			expect(late).toEqual({
				state: "refunded",
				replayed: false,
				refusal: "already_resolved",
			});
			expect(resolveOutcome(late, "dismissed")).toEqual({
				kind: "already",
				state: "refunded",
			});
			expect((await statusOf(exception))?.resolution_note).toBe(
				"Đã chuyển lại 27.000đ cho khách lúc 15:00",
			);
			// logged on the order with who and the amount
			const [event] = await sql<
				{
					actor_kind: string;
					actor_user_id: string | null;
					amount: string | null;
				}[]
			>`select e.actor_kind, e.actor_user_id::text, e.amount::text from public.order_events e
				where e.order_id = ${order} and e.action = 'payment_exception_refunded'`;
			expect(event?.actor_kind).toBe("staff");
			expect(event?.actor_user_id).toBe(seeded.people.manager.id);
			expect(Number(event?.amount)).toBe(COFFEE_M - 2_000);
			// the filters: no longer open; listed as resolved with who, when and the note
			const open = await exceptionsFor(manager, seeded.storeA, "open");
			expect(open.exceptions.some((row) => row.id === exception)).toBe(false);
			const resolved = await exceptionsFor(manager, seeded.storeA, "resolved");
			expect(
				resolved.exceptions.find((row) => row.id === exception),
			).toMatchObject({
				status: "refunded",
				resolved_by: seeded.people.manager.id,
				resolved_by_name: seeded.people.manager.name,
				resolution_note: "Đã chuyển lại 27.000đ cho khách lúc 15:00",
			});
			expect(
				resolved.exceptions.find((row) => row.id === exception)?.resolved_at,
			).not.toBeNull();
			expect(resolved.exceptions.every((row) => row.status !== "open")).toBe(
				true,
			);
			expect(resolved.open).toBe(open.open);
		});

		it("the note (EP/BVA): the client's check agrees with the server's on each class and boundary", async () => {
			const manager = await as(seeded.people.manager);
			// the server checks the note before the status, so an already resolved exception answers without changing
			const held = await unknownTransfer(sql, providerA, 30_000);
			await resolvePaymentException(manager, held, "dismissed", "Chuyển thử");
			const cases: readonly string[] = [
				"",
				"   ",
				"a",
				"ệ".repeat(200),
				"ệ".repeat(201),
				"💸".repeat(200),
				"💸".repeat(201),
				"hai\ndòng",
				"tab\tở giữa",
				"del\u007f",
				"c1\u0085",
				"dòng mới",
				"<img src=x onerror=alert(1)>",
				"{{ constructor }}",
			];
			for (const input of cases) {
				const client = checkNote(input);
				// the page sends the trimmed note; a refused one is never sent, so the raw input goes here
				const sent = client.note ?? input;
				const server = await resolvePaymentException(
					manager,
					held,
					"dismissed",
					sent,
				).then(
					() => "taken",
					(error: unknown) => code(error),
				);
				expect({ input, server }).toEqual({
					input,
					server: client.problem === null ? "taken" : "22023",
				});
			}
			// an unknown resolution is malformed too
			expect(
				await rpc(manager, "manager_resolve_payment_exception", {
					p_exception: held,
					p_resolution: "kept",
					p_note: "Giữ lại",
				}).catch(code),
			).toBe("22023");
		});

		it("security (IDOR): staff, another store's, another tenant's and an unknown exception are refused alike and stay open", async () => {
			const manager = await as(seeded.people.manager);
			const atA = await unknownTransfer(sql, providerA, 31_000);
			const atB = await unknownTransfer(sql, providerB, 32_000);
			const brandWide = await unknownTransfer(sql, providerBrand, 33_000);
			const elsewhere = await unknownTransfer(sql, providerOther, 34_000);
			const attempts: readonly [SupabaseClient, string][] = [
				[await as(seeded.people.staff), atA],
				[await as(seeded.people.staff2), atA],
				[await as(seeded.people.staffB), atB],
				[manager, atB],
				[manager, brandWide],
				[manager, elsewhere],
				[await as(seeded.people.owner), elsewhere],
				[await as(other.people.manager), atA],
				[manager, randomUUID()],
			];
			for (const [client, id] of attempts) {
				expect(
					await resolvePaymentException(
						client,
						id,
						"refunded",
						"Đã chuyển lại",
					).catch(code),
				).toBe("42501");
			}
			for (const id of [atA, atB, brandWide, elsewhere]) {
				expect((await statusOf(id))?.status).toBe("open");
			}
			// the owner with every store resolves the brand's account's; the other tenant's manager their own
			const owner = await as(seeded.people.owner);
			expect(
				await resolvePaymentException(
					owner,
					brandWide,
					"dismissed",
					"Chuyển thử của quán",
				),
			).toEqual({ state: "dismissed", replayed: false, refusal: null });
			// the owner is not on the roster: named by their Zalo sign-in, never "someone"
			const settled = (
				await exceptionsFor(owner, seeded.storeA, "resolved", 200)
			).exceptions.find((row) => row.id === brandWide);
			expect(settled).toMatchObject({
				resolved_by: seeded.people.owner.id,
				resolved_by_name: seeded.people.owner.name,
				account: { scope: "brand" },
			});
			// the other tenant's manager does not see the name or the money
			expect(
				await exceptionsFor(
					await as(other.people.manager),
					seeded.storeA,
					"resolved",
				).catch(code),
			).toBe("42501");
			expect(
				await resolvePaymentException(
					await as(other.people.manager),
					elsewhere,
					"refunded",
					"Đã chuyển lại",
				),
			).toEqual({ state: "refunded", replayed: false, refusal: null });
		});
	},
);
