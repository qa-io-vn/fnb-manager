import { describe, expect, it } from "vitest";
import { RpcError } from "../lib/rpc";
import {
	accountWords,
	checkNote,
	exceptionsFor,
	failureKey,
	mayHoldMore,
	methodKey,
	NOTE_MAX,
	noteProblemWords,
	openCount,
	queryOf,
	readPaymentException,
	readPaymentExceptions,
	readReceivingAccount,
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
//   unparsable time, no list or open count, a name or an account of the wrong shape, an account of an unknown scope);
//   an answer from before the server named the resolver and the account reads them as unknown; the kinds, the
//   providers, the statuses and the receiving account in words (a store's bank account, the brand's, a wallet), an
//   unknown one in general;
// - boundary values of the note as the server counts it (code points after trimming): empty, blank, 1, 200, 201, 200
//   astral characters; one line: C0, DEL and C1 refused, U+2028 and a zero-width space taken (PostgreSQL's
//   [[:cntrl:]]); the list's limit at 99 and 100;
// - decision table of a resolution's answer: the state equal to or other than the choice × replayed × refusal; of who
//   resolved it: open (never named), resolved with the server's name (an owner's too), resolved without one;
// - state transitions: only an open exception is resolvable; each filter is one call (open, resolved, all as null);
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
	resolved_by_name: null,
	resolution_note: null,
	account: { scope: "store", bank_name: "Ngân hàng mẫu", account_tail: "6789" },
};

