import { describe, expect, it } from "vitest";
import type { Membership, StoreProfile } from "../source";
import type { StaffMember } from "./source";
import { staffAppLink, staffAppsByStore } from "./staff-app-links";
import {
	readStaffDraft,
	rosterInOrder,
	sameStaffChange,
	staffChangeProblem,
	staffDraftOf,
	staffErrorKey,
	staffNameIssue,
	staffStoreChoices,
	storeNamesOf,
} from "./staff-rules";

const STORE_1 = "11111111-1111-4111-8111-111111111111";
const STORE_2 = "22222222-2222-4222-8222-222222222222";

function profile(storeId: string, name: string, code: string | null) {
	return {
		storeId,
		posAccountId: "account",
		name,
		address: null,
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
		code,
		openingHours: null,
		seatCount: null,
		openedOn: null,
		eInvoiceStatus: "unknown",
		tranNoResetPeriod: "unknown",
		memberCaptureStatus: "unknown",
		audit: null,
	} as StoreProfile;
}

const PROFILES = [
	profile(STORE_1, "Cửa hàng thử 1", "E1"),
	profile(STORE_2, "Cửa hàng thử 2", null),
];

function member(role: Membership["role"], storeIds: string[] | null) {
	return { role, storeIds } satisfies Membership;
}

function staff(overrides: Partial<StaffMember>): StaffMember {
	return {
		id: "row",
		displayName: "Nhân viên 1",
		role: "staff",
		storeIds: [STORE_1],
		status: "invited",
		paired: false,
		pairedAt: null,
		phoneHint: null,
		deactivatedAt: null,
		audit: null,
		...overrides,
	};
}

describe("staffNameIssue", () => {
	it("asks for a name of 1 to 100 characters once composed and trimmed, without control characters", () => {
		expect(staffNameIssue("   ")).toEqual({
			kind: "validation",
			issue: { key: "required" },
		});
		expect(staffNameIssue("x".repeat(101))).toEqual({
			kind: "validation",
			issue: { key: "textLength", max: 100 },
		});
		expect(staffNameIssue(`  ${"ệ".repeat(100)}  `)).toBeNull();
		expect(staffNameIssue("ệ".repeat(100))).toBeNull();
		expect(staffNameIssue("Nhân\tviên")).toEqual({ kind: "control" });
	});
});

describe("staffStoreChoices", () => {
	it("offers every store and all stores to an owner or manager with every store", () => {
		for (const role of ["owner", "manager"] as const) {
			const choices = staffStoreChoices(member(role, null), PROFILES);
			expect(choices.allStores).toBe(true);
			expect(choices.stores.map((store) => store.storeId)).toEqual([
				STORE_1,
				STORE_2,
			]);
		}
	});

	it("offers a store-limited manager only the stores in their scope and never all stores", () => {
		const choices = staffStoreChoices(member("manager", [STORE_1]), PROFILES);
		expect(choices.allStores).toBe(false);
		expect(choices.stores.map((store) => store.storeId)).toEqual([STORE_1]);
	});

	it("offers nothing to staff, viewers, publishers or while the membership loads", () => {
		for (const membership of [
			member("staff", null),
			member("viewer", null),
			member("publisher", null),
			undefined,
			null,
		]) {
			const choices = staffStoreChoices(membership, PROFILES);
			expect(choices).toEqual({ allStores: false, stores: [] });
		}
	});
});

describe("readStaffDraft", () => {
	const unlimited = staffStoreChoices(member("owner", null), PROFILES);
	const limited = staffStoreChoices(member("manager", [STORE_1]), PROFILES);

	it("starts a new person as staff, with the only store preselected for a one-store manager", () => {
		expect(staffDraftOf(null, unlimited)).toEqual({
			name: "",
			role: "staff",
			allStores: false,
			storeIds: [],
		});
		expect(staffDraftOf(null, limited).storeIds).toEqual([STORE_1]);
	});

	it("sends the composed, trimmed name, the role and the chosen stores in the list's order", () => {
		expect(
			readStaffDraft(
				{
					name: "  Nhân viên 4 ",
					role: "manager",
					allStores: false,
					storeIds: [STORE_2, STORE_1],
				},
				unlimited,
			).change,
		).toEqual({
			displayName: "Nhân viên 4",
			role: "manager",
			storeIds: [STORE_1, STORE_2],
		});
	});

	it("sends all stores as null, but only for a member who may grant it", () => {
		const draft = {
			name: "Nhân viên 4",
			role: "staff" as const,
			allStores: true,
			storeIds: [],
		};
		expect(readStaffDraft(draft, unlimited).change?.storeIds).toBeNull();
		expect(readStaffDraft(draft, limited)).toMatchObject({
			storesIssue: true,
			change: null,
		});
	});

	it("drops a store outside the editor's scope and asks for at least one store", () => {
		const reading = readStaffDraft(
			{
				name: "Nhân viên 4",
				role: "staff",
				allStores: false,
				storeIds: [STORE_2],
			},
			limited,
		);
		expect(reading).toMatchObject({ storesIssue: true, change: null });
		expect(
			readStaffDraft(
				{
					name: "Nhân viên 4",
					role: "staff",
					allStores: false,
					storeIds: [STORE_1, STORE_2],
				},
				limited,
			).change?.storeIds,
		).toEqual([STORE_1]);
	});

	it("holds back a draft without a valid name", () => {
		expect(
			readStaffDraft(
				{ name: "", role: "staff", allStores: false, storeIds: [STORE_1] },
				unlimited,
			),
		).toMatchObject({
			nameIssue: { kind: "validation", issue: { key: "required" } },
			change: null,
		});
	});

	it("tells an unchanged edit apart, whatever the order of the stores", () => {
		const row = staff({ storeIds: [STORE_2, STORE_1] });
		expect(
			sameStaffChange(row, {
				displayName: "Nhân viên 1",
				role: "staff",
				storeIds: [STORE_1, STORE_2],
			}),
		).toBe(true);
		expect(
			sameStaffChange(row, {
				displayName: "Nhân viên 1",
				role: "manager",
				storeIds: [STORE_1, STORE_2],
			}),
		).toBe(false);
		expect(
			sameStaffChange(staff({ storeIds: null }), {
				displayName: "Nhân viên 1",
				role: "staff",
				storeIds: [STORE_1],
			}),
		).toBe(false);
	});
});

