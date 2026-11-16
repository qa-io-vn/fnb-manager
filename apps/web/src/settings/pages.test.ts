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
		for (const slug of ["nhan-vien", "ket-noi", "khach-hang"]) {
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
