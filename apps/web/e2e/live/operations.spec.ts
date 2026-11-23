import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { staffPageAccess } from "../../src/settings/access";
import type { Membership } from "../../src/settings/source";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import {
	COUNTS,
	createOperationsFixture,
	jpegFromBrowser,
	OPS_BUCKET,
	type OperationsFixture,
	POS_CASHIER,
	POS_SHIFT_NAMES,
	TEMPLATE_TITLES,
	TEXTS,
} from "../support/operations-fixture";
import { expect, type Locator, type Page, test } from "../support/policy-test";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import {
	type ExpectedConsoleError,
	expectCsvWithBom,
	expectNoConsoleErrors,
	expectShiftsLabelledByNumber,
	watchConsoleErrors,
} from "../support/reports";
import {
	createSettingsFixture,
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";
import { waitForSettledThemeCards } from "../support/themes";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const POS_NAMES = new RegExp(POS_SHIFT_NAMES.join("|"));
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const REFUSED_WRITE: ExpectedConsoleError = {
	text: /status of 40[03]/,
	url: /\/rest\/v1\/rpc\/(acknowledge_incident|reopen_cash_count)/,
	atMost: 1,
};

let fixture: SettingsFixture | undefined;
let ops: OperationsFixture | undefined;
let before: RealTenantsSnapshot | undefined;
const clients: SupabaseClient[] = [];

function settings(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

function day(): OperationsFixture {
	if (ops === undefined) throw new Error("the operations fixture was not made");
	return ops;
}

type Sql = ReturnType<typeof openFixtureDatabase>;

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
	const sql = openFixtureDatabase();
	try {
		return await run(sql);
	} finally {
		await sql.end();
	}
}

function minusDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() - days);
	return value.toISOString().slice(0, 10);
}

function dmy(date: string): string {
	const [year, month, dayOfMonth] = date.split("-");
	return `${dayOfMonth}/${month}/${year}`;
}

test.beforeAll(async ({ browser }) => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
	const pageContext = await browser.newContext();
	const page = await pageContext.newPage();
	try {
		await page.goto("about:blank");
		const jpeg = await jpegFromBrowser(page);
		ops = await createOperationsFixture(fixture, jpeg);
	} finally {
		await pageContext.close();
	}
});

async function signOutAll(): Promise<void> {
	for (const client of clients.splice(0)) await client.auth.signOut();
}

test.afterAll(async () => {
	await signOutAll();
	await fixture?.teardown();
});

