// Test design (ISTQB, G-105, ADR-049): the brands a login spans, read by the owner on the roster. Decision table over the
// role (staff or manager) and the scope (one brand's stores, stores of two brands, no store list, a store in no brand),
// boundary values at one brand and two, equivalence over both languages and the tenant with a single brand (nothing shown).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import type { StaffApp, StaffMember } from "./source";
import { BrandsFact } from "./staff-brands";
import { brandsOfScope, crossesBrands } from "./staff-rules";

const STORE_1 = "11111111-1111-4111-8111-111111111111";
const STORE_2 = "22222222-2222-4222-8222-222222222222";
const STORE_3 = "33333333-3333-4333-8333-333333333333";
const STORE_ORPHAN = "99999999-9999-4999-8999-999999999999";

function app(brandId: string, title: string, storeIds: string[]): StaffApp {
	return { brandId, miniAppId: `mini-${brandId}`, title, storeIds };
}

const BRAND_1 = app("brand-1", "Nhân viên Thương hiệu 1", [STORE_1, STORE_2]);
const BRAND_2 = app("brand-2", "Nhân viên Thương hiệu 2", [STORE_3]);
const TWO_BRANDS = [BRAND_1, BRAND_2];

type Login = Pick<StaffMember, "role" | "storeIds">;
const staff = (storeIds: string[] | null): Login => ({
	role: "staff",
	storeIds,
});
const manager = (storeIds: string[] | null): Login => ({
	role: "manager",
	storeIds,
});

describe("brandsOfScope", () => {
	it.each([
		{
			label: "stores of one brand",
			ids: [STORE_1, STORE_2],
			all: false,
			titles: ["Nhân viên Thương hiệu 1"],
		},
		{
			label: "one store of each brand",
			ids: [STORE_1, STORE_3],
			all: false,
			titles: ["Nhân viên Thương hiệu 1", "Nhân viên Thương hiệu 2"],
		},
		{
			label: "a store that is in no brand",
			ids: [STORE_ORPHAN],
			all: false,
			titles: [],
		},
		{
			label: "a store in no brand beside one in a brand",
			ids: [STORE_ORPHAN, STORE_3],
			all: false,
			titles: ["Nhân viên Thương hiệu 2"],
		},
		{ label: "an empty list", ids: [], all: false, titles: [] },
		{
			label: "no store list: every store, so every brand",
			ids: null,
			all: true,
			titles: ["Nhân viên Thương hiệu 1", "Nhân viên Thương hiệu 2"],
		},
	])("reads $label", ({ ids, all, titles }) => {
		expect(brandsOfScope(ids, TWO_BRANDS)).toEqual({ all, titles });
	});

	it("names no brand when there are none", () => {
		expect(brandsOfScope([STORE_1], [])).toEqual({ all: false, titles: [] });
	});
});

describe("crossesBrands", () => {
	it.each([
		{
			label: "a cashier of one brand",
			login: staff([STORE_1]),
			crosses: false,
		},
		{
			label: "a cashier of two stores of the same brand",
			login: staff([STORE_1, STORE_2]),
			crosses: false,
		},
		{
			label: "a cashier of stores of two brands",
			login: staff([STORE_1, STORE_3]),
			crosses: true,
		},
		{
			label: "a cashier with no store list in a two-brand tenant",
			login: staff(null),
			crosses: true,
		},
		{
			label: "a manager of stores of two brands: normal, not flagged",
			login: manager([STORE_1, STORE_3]),
			crosses: false,
		},
		{
			label: "a manager with no store list: not flagged",
			login: manager(null),
			crosses: false,
		},
	])("is $crosses for $label", ({ login, crosses }) => {
		expect(crossesBrands(login, TWO_BRANDS)).toBe(crosses);
	});

	it("is false for a cashier with no store list when the tenant has one brand", () => {
		expect(crossesBrands(staff(null), [BRAND_1])).toBe(false);
	});
});

function show(
	login: Login,
	apps: readonly StaffApp[] | undefined,
	language: "vi" | "en" = "vi",
) {
	return render(
		<I18nProvider language={language} onLanguageChange={() => undefined}>
			<dl>
				<BrandsFact member={login} apps={apps} />
			</dl>
		</I18nProvider>,
	);
}

describe("the brands line of a roster row", () => {
	it("lists the brand of a cashier of one brand, without a flag", () => {
		show(staff([STORE_1]), TWO_BRANDS);
		expect(screen.getByTestId("staff-brands")).toHaveTextContent(
			"Nhân viên Thương hiệu 1",
		);
		expect(screen.queryByTestId("staff-brands-flag")).toBeNull();
	});

	it("lists both brands of a cashier who spans them and flags it", () => {
		show(staff([STORE_1, STORE_3]), TWO_BRANDS);
		const line = screen.getByTestId("staff-brands");
		expect(line).toHaveTextContent(
			"Nhân viên Thương hiệu 1, Nhân viên Thương hiệu 2",
		);
		expect(screen.getByTestId("staff-brands-flag")).toHaveTextContent(
			"Tài khoản nhân viên này có quyền ở 2 thương hiệu.",
		);
		expect(screen.getByTestId("staff-brands-flag")).toHaveAttribute(
			"role",
			"note",
		);
	});

	it("says all brands for a login with no store list, flagged for a cashier only", () => {
		const { unmount } = show(staff(null), TWO_BRANDS);
		expect(screen.getByTestId("staff-brands")).toHaveTextContent(
			"Tất cả thương hiệu",
		);
		expect(screen.getByTestId("staff-brands-flag")).toBeVisible();
		unmount();
		show(manager(null), TWO_BRANDS);
		expect(screen.getByTestId("staff-brands")).toHaveTextContent(
			"Tất cả thương hiệu",
		);
		expect(screen.queryByTestId("staff-brands-flag")).toBeNull();
	});

	it("does not flag a manager of two brands", () => {
		show(manager([STORE_1, STORE_3]), TWO_BRANDS);
		expect(screen.getByTestId("staff-brands")).toHaveTextContent(
			"Nhân viên Thương hiệu 1, Nhân viên Thương hiệu 2",
		);
		expect(screen.queryByTestId("staff-brands-flag")).toBeNull();
	});

	it("says so for a login whose stores are in no brand", () => {
		show(staff([STORE_ORPHAN]), TWO_BRANDS);
		expect(screen.getByTestId("staff-brands")).toHaveTextContent(
			"Chưa thuộc thương hiệu nào",
		);
	});

	it("shows nothing for a tenant with one brand or before the apps are loaded", () => {
		const { unmount } = show(staff([STORE_1]), [BRAND_1]);
		expect(screen.queryByTestId("staff-brands")).toBeNull();
		unmount();
		show(staff([STORE_1]), undefined);
		expect(screen.queryByTestId("staff-brands")).toBeNull();
	});

	it("is shown in English", () => {
		show(staff([STORE_1, STORE_3]), TWO_BRANDS, "en");
		expect(screen.getByText("Brands")).toBeVisible();
		expect(screen.getByTestId("staff-brands-flag")).toHaveTextContent(
			"This staff login works in 2 brands.",
		);
	});
});
