import {
	type BrandThemeRow,
	brandThemeOf,
	validateBrandThemeRow,
} from "@fnb/zalo-mini/app-config";
import { applyBrandTheme } from "@fnb/zalo-mini/react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_DISPLAY_NAME, DEMO_STAMPS_PER_CARD } from "../demo/fixtures";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { CupRow, MAX_CUPS, stampsProgress } from "./cup-row";

// a synthetic palette (not any real brand's), validated the way a build validates a brand's theme
const PALETTE = {
	surface: "#F5F1E8",
	surface_raised: "#FFFFFF",
	surface_sunken: "#EAE4D8",
	ink: "#1E1A16",
	ink_muted: "#5A5249",
	line: "#D6CDBE",
	accent: "#1E1A16",
	accent_ink: "#F5F1E8",
	highlight: "#7A4E26",
	hero: "#1E1A16",
	hero_ink: "#F5F1E8",
	tile: "#B9874E",
};
const SYNTHETIC_THEME = (() => {
	const problems: string[] = [];
	const valid = validateBrandThemeRow(
		{
			light: PALETTE,
			dark: PALETTE,
			wordmark: "QMH",
			tagline_vi: "Một quán thử, chỉ để kiểm tra.",
			tagline_en: "A test shop, for checks only.",
			kicker: "Test line",
		},
		problems,
	);
	if (valid === null) throw new Error(problems.join("; "));
	return brandThemeOf(valid as BrandThemeRow);
})();

afterEach(() => {
	setSearch("");
	applyBrandTheme(null);
});

// Test design (ISTQB): boundary value analysis of a stamp card's progress, 0 / 1 / per card - 1 / per card / beyond,
// and of the card size, 0 / 1 / the cup limit / one more; then equivalence partitions of the redesigned home, a
// visitor, a member, no programme, a failed sign-in, each checked through the app as a customer sees it.
describe("a stamp card's progress", () => {
	it("counts the cups to fill and the stamps left at each boundary of the card", () => {
		expect(stampsProgress(0, 10)).toEqual({
			filled: 0,
			total: 10,
			left: 10,
			full: false,
		});
		expect(stampsProgress(1, 10)).toMatchObject({ filled: 1, left: 9 });
		expect(stampsProgress(9, 10)).toMatchObject({
			filled: 9,
			left: 1,
			full: false,
		});
		expect(stampsProgress(10, 10)).toMatchObject({
			filled: 10,
			left: 0,
			full: true,
		});
		// a card read before its reward was issued can hold more stamps than it has places: never a negative count left
		expect(stampsProgress(11, 10)).toMatchObject({
			filled: 10,
			left: 0,
			full: true,
		});
		expect(stampsProgress(-1, 10)).toMatchObject({ filled: 0, left: 10 });
		expect(stampsProgress(2.7, 10)).toMatchObject({ filled: 2 });
		expect(stampsProgress(0, 0)).toMatchObject({ total: 1, left: 1 });
	});

	it("draws one cup per place up to the limit, the earned ones filled", () => {
		const cups = (total: number, filled = 0) => {
			const { container, unmount } = render(
				<CupRow total={total} filled={filled} />,
			);
			const all = [...container.querySelectorAll("[data-on]")] as HTMLElement[];
			const on = all.filter((cup) => cup.dataset.on === "true").length;
			unmount();
			return [all.length, on];
		};
		expect(cups(0)).toEqual([1, 0]);
		expect(cups(1, 1)).toEqual([1, 1]);
		expect(cups(10, 3)).toEqual([10, 3]);
		expect(cups(MAX_CUPS, MAX_CUPS)).toEqual([MAX_CUPS, MAX_CUPS]);
		expect(cups(MAX_CUPS + 1, 99)).toEqual([MAX_CUPS, MAX_CUPS]);
		expect(cups(6, -2)).toEqual([6, 0]);
		const { container } = render(<CupRow total={4} />);
		expect(
			container
				.querySelector("[data-testid=cup-row]")
				?.getAttribute("aria-hidden"),
		).toBe("true");
	});
});

