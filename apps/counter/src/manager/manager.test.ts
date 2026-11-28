import { describe, expect, it } from "vitest";
import { hourOf, summarizeDay } from "./overview";
import {
	countByKind,
	inboxOrder,
	minutesLeft,
	replyText,
	type StoreRequest,
} from "./requests";
import { confirmationNote } from "./shifts-page";
import { rosterOrder } from "./staff-page";

// counter:unit/manager: the day's numbers (voided invoices out, hours in Vietnam time, best sellers by quantity), the
// inbox (time left at its boundaries, the order, the counts, the reply text), the roster's order and the note of a
// confirmed cash difference (at most 200 characters).

describe("the day's overview", () => {
	it("leaves voided invoices out and groups by Vietnam hour", () => {
		const day = summarizeDay(
			[
				{
					id: "a",
					sold_at: "2026-11-28T01:15:00Z",
					net_amount: "29000.00",
					status: "completed",
				},
				{
					id: "b",
					sold_at: "2026-11-28T01:45:00Z",
					net_amount: 39_000,
					status: "edited",
				},
				{
					id: "c",
					sold_at: "2026-11-28T09:00:00Z",
					net_amount: "50000.00",
					status: "voided",
				},
				{
					id: "d",
					sold_at: "2026-11-28T16:59:00Z",
					net_amount: "25000",
					status: "completed",
				},
			],
			[
				{
					invoice_id: "a",
					item_name: "Cà phê sữa Vừa",
					base_name: "Cà phê sữa",
					quantity: "1",
					line_kind: "item",
				},
				{
					invoice_id: "b",
					item_name: "Trà đào",
					base_name: null,
					quantity: 2,
					line_kind: "item",
				},
				{
					invoice_id: "b",
					item_name: "Ít đá",
					base_name: null,
					quantity: 2,
					line_kind: "modifier",
				},
				{
					invoice_id: "c",
					item_name: "Trà đào",
					base_name: null,
					quantity: 9,
					line_kind: "item",
				},
				{
					invoice_id: "d",
					item_name: "Cà phê sữa Lớn",
					base_name: "Cà phê sữa",
					quantity: "2",
					line_kind: "item",
				},
			],
		);
		expect(day.revenue).toBe(93_000);
		expect(day.orders).toBe(3);
		expect(day.average).toBe(31_000);
		expect(day.byHour).toEqual([
			{ hour: 8, revenue: 68_000, orders: 2 },
			{ hour: 23, revenue: 25_000, orders: 1 },
		]);
		expect(day.best).toEqual([
			{ name: "Cà phê sữa", quantity: 3 },
			{ name: "Trà đào", quantity: 2 },
		]);
	});

	it("counts a later day's refund document in the revenue of its hour and never as an order (ADR-071)", () => {
		const day = summarizeDay(
			[
				{
					id: "sale",
					sold_at: "2026-11-28T02:00:00Z",
					net_amount: "64000.00",
					status: "completed",
				},
				{
					id: "refund",
					sold_at: "2026-11-28T03:10:00Z",
					net_amount: "-29000.00",
					status: "refund",
				},
				{
					id: "refund-only-hour",
					sold_at: "2026-11-28T05:00:00Z",
					net_amount: -35_000,
					status: "refund",
				},
			],
			[],
		);
		expect(day.revenue).toBe(0);
		expect(day.orders).toBe(1);
		expect(day.average).toBe(0);
		expect(day.byHour).toEqual([
			{ hour: 9, revenue: 64_000, orders: 1 },
			{ hour: 10, revenue: -29_000, orders: 0 },
			{ hour: 12, revenue: -35_000, orders: 0 },
		]);
		expect(
			summarizeDay(
				[
					{
						id: "refund",
						sold_at: "2026-11-28T03:10:00Z",
						net_amount: "-29000.00",
						status: "refund",
					},
				],
				[],
			),
		).toMatchObject({ revenue: -29_000, orders: 0, average: 0 });
	});

	it("is zero for an empty day and reads the hour across midnight", () => {
		expect(summarizeDay([], [])).toEqual({
			revenue: 0,
			orders: 0,
			average: 0,
			byHour: [],
			best: [],
		});
		expect(hourOf("2026-11-27T17:00:00Z")).toBe(0);
		expect(hourOf("nope")).toBe(0);
	});
});