const REFUNDED = {
	...OPEN,
	id: "77777777-0000-4000-8000-000000000002",
	reason: "duplicate",
	amount: 29_000,
	status: "refunded",
	resolved_at: "2026-11-28T08:00:00+00:00",
	resolved_by: "88888888-0000-4000-8000-000000000001",
	resolved_by_name: "Chủ quán mẫu",
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
			{ ...REFUNDED, resolved_by_name: 42 },
			{ ...OPEN, account: "store" },
			{
				...OPEN,
				account: { scope: "tenant", bank_name: null, account_tail: null },
			},
			{
				...OPEN,
				account: { bank_name: "Ngân hàng mẫu", account_tail: "6789" },
			},
			{
				...OPEN,
				account: { scope: "store", bank_name: 970400, account_tail: null },
			},
			{
				...OPEN,
				account: { scope: "store", bank_name: null, account_tail: 6789 },
			},
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

	it("reads an answer from before the server named the resolver and the account as unknown (backward compatible)", () => {
		const { resolved_by_name: _name, account: _account, ...earlier } = REFUNDED;
		expect(readPaymentException(earlier)).toEqual({
			...REFUNDED,
			resolved_by_name: null,
			account: null,
		});
		expect(readReceivingAccount(null)).toBeNull();
		expect(readReceivingAccount(undefined)).toBeNull();
		expect(
			readReceivingAccount({
				scope: "brand",
				bank_name: null,
				account_tail: null,
			}),
		).toEqual({ scope: "brand", bank_name: null, account_tail: null });
	});

	it("keeps markup, control characters and a long reference as plain text (error guessing)", () => {
		const odd = readPaymentException({
			...REFUNDED,
			reference: `FNB${"X".repeat(300)}<b>`,
			order_no: '<img src=x onerror="alert(1)">',
			resolution_note: "<script>alert(1)</script>\u0007",
			resolved_by_name: "<b>Chủ</b>",
			account: {
				scope: "store",
				bank_name: "<i>Ngân hàng</i>",
				account_tail: "<u>",
			},
		});
		expect(odd.reference).toBe(`FNB${"X".repeat(300)}<b>`);
		expect(odd.order_no).toBe('<img src=x onerror="alert(1)">');
		expect(odd.resolution_note).toBe("<script>alert(1)</script>\u0007");
		expect(odd.resolved_by_name).toBe("<b>Chủ</b>");
		expect(accountWords(odd.account)?.label).toBe("<i>Ngân hàng</i> ···<u>");
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
	it("names whom the server names, an owner too; nobody while open or when the server knows no name", () => {
		expect(
			resolverName({ status: "open", resolved_by_name: "Quản lý mẫu" }),
		).toBeNull();
		expect(
			resolverName({ status: "refunded", resolved_by_name: "Quản lý mẫu" }),
		).toBe("Quản lý mẫu");
		expect(
			resolverName({ status: "dismissed", resolved_by_name: "Chủ quán mẫu" }),
		).toBe("Chủ quán mẫu");
		expect(
			resolverName({ status: "dismissed", resolved_by_name: null }),
		).toBeNull();
	});
});

describe("the receiving account in words (EP)", () => {
	it("words a store's bank account, the brand's, a wallet and a bank without its digits", () => {
		expect(
			accountWords({
				scope: "store",
				bank_name: "Ngân hàng mẫu",
				account_tail: "6789",
			}),
		).toEqual({
			label: "Ngân hàng mẫu ···6789",
			scopeKey: "paymentExceptions.scope.store",
		});
		expect(
			accountWords({
				scope: "brand",
				bank_name: "Ngân hàng chung",
				account_tail: "3210",
			}),
		).toEqual({
			label: "Ngân hàng chung ···3210",
			scopeKey: "paymentExceptions.scope.brand",
		});
		// a wallet: the page words the provider instead of a bank
		expect(
			accountWords({ scope: "brand", bank_name: null, account_tail: null }),
		).toEqual({ label: null, scopeKey: "paymentExceptions.scope.brand" });
		expect(
			accountWords({
				scope: "store",
				bank_name: "Ngân hàng mẫu",
				account_tail: null,
			})?.label,
		).toBe("Ngân hàng mẫu");
		// nothing said: no line
		expect(accountWords(null)).toBeNull();
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
		const dismissed = {
			...REFUNDED,
			id: "77777777-0000-4000-8000-000000000003",
			status: "dismissed",
			received_at: "2026-11-28T06:00:00Z",
		};
		const answers: Record<string, unknown> = {
			open: { open: 1, exceptions: [OPEN] },
			all: { open: 1, exceptions: [REFUNDED, OPEN] },
			// the server merges both resolutions newest first under the limit
			resolved: { open: 1, exceptions: [REFUNDED, dismissed] },
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

	it("maps each filter to what the server filters by", () => {
		expect(queryOf("open")).toBe("open");
		expect(queryOf("resolved")).toBe("resolved");
		expect(queryOf("all")).toBeNull();
	});

	it("asks once per filter: open, resolved (both resolutions, as the server orders them) and all (null)", async () => {
		const fake = fakeClient();
		expect((await exceptionsFor(fake.client, "s", "open")).exceptions).toEqual([
			OPEN,
		]);
		const resolved = await exceptionsFor(fake.client, "s", "resolved");
		expect(resolved.open).toBe(1);
		expect(resolved.exceptions.map((exception) => exception.id)).toEqual([
			REFUNDED.id,
			"77777777-0000-4000-8000-000000000003",
		]);
		expect(
			(await exceptionsFor(fake.client, "s", "all")).exceptions.map(
				(e) => e.id,
			),
		).toEqual([REFUNDED.id, OPEN.id]);
		expect(fake.calls.map((call) => call.p_status)).toEqual([
			"open",
			"resolved",
			null,
		]);
		expect(
			fake.calls.every((call) => call.fn === "manager_payment_exceptions"),
		).toBe(true);
		expect(fake.calls.every((call) => call.p_store === "s")).toBe(true);
		// the limit goes to the server, which keeps it on the merged list
		await exceptionsFor(fake.client, "s", "resolved", 2);
		expect(fake.calls.at(-1)).toMatchObject({
			p_status: "resolved",
			p_limit: 2,
		});
	});
});
