import { expect, type Page } from "@playwright/test";

const DATA_PATH = "/supabase/rest/v1/";
const PAGE_ROWS = 1000;
const REVENUE_READERS: readonly string[] = ["owner", "manager", "viewer"];

export interface DataHeaders {
	readonly apikey: string;
	readonly authorization: string;
}

export interface HomeCheck {
	readonly access: string;
	readonly stores: number;
	readonly revenueShown: boolean;
	readonly stampMatches: boolean;
	readonly todayHasSales: boolean | null;
	readonly figuresMatch: boolean | null;
	readonly yesterdayMatches: boolean | null;
}

export function watchDataRequests(page: Page): () => Promise<DataHeaders> {
	let found: Promise<DataHeaders> | null = null;
	page.on("request", (request) => {
		if (
			found !== null ||
			!new URL(request.url()).pathname.startsWith(DATA_PATH)
		)
			return;
		found = request.allHeaders().then((headers) => ({
			apikey: headers.apikey ?? "",
			authorization: headers.authorization ?? "",
		}));
	});
	return async () => {
		await expect
			.poll(() => found !== null, { message: "the app read the Data API" })
			.toBe(true);
		if (found === null) throw new Error("the app did not read the Data API");
		return found;
	};
}

function isoDayIn(instant: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(instant);
}

function shownDate(isoDate: string): string {
	return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}

function dayBefore(isoDate: string): string {
	const day = new Date(`${isoDate}T00:00:00Z`);
	day.setUTCDate(day.getUTCDate() - 1);
	return day.toISOString().slice(0, 10);
}

export function expectedStamp(
	finishedAt: string | null,
	timeZone: string,
	now: Date,
): string {
	if (finishedAt === null) return "Chưa đồng bộ";
	const at = new Date(finishedAt);
	const time = new Intl.DateTimeFormat("vi-VN", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone,
	}).format(at);
	const day = isoDayIn(at, timeZone);
	return day === isoDayIn(now, timeZone)
		? `Cập nhật lúc ${time}`
		: `Cập nhật lúc ${time} ngày ${shownDate(day)}`;
}

export async function checkHome(
	page: Page,
	appUrl: string,
	headers: DataHeaders,
	tenantId: string,
): Promise<HomeCheck> {
	await expect(page.getByTestId("home")).toHaveAttribute(
		"data-status",
		"ready",
	);
	const read = async (path: string): Promise<Record<string, unknown>[]> => {
		const response = await page.request.get(
			`${appUrl}supabase/rest/v1/${path}`,
			{
				headers: { ...headers, accept: "application/json" },
			},
		);
		expect(response.status(), "a Data API read through the app").toBe(200);
		return response.json();
	};
	const [tenant] = await read(`tenants?select=timezone&id=eq.${tenantId}`);
	const [latest] = await read(
		`sync_runs?select=finished_at&tenant_id=eq.${tenantId}&status=eq.succeeded&finished_at=not.is.null&order=finished_at.desc&limit=1`,
	);
	const stamp = (
		await page.getByTestId("home-freshness").textContent()
	)?.trim();
	const stampMatches =
		stamp ===
		expectedStamp(
			typeof latest?.finished_at === "string" ? latest.finished_at : null,
			String(tenant?.timezone),
			new Date(),
		);
	const picker = page.getByTestId("store-picker").locator("option");
	const stores =
		(await picker.count()) || (await page.getByTestId("home-store").count());
	const view = page.getByTestId("home-store-view");
	if ((await view.count()) === 0) {
		return {
			access: "",
			stores,
			revenueShown: false,
			stampMatches,
			todayHasSales: null,
			figuresMatch: null,
			yesterdayMatches: null,
		};
	}
	const storeId = (await view.getAttribute("data-store-id")) ?? "";
	const today = (await view.getAttribute("data-today")) ?? "";
	const access = (await view.getAttribute("data-access")) ?? "";
	const revenueShown = (await page.getByTestId("home-today").count()) > 0;
	let todayHasSales: boolean | null = null;
	let figuresMatch: boolean | null = null;
	let yesterdayMatches: boolean | null = null;
	if (access !== "none") {
		let net = 0;
		let invoices = 0;
		for (let offset = 0; ; offset += PAGE_ROWS) {
			const rows = await read(
				`invoices?select=net_amount&store_id=eq.${storeId}&business_date=eq.${today}&status=neq.voided&order=id.asc&limit=${PAGE_ROWS}&offset=${offset}`,
			);
			for (const row of rows) net += Number(row.net_amount);
			invoices += rows.length;
			if (rows.length < PAGE_ROWS) break;
		}
		todayHasSales = invoices > 0;
		if (invoices === 0) {
			figuresMatch =
				(await page
					.getByTestId("home-card-net-revenue")
					.getAttribute("data-state")) === "empty" &&
				(await page
					.getByTestId("home-card-invoices")
					.getAttribute("data-state")) === "empty";
		} else {
			const exact =
				(await page
					.getByTestId("home-net-revenue")
					.getAttribute("data-exact")) ?? "";
			const count =
				(await page.getByTestId("home-invoices").textContent()) ?? "";
			figuresMatch =
				Number(exact.replace(/[^0-9-]/g, "")) === Math.round(net) &&
				Number(count.replace(/\D/g, "")) === invoices;
		}
	}
	if (access === "all") {
		const matched = await read(
			`sync_checks?select=is_matched&store_id=eq.${storeId}&business_date=eq.${dayBefore(today)}&is_matched=is.true&limit=1`,
		);
		yesterdayMatches =
			(await page
				.getByTestId("home-card-yesterday")
				.getAttribute("data-state")) ===
			(matched.length > 0 ? "verified" : "unverified");
	}
	return {
		access,
		stores,
		revenueShown,
		stampMatches,
		todayHasSales,
		figuresMatch,
		yesterdayMatches,
	};
}

export function homeSummary(check: HomeCheck): string {
	return [
		`${check.stores} store(s)`,
		`revenue cards ${check.revenueShown}`,
		`today has sales ${check.todayHasSales}`,
		`figures equal Hôm nay ${check.figuresMatch}`,
		`stamp matches the latest sync ${check.stampMatches}`,
		`yesterday's check matches ${check.yesterdayMatches}`,
	].join(", ");
}

export function expectHomeFor(role: string, stores: number, check: HomeCheck) {
	expect(check.stores, "stores on the home").toBe(stores);
	expect(
		check.stampMatches,
		"the freshness stamp matches the latest successful sync",
	).toBe(true);
	if (REVENUE_READERS.includes(role)) {
		expect(check.access, "owners and managers read every card").toBe("all");
	}
	expect(check.revenueShown, "revenue cards as the role and level allow").toBe(
		check.access === "all" || check.access === "store_totals",
	);
	if (check.revenueShown) {
		expect(check.figuresMatch, "today's figures equal Hôm nay's").toBe(true);
	}
	if (check.access === "all") {
		expect(
			check.yesterdayMatches,
			"yesterday's check matches sync_checks",
		).toBe(true);
	}
}
