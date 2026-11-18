import {
	createStandInSessionClient,
	fromZmpNativeStorage,
	type MemberRole,
	RestError,
	type SessionClient,
} from "@fnb/zalo-mini";
import { MiniApp } from "@fnb/zalo-mini/react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, nativeStorage } from "zmp-sdk";
import { catalogs } from "../i18n/catalog";
import { HomeScreen } from "./home-screen";
import type { RevenueVisibility } from "./model";
import { createSampleHomeSource } from "./sample";
import type { HomeData, HomeSource, HomeStore } from "./source";

const NOW = new Date("2026-11-18T04:42:00Z");
const NBSP = " ";
const BOTH_STORES = ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"];

interface Options {
	readonly role?: MemberRole;
	readonly stores?: readonly string[];
	readonly visibility?: RevenueVisibility;
	readonly source?: HomeSource;
	readonly language?: "vi" | "en";
	readonly client?: (client: SessionClient) => SessionClient;
}

function renderHome(options: Options = {}) {
	nativeStorage.clear();
	const standIn = createStandInSessionClient({
		settings: { scenario: "bound", delayMs: 0 },
		member: {
			displayName: "Thành viên thử",
			role: options.role ?? "manager",
			stores: options.stores ?? BOTH_STORES,
		},
		storage: fromZmpNativeStorage(nativeStorage),
		getAccessToken: () => getAccessToken(),
	});
	const source =
		options.source ??
		createSampleHomeSource({
			visibility: options.visibility ?? "all",
			delayMs: 0,
		});
	return render(
		<MiniApp
			language={options.language ?? "vi"}
			catalogs={catalogs}
			sessionClient={options.client ? options.client(standIn) : standIn}
			routes={[{ path: "/", element: <HomeScreen sourceFor={() => source} /> }]}
			tabs={[]}
			standInHeader={null}
		/>,
	);
}

async function ready() {
	const home = await screen.findByTestId("home");
	await vi.waitFor(() => expect(home).toHaveAttribute("data-status", "ready"));
	return home;
}

function cardsShown(): string[] {
	return ["net-revenue", "invoices", "yesterday", "opening-hours"].filter(
		(card) => screen.queryByTestId(`home-card-${card}`) !== null,
	);
}

const store: HomeStore = {
	id: "store-1",
	name: "Cửa hàng Mẫu 1",
	today: "2026-11-18",
	yesterday: "2026-11-17",
	hours: { kind: "open", spans: [["07:00", "22:00"]] },
	totals: { net: 12_450_000, invoices: 186 },
	yesterdayVerified: true,
};

