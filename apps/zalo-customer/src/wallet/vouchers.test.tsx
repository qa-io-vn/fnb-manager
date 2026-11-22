import type { Reward } from "@fnb/zalo-mini/loyalty";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { looksLikePrice } from "../home/model";
import { catalogs } from "../i18n/catalog";
import { renderCustomerApp, setSearch } from "../test/render-app";
import {
	costText,
	holdAnnouncement,
	reasonText,
	refusalText,
	rewardKindText,
	timeLeft,
} from "./rewards";

const START = Date.UTC(2026, 10, 19, 3, 0, 0);

function translator(catalog: Readonly<Record<string, string>>) {
	return (key: string, values: Record<string, string | number> = {}) => {
		const template = catalog[key] ?? key;
		return template.replace(/\{(\w+)\}/g, (_, name: string) =>
			String(values[name] ?? `{${name}}`),
		);
	};
}

const translate = translator(catalogs.vi);
const translateEnglish = translator(catalogs.en);

const REWARD: Reward = {
	id: "r-1",
	rewardKey: "free-coffee",
	name: "Tặng 1 ly cà phê sữa",
	description: null,
	kind: "free_item",
	percent: null,
	itemNames: ["Cà phê sữa đá"],
	costStamps: 3,
	costPoints: 0,
	storeCodes: null,
	validFrom: null,
	validUntil: null,
	holdHours: 24,
	perMemberLimit: null,
	redeemed: 0,
	liveRedemptionId: null,
	affordable: true,
	stampsShort: 0,
	pointsShort: 0,
	available: true,
	unavailableReason: null,
};

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

async function openTab(name: string) {
	fireEvent.click(within(screen.getByRole("navigation")).getByText(name));
}

async function openRewards() {
	await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
	await openTab("Thẻ thành viên");
	fireEvent.click(await screen.findByRole("button", { name: "Đổi quà" }));
	expect(
		await screen.findByRole("heading", { level: 1, name: "Đổi quà" }),
	).toBeInTheDocument();
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true, now: START });
});

afterEach(() => {
	vi.useRealTimers();
	setSearch("");
});

describe("the voucher wallet's words", () => {
	it("describes a reward by its kind and items, and its cost in stamps or points, never as a price", () => {
		expect(rewardKindText(REWARD, translate, "vi")).toBe("Tặng Cà phê sữa đá");
		expect(
			rewardKindText(
				{ kind: "percent_off", percent: 12.5, itemNames: [] },
				translate,
				"vi",
			),
		).toBe("Giảm 12,5%");
		expect(
			rewardKindText({ kind: "amount_off", percent: null }, translate, "vi"),
		).toBe("Giảm trực tiếp trên hóa đơn");
		expect(
			rewardKindText({ kind: "free_upgrade", percent: null }, translate, "vi"),
		).toBe("Nâng cỡ miễn phí");
		expect(costText({ stamps: 3, points: 0 }, translate)).toBe("3 dấu");
		expect(costText({ stamps: 2, points: 150 }, translate)).toBe(
			"2 dấu + 150 điểm",
		);
		for (const text of [
			rewardKindText(REWARD, translate, "vi"),
			costText({ stamps: 2, points: 150 }, translate),
		]) {
			expect(looksLikePrice(text)).toBe(false);
		}
	});

	it("says what is missing for an unaffordable reward, and words every refusal", () => {
		expect(reasonText(REWARD, translate)).toBeNull();
		expect(
			reasonText(
				{
					...REWARD,
					available: false,
					affordable: false,
					unavailableReason: "insufficient_stamps",
					stampsShort: 2,
				},
				translate,
			),
		).toBe("Cần thêm 2 dấu để đổi.");
		expect(
			reasonText(
				{ ...REWARD, available: false, unavailableReason: "brand_new" },
				translate,
			),
		).toBe("Quà này chưa đổi được lúc này.");
		expect(refusalText("no_code_available", translate)).toBe(
			"Cửa hàng tạm hết mã cho quà này. Hãy thử lại sau.",
		);
		expect(refusalText("a_new_reason", translate)).toBe(
			"Chưa đổi được quà. Hãy thử lại sau ít phút.",
		);
	});

	it("counts the hold down in hours, minutes and seconds", () => {
		expect(timeLeft(START + 24 * 3_600_000, START)).toBe("24:00:00");
		expect(timeLeft(START + 61_500, START)).toBe("00:01:02");
		expect(timeLeft(START, START + 5000)).toBe("00:00:00");
	});
});

