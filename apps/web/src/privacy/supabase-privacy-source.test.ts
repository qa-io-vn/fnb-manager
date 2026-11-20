import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SettingsWriteError } from "../settings/source";
import { DELETION_TABLES, PREVIEW_TABLES } from "./source";
import {
	createSupabasePrivacySource,
	DSR_CORRECT_FUNCTION,
	DSR_DELETE_FUNCTION,
	DSR_DUE_SOON_FUNCTION,
	DSR_EXPORT_FUNCTION,
	DSR_LOOKUP_FUNCTION,
	DSR_PREVIEW_FUNCTION,
} from "./supabase-privacy-source";

interface Answer {
	data: unknown;
	error: { code?: string; message?: string } | null;
}

function clientWith(answers: { rpc?: Answer; table?: Answer }) {
	const rpc = vi.fn(async () => answers.rpc ?? { data: [], error: null });
	const chain: Record<string, unknown> = Promise.resolve(
		answers.table ?? { data: [], error: null },
	) as unknown as Record<string, unknown>;
	const calls: { method: string; args: unknown[] }[] = [];
	for (const method of [
		"select",
		"insert",
		"update",
		"eq",
		"in",
		"is",
		"order",
		"limit",
	]) {
		chain[method] = (...args: unknown[]) => {
			calls.push({ method, args });
			return chain;
		};
	}
	const from = vi.fn(() => chain);
	return {
		client: { rpc, from } as unknown as SupabaseClient,
		rpc,
		from,
		calls,
	};
}

const SUBJECT_ROW = {
	customer_id: "c1",
	tenant_id: "t1",
	name: "Khách",
	phone_masked: "•••• ••• 101",
	first_seen_at: "2026-10-01T02:00:00Z",
	memberships: 1,
	ledger_entries: "4",
	stamp_total: 5,
	point_total: 120,
	consents: [
		{
			id: "k1",
			purpose: "marketing",
			channel: "mini_app",
			policy_version: "v1",
			granted_at: "2026-11-01T02:00:00Z",
			revoked_at: null,
			active: true,
		},
	],
	messages: 2,
	open_requests: 1,
};