function request(overrides: Partial<StoreRequest>): StoreRequest {
	return {
		id: "r",
		kind: "booking",
		status: "new",
		channel: "website",
		party_size: 4,
		requested_for: "2026-11-28T12:00:00Z",
		subject: null,
		note: null,
		created_at: "2026-11-28T03:00:00Z",
		answered_at: null,
		answer_message: null,
		version: 1,
		contact_name: "Khách mẫu",
		contact_phone: "0900000000",
		answer_due_at: "2026-11-28T03:30:00Z",
		overdue: false,
		...overrides,
	};
}

describe("the requests inbox", () => {
	const due = Date.parse("2026-11-28T03:30:00Z");
	it.each([
		[due - 60_000, 1],
		[due - 1, 0],
		[due, 0],
		[due + 1, -1],
		[due + 6 * 60_000, -6],
	])("at %i the time left is %i minutes", (now, left) => {
		expect(minutesLeft(request({}), now)).toBe(left);
	});

	it("has no clock once answered", () => {
		expect(minutesLeft(request({ status: "confirmed" }), due)).toBeNull();
	});

	it("puts new requests first, the most urgent first, then the others newest first", () => {
		const ordered = inboxOrder([
			request({
				id: "old-answered",
				status: "confirmed",
				created_at: "2026-11-27T01:00:00Z",
			}),
			request({ id: "late", answer_due_at: "2026-11-28T03:10:00Z" }),
			request({
				id: "new-answered",
				status: "declined",
				created_at: "2026-11-28T02:00:00Z",
			}),
			request({ id: "soon", answer_due_at: "2026-11-28T03:20:00Z" }),
		]);
		expect(ordered.map((value) => value.id)).toEqual([
			"late",
			"soon",
			"new-answered",
			"old-answered",
		]);
		expect(countByKind([request({}), request({ kind: "hold" })])).toEqual({
			all: 2,
			booking: 1,
			hold: 1,
		});
	});

	it("writes the reply as plain text with the customer's facts", () => {
		const t = (key: string, params?: Record<string, string | number>) => {
			const templates: Record<string, string> = {
				"reply.people": "{count} người",
				"reply.when": "{time} ngày {date}",
				"reply.booking.confirmed":
					"{store} xác nhận giữ chỗ cho {name}: {facts}.",
			};
			return (templates[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
				String(params?.[name] ?? ""),
			);
		};
		expect(
			replyText(
				request({ contact_name: "<b>Lan</b>" }),
				"confirmed",
				"",
				"Cửa hàng A",
				t,
			),
		).toBe(
			"Cửa hàng A xác nhận giữ chỗ cho <b>Lan</b>: 4 người, 19:00 ngày 28/11/2026.",
		);
		expect(
			replyText(request({}), "confirmed", " Hẹn gặp bạn. ", "Cửa hàng A", t),
		).toMatch(/\. Hẹn gặp bạn\.$/);
	});
});

describe("the roster and the confirmation note", () => {
	it("lists active people first and locked ones last, by name", () => {
		const row = (
			id: string,
			status: "invited" | "active" | "inactive",
			name: string,
		) => ({
			id,
			display_name: name,
			role: "staff" as const,
			store_ids: null,
			status,
			user_id: null,
			paired_at: null,
			deactivated_at: null,
		});
		expect(
			rosterOrder([
				row("1", "inactive", "A"),
				row("2", "invited", "B"),
				row("3", "active", "C"),
				row("4", "active", "B"),
			]).map((value) => value.id),
		).toEqual(["4", "3", "2", "1"]);
	});

	it("joins the reason and the note and keeps at most 200 characters", () => {
		expect(confirmationNote("Trả nhầm tiền thừa", "")).toBe(
			"Trả nhầm tiền thừa",
		);
		expect(confirmationNote("Trả nhầm tiền thừa", " khách đi rồi ")).toBe(
			"Trả nhầm tiền thừa · khách đi rồi",
		);
		expect([...confirmationNote("Lý do", "x".repeat(300))]).toHaveLength(200);
	});
});
