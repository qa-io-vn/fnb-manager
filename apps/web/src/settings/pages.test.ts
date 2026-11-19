import { describe, expect, it } from "vitest";
import { messageFiles } from "../i18n/catalog";
import { DEFAULT_SETTINGS_SLUG, SETTINGS_PAGES, settingsPageOf } from "./pages";

const settingsFile = messageFiles.find((file) => file.name === "settings");

function inSharedSettingsFile(key: string): boolean {
	return (
		settingsFile !== undefined &&
		Object.hasOwn(settingsFile.vi, key) &&
		Object.hasOwn(settingsFile.en, key)
	);
}

describe("SETTINGS_PAGES", () => {
	it("gives every page its own slug and id, and opens on Cửa hàng", () => {
		const slugs = SETTINGS_PAGES.map((page) => page.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(new Set(SETTINGS_PAGES.map((page) => page.id)).size).toBe(
			slugs.length,
		);
		expect(settingsPageOf(DEFAULT_SETTINGS_SLUG)?.id).toBe("store");
		expect(settingsPageOf("khong-co")).toBeNull();
		expect(settingsPageOf(undefined)).toBeNull();
	});

	it("builds Dữ liệu nhập tay as a lazy page of 10b", () => {
		const manual = settingsPageOf("du-lieu-nhap-tay");
		expect(manual).toMatchObject({
			id: "manualData",
			status: "built",
			phase: "10b",
		});
		expect(manual?.load).toBeTypeOf("function");
	});

	it("builds Nhân viên as a lazy page of 14a, listed for owners and managers only, with its keys in the staff file", () => {
		const staff = settingsPageOf("nhan-vien");
		expect(staff).toMatchObject({
			id: "staff",
			status: "built",
			phase: "14a",
			titleKey: "settings.staff.title",
			managersOnly: true,
		});
		expect(staff?.load).toBeTypeOf("function");
		expect(
			SETTINGS_PAGES.filter((page) => page.managersOnly).map(
				(page) => page.slug,
			),
		).toEqual(["nhan-vien", "checklist"]);
		expect(inSharedSettingsFile("settings.staff.title")).toBe(false);
	});

	it("builds Checklist as a lazy page of 14b after Nhân viên, listed for owners and managers only, with its keys in its own file", () => {
		const checklists = settingsPageOf("checklist");
		expect(checklists).toMatchObject({
			id: "checklists",
			status: "built",
			phase: "14b",
			titleKey: "settings.checklists.title",
			managersOnly: true,
		});
		expect(checklists?.load).toBeTypeOf("function");
		const slugs = SETTINGS_PAGES.map((page) => page.slug);
		expect(slugs.indexOf("checklist")).toBe(slugs.indexOf("nhan-vien") + 1);
		expect(inSharedSettingsFile("settings.checklists.title")).toBe(false);
	});

	it("builds Khách hàng thân thiết as a lazy page of 16a after Checklist, listed for every member, with its keys in its own file", () => {
		const loyalty = settingsPageOf("khach-hang-than-thiet");
		expect(loyalty).toMatchObject({
			id: "loyalty",
			status: "built",
			phase: "16a",
			titleKey: "settings.loyalty.title",
		});
		expect(loyalty?.managersOnly).toBeUndefined();
		expect(loyalty?.load).toBeTypeOf("function");
		const slugs = SETTINGS_PAGES.map((page) => page.slug);
		expect(slugs.indexOf("khach-hang-than-thiet")).toBe(
			slugs.indexOf("checklist") + 1,
		);
		expect(inSharedSettingsFile("settings.loyalty.title")).toBe(false);
	});

	it("builds Ngày lễ as a lazy page of 10b", () => {
		const holidays = settingsPageOf("ngay-le");
		expect(holidays).toMatchObject({
			id: "holidays",
			status: "built",
			phase: "10b",
		});
		expect(holidays?.load).toBeTypeOf("function");
	});

	it.each([
		["canh-bao", "alerts", "settings.alerts."],
		["ban-tin", "digests", "settings.digests."],
	] as const)(
		"holds %s as a slot of phase 12 with its keys under %s… in the shared settings file",
		(slug, id, prefix) => {
			const page = settingsPageOf(slug);
			expect(page).toMatchObject({
				id,
				status: "slot",
				phase: "12",
				load: null,
				titleKey: `${prefix}title`,
				slotKey: `${prefix}slot`,
			});
			expect(inSharedSettingsFile(`${prefix}title`)).toBe(true);
			expect(inSharedSettingsFile(`${prefix}slot`)).toBe(true);
		},
	);

	it("lists the slots last and leaves the pages of later phases unlisted until they are built", () => {
		expect(SETTINGS_PAGES.slice(-2).map((page) => page.slug)).toEqual([
			"canh-bao",
			"ban-tin",
		]);
		for (const slug of ["ket-noi", "khach-hang"]) {
			expect(settingsPageOf(slug)).toBeNull();
		}
		for (const page of SETTINGS_PAGES) {
			expect(page.load === null, page.slug).toBe(page.status !== "built");
			expect(page.slotKey !== undefined, page.slug).toBe(
				page.status === "slot",
			);
		}
	});
});
