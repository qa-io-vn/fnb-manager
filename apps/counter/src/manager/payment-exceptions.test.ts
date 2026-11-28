import { describe, expect, it } from "vitest";
import { RpcError } from "../lib/rpc";
import {
	checkNote,
	exceptionsFor,
	failureKey,
	mayHoldMore,
	methodKey,
	NOTE_MAX,
	newestFirst,
	noteProblemWords,
	openCount,
	readPaymentException,
	readPaymentExceptions,
	reasonDetailKey,
	reasonKey,
	resolvable,
	resolveOutcome,
	resolvePaymentException,
	resolverName,
	statusTone,
} from "./payment-exceptions";

// counter:unit/payment-exceptions (Quản lý → Tiền chờ xử lý; ADR-068, docs/api.md 3.29):
// - equivalence partitions of the answer: a valid open, refunded and dismissed exception, and the malformed classes
//   (no id, an amount as text, negative or fractional, a status unknown or disagreeing with its resolution time, an
//   unparsable time, no list or open count); the kinds, the providers and the statuses in words, an unknown one in
//   general;
// - boundary values of the note as the server counts it (code points after trimming): empty, blank, 1, 200, 201, 200
//   astral characters; one line: C0, DEL and C1 refused, U+2028 and a zero-width space taken (PostgreSQL's
//   [[:cntrl:]]); the list's limit at 99 and 100;
// - decision table of a resolution's answer: the state equal to or other than the choice × replayed × refusal; of who
//   resolved it: nobody recorded, the signed-in person, a roster name, someone not on the roster;
// - state transitions: only an open exception is resolvable; the filter "resolved" asks for both resolutions and merges
//   them newest first;
// - error guessing (security): markup and control characters in a note or a reference pass through the reader as
//   text; 42501 (another store's, another tenant's or an unknown exception) and 22023 worded apart from the network.

const OPEN = {
	id: "77777777-0000-4000-8000-000000000001",
	reason: "amount_differs",
	method: "vietqr",
	amount: 28_000,
	expected_amount: 29_000,
	reference: "FNBABCDEFGH",
	order_id: "99999999-0000-4000-8000-000000000042",
	order_no: "#042",
	source: "webhook",
	received_at: "2026-11-28T07:05:00+00:00",
	status: "open",
	resolved_at: null,
	resolved_by: null,
	resolution_note: null,
};

const REFUNDED = {
	...OPEN,
	id: "77777777-0000-4000-8000-000000000002",
	reason: "duplicate",
	amount: 29_000,
	status: "refunded",
	resolved_at: "2026-11-28T08:00:00+00:00",
	resolved_by: "88888888-0000-4000-8000-000000000001",
	resolution_note: "Đã chuyển lại cho khách",
};

