import { vi } from "vitest";
import { SettingsWriteError } from "../settings/source";
import {
	type ConsentRow,
	type DataRequestRow,
	DELETION_TABLES,
	type DeletionTable,
	type DueRow,
	EXPORT_TABLES,
	type PreviewTable,
	type PrivacySource,
	type SubjectSummary,
} from "./source";

export const TENANT_ID = "33333333-3333-4333-8333-333333333333";
export const CUSTOMER_ID = "cccccccc-0000-4000-8000-000000000001";
export const FULL_PHONE = "+84900016101";
export const LOCAL_PHONE = "0900016101";

export function consent(overrides: Partial<ConsentRow> = {}): ConsentRow {
	return {
		id: "dddddddd-0000-4000-8000-000000000001",
		purpose: "marketing",
		channel: "mini_app",
		policyVersion: "v1",
		grantedAt: "2026-11-01T02:00:00Z",
		revokedAt: null,
		active: true,
		...overrides,
	};
}

export function subject(
	overrides: Partial<SubjectSummary> = {},
): SubjectSummary {
	return {
		customerId: CUSTOMER_ID,
		tenantId: TENANT_ID,
		name: "Khách mẫu",
		phoneMasked: "•••• ••• 101",
		firstSeenAt: "2026-10-01T02:00:00Z",
		memberships: 1,
		ledgerEntries: 4,
		stampTotal: 5,
		pointTotal: 120,
		consents: [
			consent({
				id: "dddddddd-0000-4000-8000-000000000002",
				purpose: "loyalty",
			}),
			consent(),
		],
		messages: 2,
		openRequests: 1,
		...overrides,
	};
}

export function request(
	overrides: Partial<DataRequestRow> = {},
): DataRequestRow {
	return {
		id: "eeeeeeee-0000-4000-8000-000000000001",
		subjectType: "customer",
		subjectId: CUSTOMER_ID,
		contact: "khach@example.com",
		requestType: "access",
		receivedAt: "2026-11-18T02:00:00Z",
		usesProcessor: false,
		firstResponseDueAt: "2026-11-20T02:00:00Z",
		completionDueAt: "2026-12-08T02:00:00Z",
		status: "received",
		respondedAt: null,
		completedAt: null,
		notes: null,
		...overrides,
	};
}

export function zeroDeletionCounts(
	overrides: Partial<Record<DeletionTable, number>> = {},
): Record<DeletionTable, number> {
	return {
		...(Object.fromEntries(
			DELETION_TABLES.map((table) => [table, 0]),
		) as Record<DeletionTable, number>),
		...overrides,
	};
}

export interface FakePrivacy extends PrivacySource {
	readonly calls: string[];
	readonly store: { requests: DataRequestRow[]; subjects: SubjectSummary[] };
}

export interface FakePrivacyOptions {
	readonly subjects?: readonly SubjectSummary[];
	readonly requests?: readonly DataRequestRow[];
	readonly due?: readonly DueRow[];
	readonly failWith?: SettingsWriteError | null;
}

const PREVIEW: Record<PreviewTable, number> = {
	memberships: 1,
	loyalty_ledger: 4,
	stamps: 5,
	redemptions: 1,
	receipt_claims: 1,
	consent_records: 2,
	outbound_messages: 2,
	invoices_unlinked: 3,
};

/** An in-memory PrivacySource with the database's rules for the states the pages show. */
export function createFakePrivacy(
	options: FakePrivacyOptions = {},
): FakePrivacy {
	const calls: string[] = [];
	const store = {
		requests: [...(options.requests ?? [])],
		subjects: [...(options.subjects ?? [])],
	};
	const fail = () => {
		if (options.failWith) throw options.failWith;
	};
	const open = (row: DataRequestRow) =>
		row.status === "received" || row.status === "in_progress";
	const find = (id: string) => {
		const row = store.requests.find((candidate) => candidate.id === id);
		if (row === undefined) throw new SettingsWriteError("forbidden");
		return row;
	};
	const replace = (row: DataRequestRow) => {
		store.requests = store.requests.map((candidate) =>
			candidate.id === row.id ? row : candidate,
		);
	};
	return {
		calls,
		store,
		lookupSubjects: vi.fn(async (phone: string) => {
			calls.push("lookup");
			fail();
			return phone.replace(/\D/g, "").endsWith("900016101")
				? store.subjects
				: [];
		}),
		requests: vi.fn(async () => {
			calls.push("requests");
			fail();
			return store.requests;
		}),
		dueSoon: vi.fn(async () => {
			calls.push("dueSoon");
			fail();
			return [...(options.due ?? [])];
		}),
		recordRequest: vi.fn(async (_tenantId, change) => {
			calls.push("record");
			fail();
			const row = request({
				id: `eeeeeeee-0000-4000-8000-00000000${String(store.requests.length + 10).padStart(4, "0")}`,
				subjectId: change.subjectId,
				subjectType: "customer",
				contact: change.contact,
				requestType: change.requestType,
				usesProcessor: change.usesProcessor,
				notes: change.notes,
			});
			store.requests = [...store.requests, row];
			return row;
		}),
		closeRequest: vi.fn(async (closure) => {
			calls.push("close");
			fail();
			const row = find(closure.requestId);
			if (!open(row)) throw new SettingsWriteError("forbidden");
			replace({ ...row, status: closure.status, notes: closure.notes });
		}),
		exportSubject: vi.fn(async (requestId: string) => {
			calls.push("export");
			fail();
			const row = find(requestId);
			if (row.subjectId === null) throw new SettingsWriteError("invalid");
			if (row.status === "received") replace({ ...row, status: "in_progress" });
			const counts = Object.fromEntries(
				EXPORT_TABLES.map((table) => [table, 1]),
			) as Record<(typeof EXPORT_TABLES)[number], number>;
			return { counts, json: JSON.stringify({ request: { id: requestId } }) };
		}),
		correctName: vi.fn(async (requestId: string, name: string) => {
			calls.push("correct");
			fail();
			const row = find(requestId);
			if (row.requestType !== "correction") {
				throw new SettingsWriteError("invalid");
			}
			replace({ ...row, status: "in_progress" });
			return { changed: name !== "Khách mẫu", status: "in_progress" as const };
		}),
		deletionPreview: vi.fn(async (requestId: string) => {
			calls.push("preview");
			fail();
			find(requestId);
			return PREVIEW;
		}),
		deleteSubject: vi.fn(async (requestId: string) => {
			calls.push("delete");
			fail();
			const row = find(requestId);
			if (row.requestType !== "deletion") {
				throw new SettingsWriteError("invalid");
			}
			replace({ ...row, status: "completed" });
			return {
				alreadyDone: false,
				counts: zeroDeletionCounts({
					memberships: 1,
					loyalty_ledger: 4,
					consent_records: 2,
					customers: 1,
				}),
				respondedOnTime: true,
				completedOnTime: true,
			};
		}),
		revokeConsent: vi.fn(async (consentId: string) => {
			calls.push("revoke");
			fail();
			let found = false;
			store.subjects = store.subjects.map((candidate) => ({
				...candidate,
				consents: candidate.consents.map((row) => {
					if (row.id !== consentId || !row.active) return row;
					found = true;
					return { ...row, active: false, revokedAt: "2026-11-20T03:00:00Z" };
				}),
			}));
			if (!found) throw new SettingsWriteError("forbidden");
		}),
	};
}
