import { randomUUID } from "node:crypto";
import {
	checkCompany,
	readDataExport,
	readDeleteSavedCompanyAnswer,
	readInvoiceStatus,
	readRequestInvoiceAnswer,
	readSavedCompanies,
} from "@fnb/zalo-mini/ordering";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addLine, emptyDraft, requestOf } from "../../src/create/draft";
import { RpcError, rpc } from "../../src/lib/rpc";
import { recordPayment } from "../../src/orders/api";
import {
	managerEInvoices,
	orderEInvoice,
	requestCompanyInvoice,
	retryEInvoice,
} from "../../src/orders/einvoice";
import type { Order } from "../../src/orders/types";
import {
	asCustomer,
	COFFEE_M,
	connect,
	dropCounterTenant,
	type LocalStack,
	localStackFromEnv,
	placeCustomerOrder,
	type SeededPerson,
	type SeededTenant,
	seedCounterTenant,
	seedCustomer,
} from "../support/seed";

// counter:integration/einvoices: the e-invoice functions behind Q01, C18 and the managers' list (docs/api.md 3.30,
// ADR-069, ADR-070), through PostgREST with real staff sessions and, for the customer, the database's functions under
// the customer's claims read by the app's own readers (@fnb/zalo-mini/ordering); a synthetic tenant with the mock
// provider on, cleaned up after. The e-invoice job is off on the local stack, so documents stay queued unless a test
// moves them as the job would.
// - Q01 pill (state transitions): none before payment → pending once paid (the sale invoice queued by the trigger);
//   IDOR: another store's staff get 42501.
// - Q01 company row (EP, BVA, decision table): the client's checks agree with the server's field by field on a table of
//   classes and boundaries; not_paid, received with 13 digits hyphenated, the replay, request_conflict, already_requested,
//   not_counter_order for an app order; another store's staff refused.
// - Managers (decision table, security): staff refused; the counts; a given-up document listed with its error class
//   and no buyer data; the filters; a bad filter 22023; a retry queues it (not_failed for any other); staff cannot retry.
// - C18 (customer): eligible on day 7 of the window and window_passed on day 8, as the server answers; another
//   customer's order unknown_order (IDOR); a request saving the company, the saved list only its owner reads; the
//   export holds both sections; a saved company deleted, another customer's refused.

const stack: LocalStack | null = localStackFromEnv();
const PROVIDER_SETTINGS = {
	seller_tax_code: "0312345678",
	template: "1",
	series: "C26MAA",
	vat_rate: "8",
};
const COMPANY = {
	taxCode: "0312345678",
	companyName: "Công ty TNHH Mẫu Tích Hợp",
	address: "12 Đường Mẫu, Quận 1",
	email: "ketoan@example.com",
};