describe("the reader (EP)", () => {
	it("reads an open, a refunded and a dismissed exception", () => {
		expect(readPaymentException(OPEN)).toEqual(OPEN);
		expect(readPaymentException(REFUNDED)).toEqual(REFUNDED);
		const dismissed = {
			...REFUNDED,
			status: "dismissed",
			reason: "unknown_reference",
			order_id: null,
			order_no: null,
			expected_amount: null,
			reference: null,
		};
		expect(readPaymentException(dismissed)).toEqual(dismissed);
		expect(
			readPaymentExceptions({ open: 3, exceptions: [OPEN, REFUNDED] }),
		).toEqual({ open: 3, exceptions: [OPEN, REFUNDED] });
	});

	it("refuses each malformed class", () => {
		const bad: readonly unknown[] = [
			null,
			"text",
			[OPEN],
			{ ...OPEN, id: "" },
			{ ...OPEN, id: undefined },
			{ ...OPEN, amount: "28000" },
			{ ...OPEN, amount: -1 },
			{ ...OPEN, amount: 1.5 },
			{ ...OPEN, expected_amount: "29000" },
			{ ...OPEN, status: "closed" },
			{ ...OPEN, status: "refunded" },
			{ ...REFUNDED, status: "open" },
			{ ...OPEN, received_at: "yesterday" },
			{ ...OPEN, reference: 42 },
			{ ...OPEN, source: null },
		];
		for (const value of bad) {
			expect(
				() => readPaymentException(value),
				JSON.stringify(value),
			).toThrow();
		}
		expect(() => readPaymentExceptions({ open: 1 })).toThrow();
		expect(() => readPaymentExceptions({ exceptions: [] })).toThrow();
		expect(() => readPaymentExceptions({ open: -1, exceptions: [] })).toThrow();
		expect(() =>
			readPaymentExceptions({
				open: 1,
				exceptions: [{ ...OPEN, amount: null }],
			}),
		).toThrow();
	});

	it("keeps markup, control characters and a long reference as plain text (error guessing)", () => {
		const odd = readPaymentException({
			...REFUNDED,
			reference: `FNB${"X".repeat(300)}<b>`,
			order_no: '<img src=x onerror="alert(1)">',
			resolution_note: "<script>alert(1)</script>\u0007",
		});
		expect(odd.reference).toBe(`FNB${"X".repeat(300)}<b>`);
		expect(odd.order_no).toBe('<img src=x onerror="alert(1)">');
		expect(odd.resolution_note).toBe("<script>alert(1)</script>\u0007");
	});
});

describe("the words (EP)", () => {
	it("word each kind and provider, an unknown one in general", () => {
		for (const reason of [
			"amount_differs",
			"late",
			"duplicate",
			"unknown_reference",
		]) {
			expect(reasonKey(reason)).toBe(`paymentExceptions.reason.${reason}`);
			expect(reasonDetailKey(reason)).toBe(
				`paymentExceptions.reasonDetail.${reason}`,
			);
		}
		expect(reasonKey("chargeback")).toBe("paymentExceptions.reason.other");
		expect(reasonDetailKey("")).toBe("paymentExceptions.reasonDetail.other");
		expect(methodKey("vietqr")).toBe("paymentExceptions.method.vietqr");
		expect(methodKey("zalo_checkout")).toBe(
			"paymentExceptions.method.zalo_checkout",
		);
		expect(methodKey("momo")).toBe("paymentExceptions.method.other");
	});

	it("give each status a tone; only an open one is resolvable (state transitions)", () => {
		expect(statusTone("open")).toBe("warning");
		expect(statusTone("refunded")).toBe("positive");
		expect(statusTone("dismissed")).toBe("neutral");
		expect(resolvable({ status: "open" })).toBe(true);
		expect(resolvable({ status: "refunded" })).toBe(false);
		expect(resolvable({ status: "dismissed" })).toBe(false);
	});

	it("word 42501 and 22023 apart from the network and any other failure", () => {
		expect(failureKey(new RpcError("42501", "denied"))).toBe(
			"paymentExceptions.refusal.forbidden",
		);
		expect(failureKey(new RpcError("22023", "bad note"))).toBe(
			"paymentExceptions.refusal.invalid",
		);
		expect(failureKey(new RpcError("network", "Failed to fetch"))).toBe(
			"common.network",
		);
		expect(failureKey(new RpcError("P0001", "boom"))).toBe("common.failed");
		expect(failureKey(new Error("malformed"))).toBe("common.failed");
	});
});

