import type { Reward } from "@fnb/zalo-mini/loyalty";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { looksLikePrice } from "../home/model";
import { catalogs } from "../i18n/catalog";
import { renderCustomerApp, setSearch } from "../test/render-app";
import {
	costText,
	reasonText,
	refusalText,
	rewardKindText,
	timeLeft,
} from "./rewards";

const START = Date.UTC(2026, 10, 19, 3, 0, 0);

function translate(key: string, values: Record<string, string | number> = {}) {
	const template = catalogs.vi[key] ?? key;
	return template.replace(/\{(\w+)\}/g, (_, name: string) =>
		String(values[name] ?? `{${name}}`),
	);
}

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