function fixedSource(
	overrides: Partial<HomeData> = {},
	stores: readonly HomeStore[] = [store],
): HomeSource {
	return {
		load: async () => ({
			access: "all",
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
			freshness: {
				kind: "synced",
				finishedAt: new Date("2026-11-18T04:36:00Z"),
			},
			loadedAt: NOW,
			stores,
			...overrides,
		}),
	};
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("the staff home's cards", () => {
	it.each([
		["owner", "all", ["net-revenue", "invoices", "yesterday", "opening-hours"]],
		[
			"owner",
			"store_totals",
			["net-revenue", "invoices", "yesterday", "opening-hours"],
		],
		[
			"owner",
			"none",
			["net-revenue", "invoices", "yesterday", "opening-hours"],
		],
		[
			"manager",
			"all",
			["net-revenue", "invoices", "yesterday", "opening-hours"],
		],
		[
			"manager",
			"store_totals",
			["net-revenue", "invoices", "yesterday", "opening-hours"],
		],
		[
			"manager",
			"none",
			["net-revenue", "invoices", "yesterday", "opening-hours"],
		],
		["staff", "all", ["net-revenue", "invoices", "yesterday", "opening-hours"]],
		["staff", "store_totals", ["net-revenue", "invoices", "opening-hours"]],
		["staff", "none", ["opening-hours"]],
	] as const)(
		"show a %s with staff revenue visibility %s the cards %j",
		async (role, visibility, cards) => {
			renderHome({ role, visibility });
			const home = await ready();
			expect(cardsShown()).toEqual(cards);
			expect(screen.getByTestId("home-freshness")).toHaveTextContent(
				"Cập nhật lúc 11:36",
			);
			expect(screen.getByTestId("home-store-view")).toHaveAttribute(
				"data-access",
				role === "staff" ? visibility : "all",
			);
			if (!(cards as readonly string[]).includes("net-revenue")) {
				expect(home).not.toHaveTextContent("Doanh thu");
				expect(home).not.toHaveTextContent("hóa đơn");
				expect(screen.queryByTestId("home-today")).toBeNull();
			}
		},
	);

	it("show a manager today's figures as on Hôm nay, with the exact amount on tap", async () => {
		renderHome();
		await ready();
		expect(
			screen.getByRole("heading", { name: "Hôm nay đến 11:42 · 18/11/2026" }),
		).toBeInTheDocument();
		const net = screen.getByTestId("home-net-revenue");
		expect(net).toHaveTextContent("12,5 tr ₫");
		expect(net).toHaveAttribute("aria-expanded", "false");
		expect(screen.getByTestId("home-net-revenue-exact")).not.toBeVisible();
		fireEvent.click(net);
		expect(net).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByTestId("home-net-revenue-exact").textContent).toBe(
			`Giá trị chính xác: 12.450.000${NBSP}₫`,
		);
		expect(net).toHaveAttribute("data-exact", `12.450.000${NBSP}₫`);
		expect(screen.getByTestId("home-invoices")).toHaveTextContent("186");
		const yesterday = screen.getByTestId("home-card-yesterday");
		expect(yesterday).toHaveTextContent("Hôm qua · 17/11/2026");
		expect(yesterday).toHaveTextContent("Đã đối soát");
		expect(screen.getByTestId("home-card-opening-hours")).toHaveTextContent(
			"07:00–22:00",
		);
		expect(
			screen.getByRole("heading", { name: "Việc hôm nay · 18/11/2026" }),
		).toBeInTheDocument();
	});

	it("let a manager with several stores pick one, and show staff their single store", async () => {
		const { unmount } = renderHome();
		await ready();
		const picker = screen.getByLabelText("Cửa hàng");
		expect(
			within(picker)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(BOTH_STORES);
		fireEvent.change(picker, {
			target: { value: "00000000-0000-4000-8000-0000000005a2" },
		});
		expect(screen.getByTestId("home-net-revenue")).toHaveTextContent(
			"8,3 tr ₫",
		);
		expect(screen.getByTestId("home-invoices")).toHaveTextContent("121");
		expect(screen.getByTestId("home-card-yesterday")).toHaveTextContent(
			"Chưa đối soát",
		);
		expect(screen.getByTestId("home-card-opening-hours")).toHaveTextContent(
			"06:30–11:0016:00–22:30",
		);
		unmount();
		renderHome({ role: "staff", stores: ["Cửa hàng Mẫu 1"] });
		await ready();
		expect(screen.queryByTestId("store-picker")).toBeNull();
		expect(screen.getByTestId("home-store")).toHaveTextContent(
			"Cửa hàng Mẫu 1",
		);
	});

	it("speak English with the same figures", async () => {
		renderHome({ language: "en" });
		await ready();
		expect(screen.getByTestId("home-net-revenue")).toHaveTextContent(
			"12,5 M ₫",
		);
		expect(screen.getByTestId("home-freshness")).toHaveTextContent(
			"Updated at 11:36",
		);
		expect(screen.getByTestId("home-card-yesterday")).toHaveTextContent(
			"Reconciled",
		);
	});
});

describe("the staff home's plain states", () => {
	it("say no data yet instead of zeros, and name closed or unknown opening hours", async () => {
		renderHome({
			source: fixedSource({}, [
				{
					...store,
					totals: { net: 0, invoices: 0 },
					yesterdayVerified: null,
					hours: { kind: "closed" },
				},
			]),
		});
		await ready();
		for (const card of ["net-revenue", "invoices", "yesterday"]) {
			const shown = screen.getByTestId(`home-card-${card}`);
			expect(shown).toHaveAttribute("data-state", "empty");
			expect(shown).toHaveTextContent("Chưa có dữ liệu");
			expect(shown).not.toHaveTextContent(/\d+(,\d)? tr|^0$/);
		}
		expect(screen.queryByTestId("home-net-revenue")).toBeNull();
		expect(screen.getByTestId("home-card-opening-hours")).toHaveTextContent(
			"Hôm nay cửa hàng nghỉ",
		);
	});

	it("show today's totals missing from the database as no data and unknown hours as such", async () => {
		renderHome({
			source: fixedSource({ access: "store_totals" }, [
				{ ...store, totals: null, hours: { kind: "unknown" } },
			]),
		});
		await ready();
		expect(screen.getByTestId("home-card-net-revenue")).toHaveTextContent(
			"Chưa có dữ liệu",
		);
		expect(screen.getByTestId("home-card-opening-hours")).toHaveTextContent(
			"Chưa có giờ mở cửa",
		);
	});

	it("show an amount under a million exactly, without a tap", async () => {
		renderHome({
			source: fixedSource({}, [
				{ ...store, totals: { net: 850_000, invoices: 3 } },
			]),
		});
		await ready();
		const net = screen.getByTestId("home-net-revenue");
		expect(net.tagName).toBe("P");
		expect(net.textContent).toBe(`850.000${NBSP}₫`);
	});

	it("say when no store of the brand is assigned", async () => {
		renderHome({ source: fixedSource({}, []) });
		await ready();
		expect(screen.getByTestId("home-no-stores")).toHaveTextContent(
			"Bạn chưa được giao cửa hàng nào của thương hiệu này.",
		);
		expect(cardsShown()).toEqual([]);
	});

	it.each([
		[
			{ kind: "synced", finishedAt: new Date("2026-11-18T04:36:00Z") },
			"Cập nhật lúc 11:36",
		],
		[
			{ kind: "synced", finishedAt: new Date("2026-11-16T15:10:00Z") },
			"Cập nhật lúc 22:10 ngày 16/11/2026",
		],
		[{ kind: "never" }, "Chưa đồng bộ"],
		[{ kind: "unknown" }, "Chưa rõ lúc cập nhật"],
	] as const)("show the freshness stamp %j as %s", async (freshness, text) => {
		renderHome({ role: "staff", source: fixedSource({ freshness }) });
		await ready();
		const stamp = screen.getByTestId("home-freshness");
		expect(stamp).toHaveTextContent(text);
		expect(stamp).toHaveAttribute("data-state", freshness.kind);
	});
});

describe("the staff home's loading and errors", () => {
	it("show loading feedback at once while the figures load", async () => {
		renderHome({ source: { load: () => new Promise(() => undefined) } });
		const status = await screen.findByTestId("home-loading");
		expect(status).toHaveAttribute("role", "status");
		expect(status).toHaveTextContent("Đang tải số liệu…");
		expect(screen.getByTestId("home")).toHaveAttribute(
			"data-status",
			"loading",
		);
	});

	it("offer one retry when the figures cannot load, then show them", async () => {
		const good = fixedSource();
		let calls = 0;
		renderHome({
			source: {
				load: (query, now) => {
					calls += 1;
					return calls === 1
						? Promise.reject(new RestError(0))
						: good.load(query, now);
				},
			},
		});
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Chưa tải được số liệu",
		);
		const retry = screen.getAllByRole("button", { name: "Thử lại" });
		expect(retry).toHaveLength(1);
		fireEvent.click(retry[0] as HTMLElement);
		await ready();
		expect(screen.getByTestId("home-net-revenue")).toBeInTheDocument();
	});

	it("keep the figures and say so when a refresh fails", async () => {
		const good = fixedSource();
		let calls = 0;
		renderHome({
			source: {
				load: (query, now) => {
					calls += 1;
					return calls === 1
						? good.load(query, now)
						: Promise.reject(new RestError(503));
				},
			},
		});
		await ready();
		vi.setSystemTime(new Date(NOW.getTime() + 2 * 60_000));
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Chưa cập nhật được số liệu mới.",
		);
		expect(screen.getByTestId("home-net-revenue")).toHaveTextContent(
			"12,5 tr ₫",
		);
	});

	it("drop a fresh session the API refuses, as after a deactivation, instead of an error", async () => {
		let forgets = 0;
		renderHome({
			client: (client) => ({
				...client,
				forget: () => {
					forgets += 1;
					client.forget();
				},
			}),
			source: { load: () => Promise.reject(new RestError(403)) },
		});
		expect(
			await screen.findByRole("heading", {
				name: "Tài khoản chưa được liên kết",
			}),
		).toBeInTheDocument();
		expect(forgets).toBe(1);
		expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
	});

	it("sign in again when the API refuses an expired session", async () => {
		const good = fixedSource();
		let connects = 0;
		let loads = 0;
		const refusals: ((error: RestError) => void)[] = [];
		renderHome({
			client: (client) => ({
				...client,
				connect: () => {
					connects += 1;
					return client.connect();
				},
			}),
			source: {
				load: (query, now) => {
					loads += 1;
					return connects < 2
						? new Promise((_, reject) => refusals.push(reject))
						: good.load(query, now);
				},
			},
		});
		await screen.findByTestId("home");
		expect(connects).toBe(1);
		vi.setSystemTime(new Date(NOW.getTime() + 2 * 3_600_000));
		act(() => {
			for (const refuse of refusals) refuse(new RestError(401));
		});
		await vi.waitFor(() => expect(connects).toBe(2));
		await ready();
		expect(screen.getByTestId("home-net-revenue")).toBeInTheDocument();
		expect(loads).toBeGreaterThan(refusals.length);
	});
});
