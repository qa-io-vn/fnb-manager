import { describe, expect, it } from "vitest";
import { fixedClock } from "../../src/pack/clock.js";
import {
	type DataPackRequest,
	DEFAULT_HORIZON,
	FOCUS_MAX_LENGTH,
	OWNER_NOTE_MAX_LENGTH,
} from "../../src/pack/request.js";
import { normalizeRequestText } from "../../src/pack/request-text.js";
import {
	checkPackRequest,
	resolvePackRequest,
	type StoreProfileRow,
} from "../../src/pack/resolve.js";

const STORE_A = "22222222-2222-4222-8222-000000000001";
const STORE_B = "22222222-2222-4222-8222-000000000002";
const NOW = fixedClock("2026-11-12T03:00:00Z").now();

function request(overrides: Partial<DataPackRequest> = {}): DataPackRequest {
	return {
		storeIds: [STORE_B, STORE_A],
		asOf: null,
		horizon: DEFAULT_HORIZON,
		language: "vi",
		focus: null,
		ownerNote: null,
		sample: false,
		...overrides,
	};
}

function profile(
	storeId: string,
	label: string,
	overrides: Partial<StoreProfileRow> = {},
): StoreProfileRow {
	return {
		store_id: storeId,
		tenant_id: "11111111-1111-4111-8111-111111111111",
		label,
		name: `Store ${label}`,
		timezone: "Asia/Ho_Chi_Minh",
		business_day_start_minutes: 0,
		opened_on: "2025-01-01",
		opening_hours: null,
		seat_count: null,
		e_invoice_status: "unknown",
		currency_code: "VND",
		country_code: "VN",
		...overrides,
	};
}

const PROFILES = [profile(STORE_B, "S2"), profile(STORE_A, "S1")];