async function clientAs(
	role: SettingsRole | "publisher",
): Promise<SupabaseClient> {
	const made =
		role === "publisher"
			? await (async () => {
					const login = await settings().addPublisher();
					const client = anonymousClient();
					const { error } = await client.auth.signInWithPassword({
						email: login.email,
						password: login.password,
					});
					if (error) throw error;
					return client;
				})()
			: await settings().clientAs(role);
	clients.push(made);
	return made;
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

function card(page: Page, testId: string): Locator {
	return page.getByTestId(testId);
}

async function settled(page: Page, testId: string): Promise<Locator> {
	const found = card(page, testId);
	await expect(found).toBeVisible({ timeout: 30_000 });
	await expect(found).not.toHaveAttribute("data-state", /loading|error/, {
		timeout: 30_000,
	});
	await expect(found.getByTestId("sentence")).toBeVisible({ timeout: 30_000 });
	return found;
}

async function openOperations(
	page: Page,
	slug: "checklist" | "ket-tien" | "su-co",
	search: string,
): Promise<void> {
	await page.goto(`/#/van-hanh/${slug}?${search}`);
	await expect(page.getByTestId("operations-page")).toHaveAttribute(
		"data-page",
		slug,
	);
}

async function bodyRows(scope: Locator): Promise<string[][]> {
	return scope
		.locator("tbody tr")
		.evaluateAll((rows) =>
			rows.map((row) =>
				[...row.querySelectorAll("th, td")].map(
					(cell) => cell.textContent?.trim() ?? "",
				),
			),
		);
}

async function csvOf(page: Page, testId: string): Promise<string> {
	const downloading = page.waitForEvent("download");
	await card(page, testId)
		.getByRole("button", { name: /Tải CSV|Download CSV/ })
		.first()
		.click();
	const download = await downloading;
	return (await readFile(await download.path())).subarray(3).toString("utf8");
}

async function checkFromTop(page: Page): Promise<void> {
	await page.evaluate(() =>
		window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
	);
	await checkPage(page);
}

async function expectOperationsPrintLayout(page: Page): Promise<void> {
	const screenSize = page.viewportSize();
	await page.setViewportSize({ width: 680, height: 900 });
	await page.emulateMedia({ media: "print" });
	try {
		for (const hidden of [
			"operations-tabs",
			"range-picker",
			"cash-reopen",
			"bottom-navigation",
			"side-rail",
		]) {
			await expect(page.getByTestId(hidden)).toBeHidden();
		}
		await expect(page.getByTestId("print-summary")).toBeVisible();
		await expect(page.getByTestId("print-summary")).toContainText("Két tiền");
		await expect(page.locator("button:visible")).toHaveCount(
			await page.locator("th button:visible").count(),
		);
		const outside = await page.evaluate(() =>
			[...document.querySelectorAll('[data-testid="report-cards"] article')]
				.flatMap((article) => {
					const box = article.getBoundingClientRect();
					return [...article.querySelectorAll("table")].filter((table) => {
						const inner = table.getBoundingClientRect();
						return inner.left < box.left - 1 || inner.right > box.right + 1;
					});
				})
				.map((table) => table.getAttribute("aria-label") ?? "table"),
		);
		expect(outside).toEqual([]);
	} finally {
		await page.emulateMedia({ media: "screen" });
		if (screenSize !== null) await page.setViewportSize(screenSize);
	}
}

async function code(
	request: PromiseLike<{ error: { code?: string } | null }>,
): Promise<string> {
	const { error } = await request;
	return error === null ? "saved" : (error.code ?? "error");
}

test("the fixture builds one day at one store across three shifts through the staff functions, with photos in the brand's private bucket", async () => {
	const made = day();
	expect(made.bucket).toBe(OPS_BUCKET);
	expect(made.countDay).toBe(minusDays(made.day, 1));
	await withSql(async (sql) => {
		const [bucket] = await sql<{ public: boolean; size: number }[]>`
			select public, file_size_limit::int as size from storage.buckets where id = ${OPS_BUCKET}
		`;
		expect(bucket).toEqual({ public: false, size: 1048576 });
		const shifts = await sql<{ shift_number: number; state: string }[]>`
			select r.shift_number, r.state
			from public.cash_count_review(${[settings().storeIds[0]]}::uuid[], ${made.countDay}::date, ${made.countDay}::date) r
			where r.shift_id is not null
			order by r.shift_number
		`;
		expect(shifts).toEqual([
			{ shift_number: 1, state: "no_count" },
			{ shift_number: 2, state: "within" },
			{ shift_number: 3, state: "over" },
		]);
	});
});

test("through PostgREST, each login reads the operations rows and photos of its stores only, and the managers' writes are saved or refused as the page gate says", async () => {
	const made = day();
	const [storeOne] = settings().storeIds;
	const logins = [
		"owner",
		"manager",
		"store-manager",
		"staff",
		"viewer",
		"publisher",
	] as const;
	const reads: Record<string, unknown> = {};
	for (const login of logins) {
		const client = await clientAs(login);
		const runs = await client.from("checklist_runs").select("id");
		const incidents = await client.from("incidents").select("id");
		const handovers = await client.from("shift_handovers").select("id");
		const photo = await client.storage
			.from(OPS_BUCKET)
			.download(made.runPhotoPath);
		const review = await client.rpc("cash_count_review", {
			store_ids: [storeOne],
			from_date: made.countDay,
			to_date: made.countDay,
		});
		const states = ((review.data ?? []) as { state: string }[])
			.map((row) => row.state)
			.sort();
		reads[login] = {
			runs: runs.data?.length ?? 0,
			incidents: incidents.data?.length ?? 0,
			handovers: handovers.data?.length ?? 0,
			photo: photo.error === null,
			states,
		};
	}
	expect(reads).toEqual({
		owner: {
			runs: 2,
			incidents: 3,
			handovers: 1,
			photo: true,
			states: ["no_count", "over", "within"],
		},
		manager: {
			runs: 2,
			incidents: 3,
			handovers: 1,
			photo: true,
			states: ["no_count", "over", "within"],
		},
		"store-manager": {
			runs: 2,
			incidents: 2,
			handovers: 1,
			photo: true,
			states: ["no_count", "over", "within"],
		},
		staff: {
			runs: 2,
			incidents: 3,
			handovers: 1,
			photo: true,
			states: ["no_count", "over", "within"],
		},
		viewer: {
			runs: 0,
			incidents: 0,
			handovers: 0,
			photo: false,
			states: ["no_count", "no_count", "no_count"],
		},
		publisher: {
			runs: 0,
			incidents: 0,
			handovers: 0,
			photo: false,
			states: [],
		},
	});
	const anon = anonymousClient();
	expect((await anon.from("incidents").select("id")).error?.code).toBe("42501");
	expect(
		(await anon.storage.from(OPS_BUCKET).download(made.runPhotoPath)).error,
	).not.toBeNull();

	const writes: Record<string, unknown> = {};
	for (const login of logins) {
		const client = await clientAs(login);
		writes[login] = {
			acknowledgeOtherStore: await code(
				client.rpc("acknowledge_incident", {
					p_incident_id: made.otherStoreIncidentId,
				}),
			),
			acknowledgeHandover:
				login === "staff" || login === "viewer" || login === "publisher"
					? await code(
							client.rpc("acknowledge_handover", {
								p_handover_id: made.handoverId,
							}),
						)
					: "skipped",
			reopen:
				login === "staff" || login === "viewer" || login === "publisher"
					? await code(
							client.rpc("reopen_cash_count", {
								p_cash_count_id: made.countIds.over,
							}),
						)
					: "skipped",
		};
	}
	expect(writes).toEqual({
		owner: {
			acknowledgeOtherStore: "saved",
			acknowledgeHandover: "skipped",
			reopen: "skipped",
		},
		manager: {
			acknowledgeOtherStore: "saved",
			acknowledgeHandover: "skipped",
			reopen: "skipped",
		},
		"store-manager": {
			acknowledgeOtherStore: "42501",
			acknowledgeHandover: "skipped",
			reopen: "skipped",
		},
		staff: {
			acknowledgeOtherStore: "42501",
			acknowledgeHandover: "42501",
			reopen: "42501",
		},
		viewer: {
			acknowledgeOtherStore: "42501",
			acknowledgeHandover: "42501",
			reopen: "42501",
		},
		publisher: {
			acknowledgeOtherStore: "42501",
			acknowledgeHandover: "42501",
			reopen: "42501",
		},
	});
	expect(
		await code(
			anon.rpc("acknowledge_incident", { p_incident_id: made.incidentId }),
		),
	).toBe("42501");
	const members: Record<SettingsRole, Membership> = {
		owner: { role: "owner", storeIds: null },
		manager: { role: "manager", storeIds: null },
		"store-manager": { role: "manager", storeIds: [storeOne] },
		staff: { role: "staff", storeIds: null },
		viewer: { role: "viewer", storeIds: null },
	};
	expect(
		Object.fromEntries(
			Object.entries(members).map(([login, member]) => [
				login,
				staffPageAccess(member).canWrite,
			]),
		),
	).toEqual({
		owner: true,
		manager: true,
		"store-manager": true,
		staff: false,
		viewer: false,
	});
	await withSql(async (sql) => {
		const [other] = await sql<{ status: string }[]>`
			select status from public.incidents where id = ${made.otherStoreIncidentId}
		`;
		expect(other?.status).toBe("seen");
		const [count] = await sql<{ status: string }[]>`
			select status from public.cash_counts where id = ${made.countIds.over}
		`;
		expect(count?.status).toBe("active");
	});
});

test("the owner sees one full day of checklists done, in progress and not due, the earlier days missed, each run's wording, the correction and its photo through an authenticated download", async ({
	page,
}) => {
	const made = day();
	await signedIn(page, "owner");
	const external: string[] = [];
	page.on("request", (request) => {
		const url = request.url();
		if (url.includes("/storage/v1/object/public/")) external.push(url);
	});
	await openOperations(
		page,
		"checklist",
		`from=${minusDays(made.day, 2)}&to=${made.day}&store=${settings().storeIds[0]}`,
	);
	const compliance = await settled(page, "operations-checklist-card");
	await expect(compliance.getByTestId("sentence")).toHaveText(
		"1 checklist xong đúng hạn, 0 xong muộn và 6 bị bỏ trong 7 checklist đã đến hạn. Hôm nay còn 1 đang làm và 1 chưa đến hạn.",
	);
	const rows = await bodyRows(compliance);
	expect(rows.slice(0, 3).map((row) => row.slice(0, 5))).toEqual([
		[dmy(made.day), "Mở ca", TEMPLATE_TITLES.opening, "Xong", "3/3"],
		[dmy(made.day), "Giữa ca", TEMPLATE_TITLES.midshift, "Đang làm", "1/2"],
		[dmy(made.day), "Đóng ca", TEMPLATE_TITLES.closing, "Chưa đến hạn", "—"],
	]);
	expect(rows.slice(3).map((row) => row[3])).toEqual(
		Array.from({ length: 6 }, () => "Bị bỏ"),
	);
	await page
		.getByRole("button", {
			name: new RegExp(`^Xem chi tiết ${TEMPLATE_TITLES.opening},`),
		})
		.click();
	const detail = page.getByTestId("run-detail");
	await expect(detail.getByTestId("run-item-label")).toHaveText([
		"Mở ca trên POS",
		"Lau quầy",
		"Nhiệt độ tủ mát",
	]);
	await expect(detail.getByTestId("run-corrections")).toContainText(
		"Bạn sửa mục 3",
	);
	const photo = detail.getByTestId("photo-thumbnail");
	await expect(photo).toBeVisible();
	await expect(photo).toHaveAttribute("src", /^blob:/);
	await expect
		.poll(() =>
			photo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
		)
		.toBeGreaterThan(0);
	expect(external).toEqual([]);
	expect(await page.locator("main").innerHTML()).not.toContain(
		made.runPhotoPath,
	);
	await expectCsvWithBom(page, "operations-checklist-card");
	const csv = await csvOf(page, "operations-checklist-card");
	expect(csv).toContain("Bị bỏ");
	expect(csv).toContain(TEMPLATE_TITLES.closing);
	await checkFromTop(page);
	expectNoConsoleErrors(page);
});

test("the owner sees the count beside the POS drawer for Ca 1 to Ca 3 with the threshold state and no cashier or POS shift name, and reopens the count over the threshold", async ({
	page,
}) => {
	const made = day();
	await signedIn(page, "owner");
	await openOperations(
		page,
		"ket-tien",
		`from=${made.countDay}&to=${made.day}&store=${settings().storeIds[0]}`,
	);
	const cash = await settled(page, "operations-cash-card");
	const rows = (await bodyRows(cash)).filter(
		(row) => row[0] === dmy(made.countDay),
	);
	expect(rows.map((row) => [row[1], row[7]])).toEqual([
		["Ca 1", "Chưa đếm"],
		["Ca 2", "Trong ngưỡng"],
		["Ca 3", "Vượt ngưỡng"],
	]);
	expect(rows[2]?.[3]).toContain("1.380.000");
	expect(rows[2]?.[4]).toContain("1.480.000");
	expect(rows[2]?.[6]).toContain("120.000");
	expect(rows[2]?.[8]).toBe("mức tuyệt đối");
	await expectShiftsLabelledByNumber(page, "operations-cash-card", POS_NAMES);
	expect(await page.content()).not.toContain(POS_CASHIER);
	const csv = await csvOf(page, "operations-cash-card");
	expect(csv).not.toMatch(EMAIL_PATTERN);
	expect(csv).toContain(String(COUNTS.over));
	await checkFromTop(page);
	await expectOperationsPrintLayout(page);

	const reopen = page.getByTestId("cash-reopen");
	await reopen
		.getByTestId("cash-reopen-choice")
		.selectOption(made.countIds.over);
	await reopen.getByRole("button", { name: "Mở lại", exact: true }).click();
	await expect(reopen.getByTestId("cash-reopen-confirm")).toContainText(
		`Mở lại số đếm Ca 3 ngày ${dmy(made.countDay)}`,
	);
	await reopen.getByRole("button", { name: "Mở lại số đếm" }).click();
	await expect(reopen.getByTestId("cash-reopen-status")).toHaveText(
		`Đã mở lại số đếm Ca 3 ngày ${dmy(made.countDay)}; ca chờ đếm lại.`,
	);
	await expect
		.poll(async () =>
			(await bodyRows(card(page, "operations-cash-card")))
				.filter((row) => row[0] === dmy(made.countDay))
				.map((row) => row[7]),
		)
		.toEqual(["Chưa đếm", "Trong ngưỡng", "Chưa đếm"]);
	await withSql(async (sql) => {
		const [count] = await sql<{ status: string; reopened_by: string | null }[]>`
			select status, reopened_by from public.cash_counts where id = ${made.countIds.over}
		`;
		expect(count).toEqual({
			status: "reopened",
			reopened_by: settings().logins.owner.userId,
		});
	});
	expectNoConsoleErrors(page);
});

test("the owner filters the incident log, sees a report's photo on demand, marks it seen and resolves a stock-out, while the writer is refused their own acknowledgement", async ({
	page,
}) => {
	const made = day();
	const staff = await clientAs("staff");
	expect(
		await code(
			staff.rpc("acknowledge_incident", { p_incident_id: made.incidentId }),
		),
	).toBe("42501");
	await signedIn(page, "owner");
	await openOperations(
		page,
		"su-co",
		// The window ends a day after the fixture's business day: the fixture shifts store one's business day to start an
		// hour before the run, so in the first hour after local midnight store one's day is still yesterday while store
		// two's incident is dated today, and a window that ended on made.day dropped it (3 entries instead of 4).
		`from=${minusDays(made.day, 1)}&to=${minusDays(made.day, -1)}`,
	);
	const log = await settled(page, "operations-log-card");
	await expect(log.getByTestId("sentence")).toContainText(
		"4 mục khớp bộ lọc: 2 sự cố, 1 hết hàng và 1 ghi chú bàn giao",
	);
	await expect(log).toContainText(TEXTS.handover);
	await page.getByTestId("log-filter-kind").selectOption("stock_out");
	await expect(page).toHaveURL(/kind=stock_out/);
	await expect(log.getByTestId("sentence")).toContainText("1 mục khớp bộ lọc");
	const actions = page.getByTestId("log-actions");
	await actions
		.getByRole("button", { name: /^Đánh dấu đã xử lý: Hết hàng/ })
		.click();
	await expect(page.getByTestId("log-action-status")).toHaveText(
		"Đã đánh dấu đã xử lý.",
	);
	await page.getByTestId("log-filter-kind").selectOption("incident");
	await page.getByTestId("log-filter-category").selectOption("thiet_bi");
	await expect(page).toHaveURL(/category=thiet_bi/);
	const entry = actions
		.getByTestId("log-entry")
		.filter({ hasText: TEXTS.incident });
	await entry.getByRole("button", { name: /^Xem ảnh:/ }).click();
	const photo = entry.getByTestId("photo-thumbnail");
	await expect(photo).toHaveAttribute("src", /^blob:/);
	await expect
		.poll(() =>
			photo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
		)
		.toBeGreaterThan(0);
	await entry.getByRole("button", { name: /^Đánh dấu đã xem:/ }).click();
	await expect(page.getByTestId("log-action-status")).toHaveText(
		"Đã đánh dấu đã xem.",
	);
	await expectCsvWithBom(page, "operations-log-card");
	await checkFromTop(page);
	await withSql(async (sql) => {
		const rows = await sql<
			{ id: string; status: string; acknowledged_by: string | null }[]
		>`
			select id, status, acknowledged_by from public.incidents
			where id in ${sql([made.incidentId, made.stockOutId])}
		`;
		const owner = settings().logins.owner.userId;
		expect(
			Object.fromEntries(
				rows.map((row) => [row.id, [row.status, row.acknowledged_by]]),
			),
		).toEqual({
			[made.incidentId]: ["seen", owner],
			[made.stockOutId]: ["resolved", owner],
		});
	});
	expectNoConsoleErrors(page);
});

test("Ca & két tiền puts the app's count beside the POS drawer for each shift, and Chất lượng dữ liệu flags the shift without a count and the missed checklists", async ({
	page,
}) => {
	const made = day();
	await signedIn(page, "owner");
	await page.goto(
		`/#/chu-de/ca-ket-tien?range=7d&store=${settings().storeIds[0]}`,
	);
	await waitForSettledThemeCards(page);
	const counts = await settled(page, "operations-card-cash-counts");
	const rows = (await bodyRows(counts)).filter(
		(row) => row[0] === dmy(made.countDay),
	);
	expect(rows.map((row) => [row[1], row[3] !== "—", row[4] !== "—"])).toEqual([
		["Ca 1", false, true],
		["Ca 2", true, true],
		["Ca 3", false, true],
	]);
	await expectShiftsLabelledByNumber(
		page,
		"operations-card-cash-counts",
		POS_NAMES,
	);
	await expect(
		counts.getByRole("link", { name: "Xem lịch sử két tiền" }),
	).toHaveAttribute("href", /#\/van-hanh\/ket-tien\?from=/);
	await checkFromTop(page);

	await page.goto(
		`/#/chu-de/chat-luong?range=7d&store=${settings().storeIds[0]}`,
	);
	await waitForSettledThemeCards(page);
	const missing = await settled(page, "operations-card-missing-counts");
	expect((await bodyRows(missing)).map((row) => row.slice(0, 2))).toEqual([
		[dmy(made.countDay), "Ca 1"],
		[dmy(made.countDay), "Ca 3"],
	]);
	const checklists = await settled(page, "operations-card-missing-checklists");
	const missed = await bodyRows(checklists);
	expect(missed.length).toBeGreaterThanOrEqual(3);
	expect(
		missed.filter((row) => row[0] === dmy(made.countDay)).map((row) => row[2]),
	).toEqual([
		TEMPLATE_TITLES.opening,
		TEMPLATE_TITLES.midshift,
		TEMPLATE_TITLES.closing,
	]);
	await checkFromTop(page);
	expectNoConsoleErrors(page);
});

test("the manager limited to store 1 sees only store 1's reports, and staff and the viewer get the reason on the pages and the cards", async ({
	browser,
}) => {
	const made = day();
	const limitedContext = await browser.newContext();
	const limited = await limitedContext.newPage();
	try {
		await signedIn(limited, "store-manager");
		await openOperations(
			limited,
			"su-co",
			`from=${minusDays(made.day, 1)}&to=${made.day}`,
		);
		const log = await settled(limited, "operations-log-card");
		await expect(log).toContainText(TEXTS.incident);
		await expect(log).not.toContainText(TEXTS.otherStore);
		await checkFromTop(limited);
		expectNoConsoleErrors(limited, [REFUSED_WRITE]);
	} finally {
		await limitedContext.close();
	}
	for (const role of ["staff", "viewer"] as const) {
		const pageContext = await browser.newContext();
		const page = await pageContext.newPage();
		try {
			await signedIn(page, role);
			await openOperations(page, "checklist", "range=7d");
			await expect(page.getByTestId("operations-read-only")).toHaveText(
				"Trang Vận hành chỉ dành cho chủ và quản lý.",
			);
			await expect(page.getByTestId("operations-checklist-card")).toHaveCount(
				0,
			);
			await checkFromTop(page);
			await page.goto("/#/chu-de/chat-luong?range=7d");
			await expect(
				page
					.getByTestId("operations-card-missing-counts")
					.getByTestId("card-plain"),
			).toHaveText("Mục này chỉ dành cho chủ và quản lý.");
			expectNoConsoleErrors(page);
		} finally {
			await pageContext.close();
		}
	}
});

test("teardown leaves no fixture tenant or login and every real tenant's rows and logins are as they were", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settingsFixture.teardown();
	await withSql(async (sql) => {
		const hex = settingsFixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<
			{ tenants: number; runs: number; counts: number; users: number }[]
		>`
			select
				(select count(*)::int from public.tenants where id = ${settingsFixture.tenantId}) as tenants,
				(select count(*)::int from public.checklist_runs where tenant_id = ${settingsFixture.tenantId}) as runs,
				(select count(*)::int from public.cash_counts where tenant_id = ${settingsFixture.tenantId}) as counts,
				(select count(*)::int from auth.users where email like ${`e2e-%-${hex}@example.com`}) as users
		`;
		expect(left).toEqual({ tenants: 0, runs: 0, counts: 0, users: 0 });
	});
	expect(await snapshotRealTenants(before)).toEqual(before);
});