describe("the redesigned home", () => {
	it("greets a visitor by name in the brand banner, shows an empty card the programme's size and the join actions, without shortcuts", async () => {
		// applied the way the app's start-up applies a brand's theme
		applyBrandTheme(SYNTHETIC_THEME);
		renderCustomerApp();
		const card = await screen.findByTestId("programme");
		expect(
			within(screen.getByTestId("brand-banner")).getByTestId("greeting")
				.textContent,
		).toBe(`Xin chào, ${DEMO_DISPLAY_NAME}!`);
		expect(card.parentElement?.className).toContain("-mt-12");
		const cups = within(card).getByTestId("cup-row").children;
		expect(cups).toHaveLength(DEMO_STAMPS_PER_CARD);
		expect(
			[...cups].filter((cup) => (cup as HTMLElement).dataset.on === "true"),
		).toHaveLength(0);
		expect(within(card).queryByTestId("home-stamps")).toBeNull();
		expect(
			within(card).getByRole("button", { name: "Tham gia thành viên" }),
		).toBeTruthy();
		expect(screen.queryByTestId("shortcuts")).toBeNull();
		// the rules sit in a closed disclosure that names them
		expect(within(card).getByText("Thể lệ chương trình")).toBeTruthy();
		expect(card.querySelector("details")?.open).toBe(false);
	});

	it("shows a member their stamps, what is left for a reward and three shortcuts, and keeps one navigation", async () => {
		renderCustomerApp({ settings: { member: true } });
		const stamps = await screen.findByTestId("home-stamps");
		const on = [...within(stamps).getByTestId("cup-row").children].filter(
			(cup) => (cup as HTMLElement).dataset.on === "true",
		).length;
		expect(on).toBeGreaterThan(0);
		expect(screen.getByTestId("home-stamps-left").textContent).toBe(
			`Đã có ${on}/${DEMO_STAMPS_PER_CARD}: thêm ${DEMO_STAMPS_PER_CARD - on} ly nữa là có quà`,
		);
		expect(screen.getByTestId("member-badge").textContent).toBe(
			"Bạn đã là thành viên.",
		);
		const shortcuts = within(screen.getByTestId("shortcuts"));
		expect(
			shortcuts.getAllByRole("button").map((button) => button.textContent),
		).toEqual(["Mã thành viên", "Đổi quà", "Ví voucher"]);
		expect(screen.getAllByRole("navigation")).toHaveLength(1);
	});

	it("says the programme is coming soon when the shop has none open", async () => {
		renderCustomerApp({ settings: { programme: "none" } });
		const card = await screen.findByTestId("programme");
		expect(within(card).getByText("Sắp ra mắt")).toBeTruthy();
		expect(
			within(card).getByText("Quán chưa mở chương trình thành viên."),
		).toBeTruthy();
		expect(within(card).getByTestId("cup-row").children).toHaveLength(6);
	});

	it("starts with the card, without a banner or a greeting, for a brand without a theme", async () => {
		renderCustomerApp();
		const card = await screen.findByTestId("programme");
		expect(screen.queryByTestId("brand-banner")).toBeNull();
		expect(screen.queryByTestId("greeting")).toBeNull();
		expect(card.parentElement?.className).toContain("pt-5");
	});

	it("shows a failed sign-in under the banner as a card with the message and one retry button", async () => {
		applyBrandTheme(SYNTHETIC_THEME);
		renderCustomerApp({ settings: { sessionFailure: true } });
		const failed = await screen.findByTestId("failed");
		// the demo's sign-in fails like a dropped request, so the message is the network one
		expect(within(failed).getByRole("alert").textContent).toBe(
			"Mất kết nối mạng. Kiểm tra mạng rồi thử lại.",
		);
		expect(within(failed).getAllByRole("button")).toHaveLength(1);
		expect(within(failed).getByRole("button").textContent).toBe("Thử lại");
		expect(screen.getByTestId("brand-banner")).toBeTruthy();
		expect(screen.queryByTestId("home-skeleton")).toBeNull();
	});
});