describe("the pack request", () => {
	it("takes 1 to 10 distinct stores, UUIDs in a live pack and MOCK ids in a sample", () => {
		expect(() =>
			checkPackRequest(request({ storeIds: [] }), "supabase"),
		).toThrow(/^pack_stores_invalid: /);
		const eleven = Array.from(
			{ length: 11 },
			(_, index) =>
				`22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
		);
		expect(() =>
			checkPackRequest(request({ storeIds: eleven }), "supabase"),
		).toThrow(/^pack_stores_invalid: /);
		expect(
			checkPackRequest(request({ storeIds: eleven.slice(0, 10) }), "supabase")
				.storeIds,
		).toHaveLength(10);
		expect(() =>
			checkPackRequest(request({ storeIds: [STORE_A, STORE_A] }), "supabase"),
		).toThrow(/^pack_stores_invalid: /);
		expect(() =>
			checkPackRequest(request({ storeIds: ["MOCK-S1"] }), "supabase"),
		).toThrow(/^pack_stores_invalid: /);
		expect(() =>
			checkPackRequest(request({ storeIds: [STORE_A], sample: true }), "demo"),
		).toThrow(/^pack_stores_invalid: /);
		expect(
			checkPackRequest(
				request({ storeIds: ["MOCK-S2", "MOCK-S1"], sample: true }),
				"demo",
			).storeIds,
		).toEqual(["MOCK-S2", "MOCK-S1"]);
	});

	it("is a sample exactly when the demo source builds it", () => {
		expect(() =>
			checkPackRequest(request({ sample: true }), "supabase"),
		).toThrow(/^pack_invalid: /);
		expect(() =>
			checkPackRequest(
				request({ storeIds: ["MOCK-S1"], sample: false }),
				"demo",
			),
		).toThrow(/^pack_invalid: /);
		expect(checkPackRequest(request(), "postgres").sample).toBe(false);
	});

	it("refuses an unknown horizon, language or as-of day", () => {
		expect(() =>
			checkPackRequest(request({ horizon: "7d" as never }), "supabase"),
		).toThrow(/^pack_invalid: /);
		expect(() =>
			checkPackRequest(request({ language: "fr" as never }), "supabase"),
		).toThrow(/^pack_invalid: /);
		expect(() =>
			checkPackRequest(request({ asOf: "2026-02-30" }), "supabase"),
		).toThrow(/^pack_invalid: /);
	});

	it("orders the stores by label, takes labels and currency from SQL and defaults the as-of day", () => {
		const resolved = resolvePackRequest(
			checkPackRequest(request(), "supabase"),
			PROFILES,
			NOW,
		);
		expect(resolved.request.stores).toEqual([
			{ id: STORE_A, label: "S1" },
			{ id: STORE_B, label: "S2" },
		]);
		expect(resolved.request.asOf).toBe("2026-11-11");
		expect(resolved.request.currency).toBe("VND");
		expect(resolved.country).toBe("VN");
		expect(resolved.profiles.map((row) => row.label)).toEqual(["S1", "S2"]);
	});

	it("takes the earliest complete business day over the stores as the default", () => {
		const resolved = resolvePackRequest(
			checkPackRequest(request(), "supabase"),
			[
				profile(STORE_A, "S1", { timezone: "America/Los_Angeles" }),
				profile(STORE_B, "S2"),
			],
			NOW,
		);
		expect(resolved.request.asOf).toBe("2026-11-10");
	});

	it("allows an earlier as-of day and refuses a later one", () => {
		const checked = (asOf: string) =>
			resolvePackRequest(
				checkPackRequest(request({ asOf }), "supabase"),
				PROFILES,
				NOW,
			);
		expect(checked("2026-10-01").request.asOf).toBe("2026-10-01");
		expect(checked("2026-11-11").request.asOf).toBe("2026-11-11");
		expect(() => checked("2026-11-12")).toThrow(/^pack_as_of_not_complete: /);
	});

	it("refuses a store the session cannot see and stores of two tenants", () => {
		const checked = checkPackRequest(request(), "supabase");
		expect(() =>
			resolvePackRequest(checked, [PROFILES[0] as StoreProfileRow], NOW),
		).toThrow(/^pack_stores_invalid: /);
		expect(() =>
			resolvePackRequest(
				checked,
				[
					profile(STORE_A, "S1"),
					profile(STORE_B, "S2", {
						tenant_id: "33333333-3333-4333-8333-333333333333",
					}),
				],
				NOW,
			),
		).toThrow(/^pack_stores_invalid: /);
	});
});

describe("the typed texts of a request", () => {
	it("normalises to NFC, collapses runs of whitespace and trims", () => {
		const decomposed = "Tăng  doanh\tthu\n\n buổi chiều ".normalize("NFD");
		expect(normalizeRequestText(decomposed, "focus", FOCUS_MAX_LENGTH)).toBe(
			"Tăng doanh thu buổi chiều",
		);
		expect(
			normalizeRequestText("   \n ", "focus", FOCUS_MAX_LENGTH),
		).toBeNull();
		expect(normalizeRequestText(null, "focus", FOCUS_MAX_LENGTH)).toBeNull();
		const checked = checkPackRequest(
			request({ focus: " Ca  sáng ", ownerNote: "Mở thêm\r\nquầy" }),
			"supabase",
		);
		expect(checked.focus).toBe("Ca sáng");
		expect(checked.ownerNote).toBe("Mở thêm quầy");
	});

	it("counts characters after normalising and refuses longer texts", () => {
		const letter = "ế".normalize("NFD");
		expect(
			normalizeRequestText(
				letter.repeat(FOCUS_MAX_LENGTH),
				"focus",
				FOCUS_MAX_LENGTH,
			),
		).toHaveLength(FOCUS_MAX_LENGTH);
		expect(() =>
			checkPackRequest(
				request({ focus: "a".repeat(FOCUS_MAX_LENGTH + 1) }),
				"supabase",
			),
		).toThrow(/^pack_text_too_long: /);
		expect(
			checkPackRequest(
				request({ ownerNote: "b".repeat(OWNER_NOTE_MAX_LENGTH) }),
				"supabase",
			).ownerNote,
		).toHaveLength(OWNER_NOTE_MAX_LENGTH);
		expect(() =>
			checkPackRequest(
				request({ ownerNote: "b".repeat(OWNER_NOTE_MAX_LENGTH + 1) }),
				"supabase",
			),
		).toThrow(/^pack_text_too_long: /);
	});

	it("refuses an e-mail address or a phone number", () => {
		for (const text of [
			"Gửi kết quả cho chu.quan@example.com",
			"Gọi 0901 234 567 khi xong",
			"Liên hệ +84 90 123 4567",
		]) {
			expect(() =>
				checkPackRequest(request({ focus: text }), "supabase"),
			).toThrow(/^pack_text_contact_details: /);
			expect(() =>
				checkPackRequest(request({ ownerNote: text }), "supabase"),
			).toThrow(/^pack_text_contact_details: /);
		}
		expect(
			checkPackRequest(
				request({ focus: "Tăng 15 % doanh thu sau 17:00" }),
				"supabase",
			).focus,
		).toBe("Tăng 15 % doanh thu sau 17:00");
	});
});