describe("the note (BVA)", () => {
	it("takes 1 and 200 characters and refuses empty, blank and 201", () => {
		expect(checkNote("")).toEqual({ note: null, problem: { kind: "empty" } });
		expect(checkNote("   \t ")).toEqual({
			note: null,
			problem: { kind: "empty" },
		});
		expect(checkNote("a")).toEqual({ note: "a", problem: null });
		expect(checkNote("  đã trả  ")).toEqual({ note: "đã trả", problem: null });
		const max = "ệ".repeat(NOTE_MAX);
		expect(checkNote(max)).toEqual({ note: max, problem: null });
		expect(checkNote(`${max}a`)).toEqual({
			note: null,
			problem: { kind: "long", length: 201 },
		});
		// 200 characters outside the basic plane are 400 UTF-16 units: the server counts 200
		const astral = "💸".repeat(NOTE_MAX);
		expect(astral.length).toBe(400);
		expect(checkNote(astral).problem).toBeNull();
		expect(checkNote(`${astral}💸`).problem).toEqual({
			kind: "long",
			length: 201,
		});
		// trimmed first: 200 characters with spaces around are taken
		expect(checkNote(`  ${max}  `).note).toBe(max);
	});

	it("refuses C0, DEL and C1 inside the note and takes what PostgreSQL's [[:cntrl:]] lets through", () => {
		for (const control of [
			"\n",
			"\r",
			"\t",
			"\u0000",
			"\u001f",
			"\u007f",
			"\u0085",
			"\u009f",
		]) {
			expect(
				checkNote(`đã ${control}trả`).problem,
				JSON.stringify(control),
			).toEqual({
				kind: "control",
			});
		}
		for (const fine of [" ", "​", " ", "‮", "﻿"]) {
			expect(
				checkNote(`đã ${fine}trả`).problem,
				JSON.stringify(fine),
			).toBeNull();
		}
		// markup is a note like any other: the page shows it as text
		expect(checkNote("<img src=x onerror=alert(1)>").problem).toBeNull();
	});

	it("words each problem with the limit and the length", () => {
		expect(noteProblemWords({ kind: "empty" })).toEqual({
			key: "paymentExceptions.note.empty",
			params: {},
		});
		expect(noteProblemWords({ kind: "control" })).toEqual({
			key: "paymentExceptions.note.control",
			params: {},
		});
		expect(noteProblemWords({ kind: "long", length: 201 })).toEqual({
			key: "paymentExceptions.note.long",
			params: { max: 200, count: 201 },
		});
	});
});

describe("a resolution's answer (decision table)", () => {
	const cases = [
		// [chosen, answer, outcome]
		[
			"refunded",
			{ state: "refunded", replayed: false, refusal: null },
			{ kind: "resolved", replayed: false },
		],
		[
			"dismissed",
			{ state: "dismissed", replayed: false, refusal: null },
			{ kind: "resolved", replayed: false },
		],
		[
			"refunded",
			{ state: "refunded", replayed: true, refusal: null },
			{ kind: "resolved", replayed: true },
		],
		[
			"refunded",
			{ state: "dismissed", replayed: false, refusal: "already_resolved" },
			{ kind: "already", state: "dismissed" },
		],
		[
			"dismissed",
			{ state: "refunded", replayed: false, refusal: "already_resolved" },
			{ kind: "already", state: "refunded" },
		],
		[
			"dismissed",
			{ state: "dismissed", replayed: false, refusal: "something_new" },
			{ kind: "already", state: "dismissed" },
		],
	] as const;
	for (const [chosen, answer, outcome] of cases) {
		it(`${chosen} answered ${answer.state}, replayed ${answer.replayed}, refusal ${answer.refusal}`, () => {
			expect(resolveOutcome(answer, chosen)).toEqual(outcome);
		});
	}

	it("reads the server's answer strictly", async () => {
		const client = (data: unknown) =>
			({
				rpc: async () => ({ data, error: null }),
			}) as never;
		await expect(
			resolvePaymentException(
				client({ state: "refunded", replayed: false, refusal: null }),
				OPEN.id,
				"refunded",
				"đã trả",
			),
		).resolves.toEqual({ state: "refunded", replayed: false, refusal: null });
		await expect(
			resolvePaymentException(
				client({ state: "refunded" }),
				OPEN.id,
				"refunded",
				"đã trả",
			),
		).rejects.toThrow();
		await expect(
			resolvePaymentException(client(null), OPEN.id, "refunded", "đã trả"),
		).rejects.toThrow();
	});
});