describe("redeeming a reward", () => {
	it("lists the rewards of the chosen store with their cost and affordability, confirms the cost, then shows the code with its countdown", async () => {
		renderCustomerApp({ settings: { member: true } });
		await openRewards();
		expect(screen.getByTestId("reward-pick-first")).toBeInTheDocument();
		fireEvent.change(screen.getByTestId("reward-store-picker"), {
			target: { value: "mau-1" },
		});
		const rewards = await screen.findAllByTestId("reward");
		expect(
			rewards.map((reward) => [
				within(reward).getByRole("heading").textContent,
				within(reward).getByTestId("reward-cost").textContent,
				within(reward).getByTestId("reward-state").textContent,
			]),
		).toEqual([
			["Tặng 1 ly cà phê sữa", "3 dấu", "Bạn đủ dấu và điểm để đổi quà này."],
			["Tặng bánh quy bơ", "50 điểm", "Bạn đủ dấu và điểm để đổi quà này."],
			["Giảm 10% hóa đơn", "150 điểm", "Cần thêm 45 điểm để đổi."],
			["Nâng cỡ ly miễn phí", "5 dấu", "Cần thêm 2 dấu để đổi."],
		]);
		const sizeUp = rewards[3];
		if (sizeUp === undefined) throw new Error("no reward");
		expect(
			within(sizeUp).getByRole("button", { name: "Đổi quà" }),
		).toBeDisabled();
		expect(looksLikePrice(document.body.textContent ?? "")).toBe(false);
		const coffee = rewards[0];
		if (coffee === undefined) throw new Error("no reward");
		fireEvent.click(within(coffee).getByRole("button", { name: "Đổi quà" }));
		const dialog = await screen.findByRole("dialog", {
			name: "Đổi Tặng 1 ly cà phê sữa?",
		});
		expect(within(dialog).getByTestId("redeem-cost")).toHaveTextContent(
			"Bạn dùng 3 dấu để đổi quà này tại Cửa hàng Mẫu 1.",
		);
		expect(dialog).toHaveTextContent("Mã được giữ cho bạn trong 24 giờ.");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Xác nhận đổi" }),
		);
		expect(await screen.findByTestId("voucher-code")).toHaveTextContent(
			"K7M2Q9TX",
		);
		expect(screen.getByTestId("voucher-qr")).toHaveAttribute(
			"data-payload",
			"fnb-redeem:1:K7M2Q9TX",
		);
		expect(screen.getByTestId("voucher-state")).toHaveTextContent("Đang giữ");
		expect(screen.getByTestId("voucher-countdown")).toHaveTextContent(
			"Còn 24:00:00",
		);
		expect(
			screen.getByText(/Đưa mã này cho nhân viên thu ngân/),
		).toBeInTheDocument();
		await advance(61_000);
		expect(screen.getByTestId("voucher-countdown")).toHaveTextContent(
			"Còn 23:58:59",
		);
		expect(looksLikePrice(document.body.textContent ?? "")).toBe(false);
	});

	it("keeps the held code in the voucher wallet until the hold ends, then says the stamps go back", async () => {
		renderCustomerApp({
			settings: { member: true },
			search: "?store=mau-2&src=qr",
		});
		await screen.findByRole("heading", { name: "Cửa hàng Mẫu 2" });
		await openTab("Thẻ thành viên");
		fireEvent.click(await screen.findByRole("button", { name: "Đổi quà" }));
		const [coffee] = await screen.findAllByTestId("reward");
		if (coffee === undefined) throw new Error("no reward");
		fireEvent.click(within(coffee).getByRole("button", { name: "Đổi quà" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Xác nhận đổi" }),
		);
		await screen.findByTestId("voucher-code");
		fireEvent.click(screen.getByRole("button", { name: "Ví voucher" }));
		const item = await screen.findByTestId("voucher-item");
		expect(item).toHaveAttribute("data-state", "held");
		expect(item).toHaveTextContent("Còn 24:00:00");
		await advance(24 * 3_600_000 + 1000);
		const ended = await screen.findByTestId("voucher-item");
		await vi.waitFor(() =>
			expect(ended).toHaveAttribute("data-state", "expired"),
		);
		expect(ended).toHaveTextContent("Hết thời gian giữ");
		expect(ended).toHaveTextContent(
			"3 dấu sẽ được hoàn lại vào thẻ trong đêm nay.",
		);
		expect(screen.queryByRole("button", { name: "Xem mã" })).toBeNull();
	});
});

describe("the voucher wallet", () => {
	it("labels a used voucher Đã dùng and a returned one Đã hoàn lại with what went back", async () => {
		renderCustomerApp({ settings: { member: true, vouchers: true } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		await openTab("Thẻ thành viên");
		fireEvent.click(await screen.findByRole("button", { name: "Ví voucher" }));
		const items = await screen.findAllByTestId("voucher-item");
		expect(
			items.map((item) => [
				item.getAttribute("data-state"),
				item.textContent?.includes("Đã dùng") ?? false,
			]),
		).toEqual([
			["returned", false],
			["used", true],
		]);
		expect(items[0]).toHaveTextContent("Đã hoàn lại");
		expect(items[0]).toHaveTextContent(
			"Mã chưa được dùng nên 3 dấu đã được hoàn lại vào thẻ của bạn.",
		);
		expect(items[1]).toHaveTextContent(/Đã dùng lúc \d{2}:\d{2}/);
		expect(screen.queryByTestId("voucher-code")).toBeNull();
	});

	it("names the returned hold in the card's history without a store path", async () => {
		renderCustomerApp({ settings: { member: true, vouchers: true } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		await openTab("Thẻ thành viên");
		const history = await screen.findAllByTestId("history-item");
		const returned = history.find((item) =>
			item.textContent?.includes("Hoàn lại quà chưa dùng"),
		);
		expect(returned).toBeDefined();
		expect(returned).not.toHaveTextContent("Cửa hàng ghi nhận");
	});
});

// G-37 (accessibility, component). Design: boundary value analysis of the
// whole-minute words (each minute and hour edge at x - 1, x and x + 1 ms),
// equivalence partitioning of the voucher states, and a rate property on the
// live region (one announcement a minute, one at the end). Negative cases: no
// assertive region, no announcement for a voucher that is not held, and a
// silent seconds counter. axe does not judge any of these.
describe("the hold announcement words", () => {
	const held = (msLeft: number) => ({
		state: "held" as const,
		holdExpiresAt: START + msLeft,
	});
	const sayVi = (voucher: Parameters<typeof holdAnnouncement>[0]) =>
		holdAnnouncement(voucher, START, translate);

	it("speaks whole minutes, and hours with minutes from one hour up, changing only at a minute edge", () => {
		const edges: readonly (readonly [number, string])[] = [
			[24 * 3_600_000, "Mã còn 24 giờ 0 phút."],
			[3_600_001, "Mã còn 1 giờ 1 phút."],
			[3_600_000, "Mã còn 1 giờ 0 phút."],
			[3_540_001, "Mã còn 1 giờ 0 phút."],
			[3_540_000, "Mã còn 59 phút."],
			[60_001, "Mã còn 2 phút."],
			[60_000, "Mã còn 1 phút."],
			[59_999, "Mã còn 1 phút."],
			[1, "Mã còn 1 phút."],
		];
		for (const [msLeft, words] of edges) {
			expect(sayVi(held(msLeft)), `${msLeft} ms left`).toBe(words);
		}
		expect(holdAnnouncement(held(61_500), START, translateEnglish)).toBe(
			"The code has 2 minutes left.",
		);
		expect(holdAnnouncement(held(3_660_000), START, translateEnglish)).toBe(
			"The code has 1 hours 1 minutes left.",
		);
	});

	it("says the hold has ended at the end of the hold and after it, in both languages", () => {
		for (const msLeft of [0, -1, -3_600_000]) {
			expect(sayVi(held(msLeft)), `${msLeft} ms left`).toBe(
				"Đã hết thời gian giữ mã.",
			);
		}
		expect(
			holdAnnouncement(
				{ state: "expired", holdExpiresAt: START - 5 },
				START,
				translateEnglish,
			),
		).toBe("The hold on the code has ended.");
		expect(sayVi({ state: "expired", holdExpiresAt: null })).toBe(
			"Đã hết thời gian giữ mã.",
		);
	});

	it("says nothing for a voucher that is used, returned or cancelled, or a hold without an end", () => {
		for (const state of ["used", "returned", "cancelled"] as const) {
			expect(sayVi({ state, holdExpiresAt: START + 60_000 }), state).toBe("");
		}
		expect(sayVi({ state: "held", holdExpiresAt: null })).toBe("");
	});
});

describe("the voucher countdown for assistive technology", () => {
	async function holdFirstReward() {
		renderCustomerApp({
			settings: { member: true },
			search: "?store=mau-2&src=qr",
		});
		await screen.findByRole("heading", { name: "Cửa hàng Mẫu 2" });
		await openTab("Thẻ thành viên");
		fireEvent.click(await screen.findByRole("button", { name: "Đổi quà" }));
		const [coffee] = await screen.findAllByTestId("reward");
		if (coffee === undefined) throw new Error("no reward");
		fireEvent.click(within(coffee).getByRole("button", { name: "Đổi quà" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Xác nhận đổi" }),
		);
		await screen.findByTestId("voucher-code");
	}

	it("announces the hold in one polite, atomic status region and has no assertive region", async () => {
		await holdFirstReward();
		const region = screen.getByTestId("voucher-announce");
		expect(region).toHaveAttribute("aria-live", "polite");
		expect(region).toHaveAttribute("role", "status");
		expect(region).toHaveAttribute("aria-atomic", "true");
		expect(region).toHaveClass("sr-only");
		expect(region).toHaveTextContent("Mã còn 24 giờ 0 phút.");
		const screenRoot = screen.getByTestId("voucher-screen");
		expect(
			screenRoot.querySelectorAll('[aria-live="polite"], [role="status"]'),
		).toHaveLength(1);
		expect(document.querySelectorAll('[aria-live="assertive"]')).toHaveLength(
			0,
		);
		expect(within(screenRoot).queryAllByRole("alert")).toHaveLength(0);
	});

	it("keeps the seconds counter out of the live regions, so it is never read every second", async () => {
		await holdFirstReward();
		const counter = screen.getByTestId("voucher-countdown");
		expect(counter).toHaveAttribute("role", "timer");
		expect(counter).toHaveAttribute("aria-live", "off");
		expect(counter.closest("[aria-live]")).toBe(counter);
		const region = screen.getByTestId("voucher-announce");
		expect(region).not.toContainElement(counter);
		await advance(5_000);
		expect(counter).toHaveTextContent(/^Còn 23:59:5\d$/);
		expect(region).toHaveTextContent("Mã còn 24 giờ 0 phút.");
	});

	it("changes its words once a minute and says the end of the hold once, then stays silent", async () => {
		await holdFirstReward();
		expect(screen.getByTestId("voucher-announce")).toHaveTextContent(
			"Mã còn 24 giờ 0 phút.",
		);
		// Jump the clock to 2 minutes 5 seconds before the hold ends, then tick
		// once a second for 130 seconds: a region that spoke every second would
		// change about 125 times, this one three times and then the ended text.
		vi.setSystemTime(Date.now() + 24 * 3_600_000 - 125_500);
		const spoken: string[] = [];
		for (let second = 0; second < 130; second += 1) {
			await advance(1_000);
			const words = screen.getByTestId("voucher-announce").textContent ?? "";
			if (spoken[spoken.length - 1] !== words) spoken.push(words);
		}
		expect(spoken).toEqual([
			"Mã còn 3 phút.",
			"Mã còn 2 phút.",
			"Mã còn 1 phút.",
			"Đã hết thời gian giữ mã.",
		]);
		expect(screen.queryByTestId("voucher-code")).toBeNull();
		expect(screen.getByTestId("voucher-announce")).toBeInTheDocument();
		expect(document.querySelectorAll('[aria-live="assertive"]')).toHaveLength(
			0,
		);
	});

	it("keeps the held code's region quiet for a used voucher that is opened from the wallet", async () => {
		renderCustomerApp({ settings: { member: true, vouchers: true } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		await openTab("Thẻ thành viên");
		fireEvent.click(await screen.findByRole("button", { name: "Ví voucher" }));
		const items = await screen.findAllByTestId("voucher-item");
		expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
			"returned",
			"used",
		]);
		expect(screen.queryByTestId("voucher-announce")).toBeNull();
		expect(screen.queryByTestId("voucher-countdown")).toBeNull();
		expect(document.querySelectorAll('[aria-live="assertive"]')).toHaveLength(
			0,
		);
	});
});
