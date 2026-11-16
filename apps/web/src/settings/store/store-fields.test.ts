import { describe, expect, it } from "vitest";
import { setDayOpen } from "../forms/opening-hours";
import type { StoreProfile, TenantProfile } from "../source";
import {
	businessDayStartText,
	readStoreDraft,
	storeDraftOf,
	tenantChangeOf,
	touchesOpeningHours,
} from "./store-fields";

const LOCALE = "vi-VN";
const TODAY = "2026-11-16";

const PROFILE: StoreProfile = {
	storeId: "store-1",
	posAccountId: "account-1",
	name: "Cửa hàng thử",
	address: null,
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	code: "E1 ",
	openingHours: { mon: [["7:00", "22:00"]] },
	seatCount: 1_200,
	openedOn: "2024-12-02",
	eInvoiceStatus: "unknown",
	tranNoResetPeriod: "unknown",
	memberCaptureStatus: "unknown",
	audit: null,
};

function read(edit: (draft: ReturnType<typeof storeDraftOf>) => object) {
	const saved = storeDraftOf(PROFILE, LOCALE);
	return readStoreDraft(
		PROFILE,
		saved,
		{ ...saved, ...edit(saved) },
		LOCALE,
		TODAY,
	);
}

describe("the store profile draft", () => {
	it("shows the saved profile in the inputs' own formats", () => {
		const draft = storeDraftOf(PROFILE, LOCALE);
		expect(draft.code).toBe("E1 ");
		expect(draft.seatCount).toBe("1.200");
		expect(draft.openingHours.mon).toEqual([{ open: "07:00", close: "22:00" }]);
		expect(draft.openingHours.tue).toEqual([]);
	});

	it("sends nothing while the inputs say what is saved", () => {
		expect(read(() => ({}))).toEqual({
			changes: {},
			changed: [],
			issues: {},
			hoursInvalid: false,
		});
		expect(read(() => ({ code: "E1", seatCount: "1200" })).changed).toEqual([]);
	});

	it("sends only the fields that changed, in the form's order", () => {
		const reading = read((saved) => ({
			memberCaptureStatus: "enabled",
			seatCount: "",
			code: " Q1 ",
			openingHours: setDayOpen(saved.openingHours, "sun", true),
		}));
		expect(reading.changed).toEqual([
			"code",
			"seatCount",
			"openingHours",
			"memberCaptureStatus",
		]);
		expect(reading.changes).toEqual({
			code: "Q1",
			seatCount: null,
			openingHours: {
				mon: [["07:00", "22:00"]],
				tue: [],
				wed: [],
				thu: [],
				fri: [],
				sat: [],
				sun: [["07:00", "22:00"]],
			},
			memberCaptureStatus: "enabled",
		});
		expect(touchesOpeningHours({ change: reading.changes ?? {} })).toBe(true);
		expect(touchesOpeningHours({ change: { seatCount: 3 } })).toBe(false);
	});

	it("holds the save back while a changed field has a problem", () => {
		const reading = read(() => ({
			seatCount: "5.001",
			openedOn: "1999-01-01",
		}));
		expect(reading.changes).toBeNull();
		expect(reading.issues).toEqual({
			openedOn: { key: "dateRange", min: "2000-01-01", max: "2027-12-31" },
			seatCount: { key: "range", min: 0, max: 5_000 },
		});
	});

	it("holds the save back while an opening span is incomplete", () => {
		const reading = read((saved) => ({
			openingHours: {
				...saved.openingHours,
				tue: [{ open: "08:00", close: "" }],
			},
		}));
		expect(reading.changes).toBeNull();
		expect(reading.hoursInvalid).toBe(true);
		expect(reading.changed).toEqual(["openingHours"]);
	});

	it("clears the opening date and the hours as null", () => {
		const reading = read((saved) => ({
			openedOn: "",
			openingHours: setDayOpen(saved.openingHours, "mon", false),
		}));
		expect(reading.changes).toEqual({ openedOn: null, openingHours: null });
	});
});

describe("the tenant profile change", () => {
	const profile: TenantProfile = {
		legalForm: "unknown",
		defaultLanguage: "vi",
		audit: null,
	};

	it("holds only what differs from the saved profile", () => {
		expect(tenantChangeOf(profile, { ...profile })).toEqual({});
		expect(
			tenantChangeOf(profile, {
				legalForm: "household_business",
				defaultLanguage: "vi",
			}),
		).toEqual({ legalForm: "household_business" });
		expect(
			tenantChangeOf(profile, { legalForm: "unknown", defaultLanguage: "en" }),
		).toEqual({ defaultLanguage: "en" });
	});
});

describe("businessDayStartText", () => {
	it("writes the day start as a clock time", () => {
		expect(businessDayStartText(0)).toBe("00:00");
		expect(businessDayStartText(90)).toBe("01:30");
		expect(businessDayStartText(240)).toBe("04:00");
	});
});