describe("who resolved it (decision table)", () => {
	const me = { userId: "u-me", name: "Quản lý mẫu" };
	const names = new Map([["u-other", "Quản lý khác"]]);
	it("names the person, a roster name, or nobody", () => {
		expect(resolverName(null, me, names)).toBeNull();
		expect(resolverName("u-me", me, names)).toBe("Quản lý mẫu");
		expect(resolverName("u-other", me, names)).toBe("Quản lý khác");
		expect(resolverName("u-owner", me, names)).toBeNull();
	});
});

describe("the counts and the limit (BVA)", () => {
	it("counts the open ones for the badge, none before the first answer", () => {
		expect(openCount(undefined)).toBe(0);
		expect(openCount({ open: 0, exceptions: [] })).toBe(0);
		expect(openCount({ open: 1, exceptions: [] })).toBe(1);
	});

	it("says the list may hold more at the limit, not below it", () => {
		const of = (count: number) => ({
			exceptions: Array.from({ length: count }, () =>
				readPaymentException(OPEN),
			),
		});
		expect(mayHoldMore(of(99))).toBe(false);
		expect(mayHoldMore(of(100))).toBe(true);
		expect(mayHoldMore(of(2), 2)).toBe(true);
	});
});

describe("the filters (state transitions)", () => {
	function fakeClient() {
		const calls: Record<string, unknown>[] = [];
		const answers: Record<string, unknown> = {
			open: { open: 1, exceptions: [OPEN] },
			all: { open: 1, exceptions: [REFUNDED, OPEN] },
			refunded: {
				open: 1,
				exceptions: [
					REFUNDED,
					{
						...REFUNDED,
						id: "77777777-0000-4000-8000-000000000004",
						received_at: "2026-11-28T05:00:00Z",
					},
				],
			},
			dismissed: {
				open: 1,
				exceptions: [
					{
						...REFUNDED,
						id: "77777777-0000-4000-8000-000000000003",
						status: "dismissed",
						received_at: "2026-11-28T06:00:00Z",
					},
				],
			},
		};
		return {
			calls,
			client: {
				rpc: async (fn: string, args: Record<string, unknown>) => {
					calls.push({ fn, ...args });
					return {
						data: answers[(args.p_status as string | null) ?? "all"],
						error: null,
					};
				},
			} as never,
		};
	}

	it("asks for open, for all (null), and for both resolutions merged newest first", async () => {
		const fake = fakeClient();
		expect((await exceptionsFor(fake.client, "s", "open")).exceptions).toEqual([
			OPEN,
		]);
		expect(
			(await exceptionsFor(fake.client, "s", "all")).exceptions.map(
				(e) => e.id,
			),
		).toEqual([REFUNDED.id, OPEN.id]);
		const resolved = await exceptionsFor(fake.client, "s", "resolved");
		expect(resolved.open).toBe(1);
		expect(resolved.exceptions.map((exception) => exception.id)).toEqual([
			REFUNDED.id,
			"77777777-0000-4000-8000-000000000003",
			"77777777-0000-4000-8000-000000000004",
		]);
		expect(fake.calls.map((call) => call.p_status)).toEqual([
			"open",
			null,
			"refunded",
			"dismissed",
		]);
		expect(
			fake.calls.every((call) => call.fn === "manager_payment_exceptions"),
		).toBe(true);
		expect(fake.calls.every((call) => call.p_store === "s")).toBe(true);
		// the merged list keeps the limit
		const two = await exceptionsFor(fake.client, "s", "resolved", 2);
		expect(two.exceptions).toHaveLength(2);
	});

	it("orders by the time received, then the id, as the server does", () => {
		const a = { id: "a", received_at: "2026-11-28T07:00:00Z" };
		const b = { id: "b", received_at: "2026-11-28T07:00:00Z" };
		const later = { id: "c", received_at: "2026-11-28T07:00:01Z" };
		expect([b, a, later].sort(newestFirst).map((row) => row.id)).toEqual([
			"c",
			"a",
			"b",
		]);
	});
});