describe.skipIf(stack === null)(
	"the e-invoice functions on the local stack",
	() => {
		let sql: Sql;
		let seeded: SeededTenant;
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

		async function onShift(person: SeededPerson, store: string) {
			await sql`delete from public.staff_shifts where user_id = ${person.id} and status <> 'closed'`;
			await sql`insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
				values (${seeded.tenantId}, ${store}, ${person.id}, (now() at time zone 'Asia/Ho_Chi_Minh')::date, now() - interval '1 minute', 0)`;
		}

		async function counterOrder(person: SeededPerson): Promise<Order> {
			const draft = addLine(
				{ ...emptyDraft(randomUUID()), type: "takeaway" },
				{
					itemId: seeded.items.coffee,
					itemName: "Cà phê sữa",
					sizeId: seeded.sizes.coffeeM,
					sizeLabel: "Vừa",
					unitPrice: COFFEE_M,
					options: [],
					qty: 1,
					note: "",
				},
			);
			const created = await rpc<{ state: string; order: Order }>(
				await as(person),
				"counter_create_order",
				{ p_store: seeded.storeA, p_request: requestOf(draft) },
			);
			expect(created.state).toBe("placed");
			return created.order;
		}

		async function paid(person: SeededPerson, order: Order): Promise<Order> {
			const answer = await recordPayment(await as(person), order, "cash");
			expect(answer.state).toBe("paid");
			return answer.order;
		}

		async function customerCall<T>(
			customer: string,
			run: (tx: Sql) => Promise<T>,
		): Promise<T> {
			return await asCustomer(sql, seeded, customer, run);
		}

		async function appOrderPaid(customer: string): Promise<string> {
			const placed = await placeCustomerOrder(sql, seeded, customer, {
				table: seeded.tables.t1,
				lines: [{ size: seeded.sizes.coffeeM, qty: 1 }],
				expectedTotal: COFFEE_M,
			});
			expect(placed.order).not.toBeNull();
			const staff = await as(seeded.people.staff);
			const detail = await rpc<Order>(staff, "counter_order", {
				p_order: placed.order?.id,
			});
			await paid(seeded.people.staff, detail);
			return placed.order?.id ?? "";
		}

		beforeAll(async () => {
			if (stack === null) return;
			sql = connect(stack);
			seeded = await seedCounterTenant(stack, sql, "ct-ei");
			await sql`insert into public.einvoice_providers (tenant_id, brand_id, adapter, mode, secret_name, settings)
				values (${seeded.tenantId}, ${seeded.brandId}, 'mock', 'sandbox', 'EINVOICE_KEY_MOCK', ${sql.json(PROVIDER_SETTINGS as never)})`;
			await onShift(seeded.people.staff, seeded.storeA);
			await onShift(seeded.people.staffB, seeded.storeB);
		});

		afterAll(async () => {
			if (stack === null || seeded === undefined) return;
			await dropCounterTenant(stack, sql, seeded);
			await sql.end({ timeout: 5 });
		});

		it("Q01 pill (ST): nothing before the payment, Đang xuất… once paid; another store's staff are refused (IDOR)", async () => {
			const staff = await as(seeded.people.staff);
			const order = await counterOrder(seeded.people.staff);
			expect((await orderEInvoice(staff, order.id)).state).toBe("none");
			const after = await paid(seeded.people.staff, order);
			const pill = await orderEInvoice(staff, after.id);
			expect(pill).toMatchObject({
				orderId: after.id,
				state: "pending",
				request: null,
				attempts: 0,
			});
			expect(pill.invoice).toMatchObject({ kind: "sale", state: "queued" });
			const other = await orderEInvoice(
				await as(seeded.people.staffB),
				after.id,
			).catch(code);
			expect(other).toBe("42501");
			const unknown = await orderEInvoice(staff, randomUUID()).catch(code);
			expect(unknown).toBe("42501");
		});

		it("Q01 company row (EP/BVA): the client's checks agree with the server's, field by field", async () => {
			const staff = await as(seeded.people.staff);
			const order = await paid(
				seeded.people.staff,
				await counterOrder(seeded.people.staff),
			);
			const cases: readonly Partial<typeof COMPANY>[] = [
				{ taxCode: "031234567" },
				{ taxCode: "03123456789" },
				{ taxCode: "031234567890" },
				{ taxCode: "03123456789012" },
				{ taxCode: "03123A5678" },
				{ taxCode: "0312 345678" },
				{ taxCode: "0312345678-01" },
				{ taxCode: "" },
				{ companyName: "a".repeat(201) },
				{ companyName: "" },
				{ companyName: "Công ty\nMẫu" },
				{ companyName: "<script>alert(1)</script>" },
				{ address: "b".repeat(301) },
				{ address: "{{ constructor }}" },
				{ address: "Tầng 3\r\nBcc: x" },
				{ email: "ketoan@example" },
				{ email: "ketoan.@example.com" },
				{ email: "ketoan@example.com\r\nBcc: x@example.com" },
				{ email: `${"a".repeat(65)}@example.com` },
				{
					taxCode: "123",
					companyName: "",
					address: "<b>",
					email: "x",
				},
			];
			for (const change of cases) {
				const company = { ...COMPANY, ...change };
				const client = checkCompany(company).problems.map(
					(problem) => problem.field,
				);
				const answer = await rpc<{ state: string; fields?: string[] }>(
					staff,
					"counter_request_invoice",
					{
						p_order: order.id,
						p_request: {
							request_id: randomUUID(),
							company: {
								tax_code: company.taxCode,
								company_name: company.companyName,
								address: company.address,
								email: company.email,
							},
						},
					},
				);
				expect({ change, state: answer.state, fields: answer.fields }).toEqual({
					change,
					state: "refused",
					fields: client,
				});
			}
			// the boundaries the server takes: 200 and 300 characters, 13 digits, a local part of 64, letters with marks
			const accepted = {
				taxCode: "0312345678001",
				companyName: "Ệ".repeat(200),
				address: "b".repeat(300),
				email: `${"a".repeat(64)}@example.com`,
			};
			expect(checkCompany(accepted).problems).toEqual([]);
			const received = await requestCompanyInvoice(
				staff,
				order.id,
				randomUUID(),
				checkCompany(accepted).company ?? (null as never),
			);
			expect(received.state).toBe("received");
			if (received.state !== "received") return;
			expect(received.request.taxCode).toBe("0312345678-001");
			expect(received.request.source).toBe("counter");
		});

		it("Q01 company row (DT): not paid, received, replayed, conflict, already requested, an app order, another store", async () => {
			const staff = await as(seeded.people.staff);
			const unpaid = await counterOrder(seeded.people.staff);
			const company = checkCompany(COMPANY).company ?? (null as never);
			expect(
				await requestCompanyInvoice(staff, unpaid.id, randomUUID(), company),
			).toMatchObject({ state: "refused", refusal: "not_paid" });
			const order = await paid(seeded.people.staff, unpaid);
			const id = randomUUID();
			const first = await requestCompanyInvoice(staff, order.id, id, company);
			expect(first).toMatchObject({ state: "received", replayed: false });
			const again = await requestCompanyInvoice(staff, order.id, id, company);
			expect(again).toMatchObject({ state: "received", replayed: true });
			const conflict = await requestCompanyInvoice(staff, order.id, id, {
				...company,
				companyName: "Công ty khác",
			});
			expect(conflict).toMatchObject({
				state: "refused",
				refusal: "request_conflict",
			});
			const second = await requestCompanyInvoice(
				staff,
				order.id,
				randomUUID(),
				company,
			);
			expect(second).toMatchObject({
				state: "refused",
				refusal: "already_requested",
			});
			const pill = await orderEInvoice(staff, order.id);
			expect(pill.request).toMatchObject({
				status: "received",
				taxCode: COMPANY.taxCode,
			});
			// an order of the app: its customer asks in the app
			const customer = await seedCustomer(sql, seeded);
			const appOrder = await appOrderPaid(customer);
			expect(
				await requestCompanyInvoice(staff, appOrder, randomUUID(), company),
			).toMatchObject({ state: "refused", refusal: "not_counter_order" });
			// another store's staff: refused like an unknown order
			const otherStore = await requestCompanyInvoice(
				await as(seeded.people.staffB),
				order.id,
				randomUUID(),
				company,
			).catch(code);
			expect(otherStore).toBe("42501");
		});

		it("managers (DT, security): staff refused; counts; a given-up document with its error class and no buyer data; retry", async () => {
			const staff = await as(seeded.people.staff);
			const manager = await as(seeded.people.manager);
			const order = await paid(
				seeded.people.staff,
				await counterOrder(seeded.people.staff),
			);
			expect(
				await managerEInvoices(staff, seeded.storeA, "failing").catch(code),
			).toBe("42501");
			expect(
				await rpc(manager, "manager_einvoices", {
					p_store: seeded.storeA,
					p_filter: "everything",
				}).catch(code),
			).toBe("22023");
			expect(
				await managerEInvoices(manager, seeded.storeB, "failing").catch(code),
			).toBe("42501");
			// the job gives up on the sale invoice: rejected data, no more attempts
			const [sale] = await sql<{ id: string }[]>`
				update public.e_invoices set state = 'failed', attempts = 10, round_attempts = 10, last_error_class = 'rejected_data',
					last_attempt_at = now(), next_attempt_at = null, gave_up_at = now()
				where order_id = ${order.id} and kind = 'sale' returning id`;
			const failing = await managerEInvoices(manager, seeded.storeA, "failing");
			expect(failing.failing).toBeGreaterThanOrEqual(1);
			expect(failing.gave_up).toBeGreaterThanOrEqual(1);
			const row = failing.invoices.find((entry) => entry.id === sale?.id);
			expect(row).toMatchObject({
				state: "failed",
				kind: "sale",
				last_error_class: "rejected_data",
				attempts: 10,
				request_status: null,
				display_no: order.display_no,
			});
			const text = JSON.stringify(failing);
			expect(text).not.toContain(COMPANY.taxCode);
			expect(text).not.toContain(COMPANY.email);
			expect(text).not.toContain(COMPANY.companyName);
			const pending = await managerEInvoices(manager, seeded.storeA, "pending");
			expect(pending.invoices.length).toBeGreaterThan(0);
			expect(
				pending.invoices.every(
					(entry) => entry.state === "queued" || entry.state === "issuing",
				),
			).toBe(true);
			expect(pending.invoices.some((entry) => entry.id === sale?.id)).toBe(
				false,
			);
			const all = await managerEInvoices(manager, seeded.storeA, "all", 200);
			expect(all.invoices.some((entry) => entry.id === sale?.id)).toBe(true);
			// a company invoice request elsewhere shows its status, still without the buyer's data
			const withRequest = await managerEInvoices(
				manager,
				seeded.storeA,
				"pending",
			);
			expect(
				withRequest.invoices.some(
					(entry) =>
						entry.kind === "replacement" && entry.request_status === "received",
				),
			).toBe(true);
			expect(JSON.stringify(withRequest)).not.toContain(COMPANY.email);
			// the counter's pill says the job gave up
			expect((await orderEInvoice(staff, order.id)).state).toBe("failed");
			// staff cannot retry; a manager can, once
			expect(await retryEInvoice(staff, sale?.id ?? "").catch(code)).toBe(
				"42501",
			);
			expect(await retryEInvoice(manager, sale?.id ?? "")).toEqual({
				state: "queued",
				refusal: null,
			});
			expect(await retryEInvoice(manager, sale?.id ?? "")).toMatchObject({
				refusal: "not_failed",
			});
			expect(await retryEInvoice(manager, randomUUID()).catch(code)).toBe(
				"42501",
			);
			expect((await orderEInvoice(staff, order.id)).state).toBe("pending");
		});

		it("C18 (customer): day 7 asks and day 8 refuses as the server answers; IDOR; saved companies and the export", async () => {
			const customer = await seedCustomer(sql, seeded);
			const stranger = await seedCustomer(sql, seeded);
			const orderId = await appOrderPaid(customer);
			const status = async (who: string, id: string) =>
				readInvoiceStatus(
					await customerCall(who, async (tx) => {
						const [row] = await tx<
							{ r: unknown }[]
						>`select public.customer_invoice_status(${id}::uuid) as r`;
						return row?.r;
					}),
				);
			const ask = async (who: string, request: Record<string, unknown>) =>
				readRequestInvoiceAnswer(
					await customerCall(who, async (tx) => {
						const [row] = await tx<
							{ r: unknown }[]
						>`select public.customer_request_invoice(${tx.json(request as never)}::jsonb) as r`;
						return row?.r;
					}),
				);
			const fresh = await status(customer, orderId);
			expect(fresh).toMatchObject({
				state: "known",
				eligible: true,
				refusal: null,
				windowDays: 7,
				total: COFFEE_M,
			});
			// another customer's order and an unknown id read the same (IDOR)
			expect(await status(stranger, orderId)).toEqual({
				state: "unknown_order",
				orderId,
			});
			expect((await status(customer, randomUUID())).state).toBe(
				"unknown_order",
			);
			// BVA of the window: day 7 after the payment's local date still asks, day 8 does not
			await sql`update public.orders set paid_at = now() - interval '7 days' where id = ${orderId}`;
			expect(await status(customer, orderId)).toMatchObject({
				eligible: true,
			});
			await sql`update public.orders set paid_at = now() - interval '8 days' where id = ${orderId}`;
			expect(await status(customer, orderId)).toMatchObject({
				eligible: false,
				refusal: "window_passed",
			});
			const late = await ask(customer, {
				request_id: randomUUID(),
				order: orderId,
				company: {
					tax_code: COMPANY.taxCode,
					company_name: COMPANY.companyName,
					address: COMPANY.address,
					email: COMPANY.email,
				},
			});
			expect(late).toMatchObject({
				state: "refused",
				refusal: "window_passed",
			});
			await sql`update public.orders set paid_at = now() - interval '1 day' where id = ${orderId}`;
			// a stranger cannot ask for it
			expect(
				await ask(stranger, {
					request_id: randomUUID(),
					order: orderId,
					company: {
						tax_code: COMPANY.taxCode,
						company_name: COMPANY.companyName,
						address: COMPANY.address,
						email: COMPANY.email,
					},
				}),
			).toMatchObject({ state: "refused", refusal: "unknown_order" });
			const received = await ask(customer, {
				request_id: randomUUID(),
				order: orderId,
				save: true,
				company: {
					tax_code: "0312345678001",
					company_name: COMPANY.companyName,
					address: COMPANY.address,
					email: COMPANY.email,
				},
			});
			expect(received).toMatchObject({
				state: "received",
				replayed: false,
				saved: true,
				request: {
					source: "app",
					status: "received",
					taxCode: "0312345678-001",
				},
			});
			const after = await status(customer, orderId);
			expect(after).toMatchObject({
				eligible: false,
				refusal: "already_requested",
			});
			const saved = readSavedCompanies(
				await customerCall(customer, async (tx) => {
					const [row] = await tx<
						{ r: unknown }[]
					>`select public.customer_saved_companies() as r`;
					return row?.r;
				}),
			);
			expect(saved.companies).toHaveLength(1);
			expect(saved.companies[0]?.taxCode).toBe("0312345678-001");
			const strangers = readSavedCompanies(
				await customerCall(stranger, async (tx) => {
					const [row] = await tx<
						{ r: unknown }[]
					>`select public.customer_saved_companies() as r`;
					return row?.r;
				}),
			);
			expect(strangers.companies).toEqual([]);
			const exported = readDataExport(
				await customerCall(customer, async (tx) => {
					const [row] = await tx<
						{ r: unknown }[]
					>`select public.customer_export_data() as r`;
					return row?.r;
				}),
			);
			const keys = exported.sections.map((section) => section.key);
			expect(keys).toContain("invoice_requests");
			expect(keys).toContain("saved_companies");
			const deleteAs = async (who: string, id: string) =>
				readDeleteSavedCompanyAnswer(
					await customerCall(who, async (tx) => {
						const [row] = await tx<
							{ r: unknown }[]
						>`select public.customer_delete_saved_company(${id}::uuid) as r`;
						return row?.r;
					}),
				);
			const companyId = saved.companies[0]?.id ?? "";
			expect(await deleteAs(stranger, companyId)).toEqual({
				state: "refused",
				refusal: "unknown_company",
			});
			expect(await deleteAs(customer, companyId)).toEqual({ state: "deleted" });
			// the request made with it stays
			expect((await status(customer, orderId)).state).toBe("known");
			const kept = await status(customer, orderId);
			expect(kept.state === "known" ? kept.request?.taxCode : null).toBe(
				"0312345678-001",
			);
		});
	},
);