describe("staffChangeProblem", () => {
	const known = new Set([STORE_1, STORE_2]);

	it("refuses what the database refuses", () => {
		const valid = {
			displayName: "Nhân viên 1",
			role: "staff" as const,
			storeIds: [STORE_1],
		};
		expect(staffChangeProblem(valid, known)).toBeNull();
		expect(staffChangeProblem({ ...valid, storeIds: null }, known)).toBeNull();
		expect(staffChangeProblem({ ...valid, displayName: " x" }, known)).toBe(
			"displayName",
		);
		expect(staffChangeProblem({ ...valid, displayName: "" }, known)).toBe(
			"displayName",
		);
		expect(
			staffChangeProblem(
				{ ...valid, role: "owner" as unknown as "staff" },
				known,
			),
		).toBe("role");
		expect(staffChangeProblem({ ...valid, storeIds: [] }, known)).toBe(
			"storeIds",
		);
		expect(
			staffChangeProblem({ ...valid, storeIds: [STORE_1, STORE_1] }, known),
		).toBe("storeIds");
		expect(staffChangeProblem({ ...valid, storeIds: ["other"] }, known)).toBe(
			"storeIds",
		);
	});
});

describe("staffErrorKey", () => {
	it("names the scope for a refused add or edit and the row for a refused deactivation", () => {
		expect(staffErrorKey("add", "forbidden", "settings.error.forbidden")).toBe(
			"settings.staff.error.scope",
		);
		expect(staffErrorKey("update", "invalid", "settings.error.invalid")).toBe(
			"settings.staff.error.invalid",
		);
		expect(
			staffErrorKey("deactivate", "forbidden", "settings.error.forbidden"),
		).toBe("settings.staff.error.rowForbidden");
		expect(staffErrorKey("pairing", "invalid", "settings.error.invalid")).toBe(
			"settings.staff.pairing.error.invalid",
		);
		expect(
			staffErrorKey("pairing", "forbidden", "settings.error.forbidden"),
		).toBe("settings.staff.pairing.error.forbidden");
		expect(staffErrorKey("add", "network", "settings.error.network")).toBe(
			"settings.error.network",
		);
		expect(staffErrorKey("add", null, null)).toBeNull();
	});
});

describe("rosterInOrder and storeNamesOf", () => {
	it("lists the people still on the roster first, by name, and the deactivated last", () => {
		const rows = [
			staff({ id: "c", displayName: "Nhân viên 3", status: "inactive" }),
			staff({ id: "b", displayName: "Nhân viên 2", status: "active" }),
			staff({ id: "a", displayName: "Quản lý 1", status: "invited" }),
			staff({ id: "d", displayName: "Nhân viên 10", status: "invited" }),
		];
		expect(rosterInOrder(rows).map((row) => row.id)).toEqual([
			"b",
			"d",
			"a",
			"c",
		]);
	});

	it("names the stores of a row, all stores, and counts stores the member cannot see", () => {
		expect(storeNamesOf(null, PROFILES)).toEqual({
			all: true,
			names: [],
			others: 0,
		});
		expect(storeNamesOf([STORE_2, "hidden"], PROFILES)).toEqual({
			all: false,
			names: ["Cửa hàng thử 2"],
			others: 1,
		});
	});
});

describe("the staff app link", () => {
	it("opens the Mini App of the brand for the store code, encoded", () => {
		expect(staffAppLink("mock-staff-app", "E1")).toBe(
			"https://zalo.me/s/mock-staff-app/?store=E1",
		);
		expect(staffAppLink("mock-staff-app", "CH 1/2")).toBe(
			"https://zalo.me/s/mock-staff-app/?store=CH%201%2F2",
		);
	});

	it("gives each store the staff apps of the brands that cover it, with no link while the store has no code", () => {
		const apps = [
			{
				brandId: "brand-a",
				miniAppId: "mock-a",
				title: "Nhân viên A",
				storeIds: [STORE_1, STORE_2],
			},
			{
				brandId: "brand-b",
				miniAppId: "mock-b",
				title: "Nhân viên B",
				storeIds: ["elsewhere"],
			},
		];
		expect(
			staffAppsByStore(PROFILES, apps).map((entry) => ({
				store: entry.store.storeId,
				links: entry.entries.map((candidate) => candidate.link),
			})),
		).toEqual([
			{ store: STORE_1, links: ["https://zalo.me/s/mock-a/?store=E1"] },
			{ store: STORE_2, links: [null] },
		]);
		expect(staffAppsByStore(PROFILES, [])[0]?.entries).toEqual([]);
	});
});