describe("the Supabase privacy source", () => {
	it("looks a customer up with the phone in the RPC body only and maps the summary", async () => {
		const { client, rpc } = clientWith({
			rpc: { data: [SUBJECT_ROW], error: null },
		});
		const rows =
			await createSupabasePrivacySource(client).lookupSubjects("0900016101");
		expect(rpc).toHaveBeenCalledWith(DSR_LOOKUP_FUNCTION, {
			p_phone: "0900016101",
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			customerId: "c1",
			phoneMasked: "•••• ••• 101",
			ledgerEntries: 4,
			openRequests: 1,
		});
		expect(rows[0]?.consents[0]).toMatchObject({
			purpose: "marketing",
			active: true,
		});
		expect(JSON.stringify(rows)).not.toContain("0900016101");
	});

	it("refuses a summary with an unknown consent purpose", async () => {
		const { client } = clientWith({
			rpc: {
				data: [
					{
						...SUBJECT_ROW,
						consents: [{ ...SUBJECT_ROW.consents[0], purpose: "sale" }],
					},
				],
				error: null,
			},
		});
		await expect(
			createSupabasePrivacySource(client).lookupSubjects("0900016101"),
		).rejects.toThrow();
	});

	it("reads the due rows from dsr_due_soon", async () => {
		const { client, rpc } = clientWith({
			rpc: {
				data: [
					{
						request_id: "r1",
						request_type: "access",
						first_response_state: "overdue",
						completion_state: "on_track",
					},
				],
				error: null,
			},
		});
		const rows = await createSupabasePrivacySource(client).dueSoon(3);
		expect(rpc).toHaveBeenCalledWith(DSR_DUE_SOON_FUNCTION, { p_days: 3 });
		expect(rows).toEqual([
			{
				requestId: "r1",
				requestType: "access",
				firstResponseState: "overdue",
				completionState: "on_track",
			},
		]);
	});

	it("exports through dsr_export and refuses a shape that is not an export", async () => {
		const { client, rpc } = clientWith({
			rpc: { data: { counts: {} }, error: null },
		});
		await expect(
			createSupabasePrivacySource(client).exportSubject("r1"),
		).rejects.toThrow();
		expect(rpc).toHaveBeenCalledWith(DSR_EXPORT_FUNCTION, {
			p_request_id: "r1",
		});
	});

	it("corrects only the name and maps the answer without any value", async () => {
		const { client, rpc } = clientWith({
			rpc: {
				data: {
					request_id: "r1",
					field: "name",
					changed: true,
					status: "in_progress",
				},
				error: null,
			},
		});
		const result = await createSupabasePrivacySource(client).correctName(
			"r1",
			"Tên mới",
		);
		expect(rpc).toHaveBeenCalledWith(DSR_CORRECT_FUNCTION, {
			p_request_id: "r1",
			p_field: "name",
			p_value: "Tên mới",
		});
		expect(result).toEqual({ changed: true, status: "in_progress" });
	});

	it("reads the deletion preview, one count per table", async () => {
		const answer = Object.fromEntries(
			PREVIEW_TABLES.map((table, index) => [table, index === 0 ? "1" : index]),
		);
		const { client, rpc } = clientWith({ rpc: { data: answer, error: null } });
		const counts =
			await createSupabasePrivacySource(client).deletionPreview("r1");
		expect(rpc).toHaveBeenCalledWith(DSR_PREVIEW_FUNCTION, {
			p_request_id: "r1",
		});
		expect(counts.memberships).toBe(1);
		expect(counts.loyalty_ledger).toBe(1);
		expect(Object.keys(counts).sort()).toEqual([...PREVIEW_TABLES].sort());
	});

	it("refuses a preview that misses a table", async () => {
		const { client } = clientWith({
			rpc: { data: { memberships: 1 }, error: null },
		});
		await expect(
			createSupabasePrivacySource(client).deletionPreview("r1"),
		).rejects.toThrow();
	});

	it("deletes through dsr_delete and returns the counts logged by the database", async () => {
		const counts = Object.fromEntries(
			DELETION_TABLES.map((table, index) => [table, index]),
		);
		const { client, rpc } = clientWith({
			rpc: {
				data: {
					already_done: false,
					counts,
					responded_on_time: true,
					completed_on_time: false,
				},
				error: null,
			},
		});
		const result =
			await createSupabasePrivacySource(client).deleteSubject("r1");
		expect(rpc).toHaveBeenCalledWith(DSR_DELETE_FUNCTION, {
			p_request_id: "r1",
		});
		expect(result.completedOnTime).toBe(false);
		expect(result.counts.customers).toBe(DELETION_TABLES.indexOf("customers"));
	});

	it("refuses a deletion answer that misses a table", async () => {
		const { client } = clientWith({
			rpc: {
				data: {
					already_done: false,
					counts: { customers: 1 },
					responded_on_time: true,
					completed_on_time: true,
				},
				error: null,
			},
		});
		await expect(
			createSupabasePrivacySource(client).deleteSubject("r1"),
		).rejects.toThrow();
	});

	it("maps database errors to write codes (equivalence by SQLSTATE)", async () => {
		for (const [code, expected] of [
			["42501", "forbidden"],
			["22023", "invalid"],
			["23514", "invalid"],
		] as const) {
			const { client } = clientWith({
				rpc: { data: null, error: { code, message: "refused" } },
			});
			await expect(
				createSupabasePrivacySource(client).deleteSubject("r1"),
			).rejects.toMatchObject({ code: expected });
		}
	});

	it("reports a thrown network failure as a network error", async () => {
		const client = {
			rpc: vi.fn(async () => {
				throw new Error("offline");
			}),
		} as unknown as SupabaseClient;
		await expect(
			createSupabasePrivacySource(client).deleteSubject("r1"),
		).rejects.toEqual(new SettingsWriteError("network"));
	});

	it("revokes a consent by id, only while it is active, and refuses when no row changed", async () => {
		const ok = clientWith({ table: { data: [{ id: "k1" }], error: null } });
		await createSupabasePrivacySource(ok.client).revokeConsent("k1");
		expect(ok.from).toHaveBeenCalledWith("consent_records");
		expect(ok.calls.find((call) => call.method === "eq")?.args).toEqual([
			"id",
			"k1",
		]);
		expect(ok.calls.find((call) => call.method === "is")?.args).toEqual([
			"revoked_at",
			null,
		]);
		const none = clientWith({ table: { data: [], error: null } });
		await expect(
			createSupabasePrivacySource(none.client).revokeConsent("k1"),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("records a customer request with the subject and without a phone", async () => {
		const row = {
			id: "r1",
			subject_type: "customer",
			subject_id: "c1",
			contact: "khach@example.com",
			request_type: "export",
			received_at: "2026-11-20T03:00:00Z",
			uses_processor: true,
			first_response_due_at: "2026-11-24T03:00:00Z",
			completion_due_at: "2026-12-20T03:00:00Z",
			status: "received",
			responded_at: null,
			completed_at: null,
			notes: null,
		};
		const { client, calls } = clientWith({
			table: { data: [row], error: null },
		});
		const recorded = await createSupabasePrivacySource(client).recordRequest(
			"t1",
			{
				requestType: "export",
				subjectId: "c1",
				contact: "khach@example.com",
				usesProcessor: true,
				notes: null,
			},
		);
		expect(calls.find((call) => call.method === "insert")?.args[0]).toEqual({
			tenant_id: "t1",
			subject_type: "customer",
			subject_id: "c1",
			contact: "khach@example.com",
			request_type: "export",
			uses_processor: true,
			notes: null,
		});
		expect(recorded.status).toBe("received");
	});

	it("closes only an open request and refuses when nothing changed", async () => {
		const ok = clientWith({ table: { data: [{ id: "r1" }], error: null } });
		await createSupabasePrivacySource(ok.client).closeRequest({
			requestId: "r1",
			status: "completed",
			notes: "xong",
		});
		expect(ok.calls.find((call) => call.method === "in")?.args).toEqual([
			"status",
			["received", "in_progress"],
		]);
		const none = clientWith({ table: { data: [], error: null } });
		await expect(
			createSupabasePrivacySource(none.client).closeRequest({
				requestId: "r1",
				status: "rejected",
				notes: null,
			}),
		).rejects.toMatchObject({ code: "forbidden" });
	});
});
