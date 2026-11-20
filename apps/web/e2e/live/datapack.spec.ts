import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildDataPack,
	chatBundle,
	comparePackTexts,
	type DataPack,
	parsePack,
} from "@fnb/datapack";
import { createRpcReportSource } from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPage } from "../support/checks";
import { clipboardText } from "../support/clipboard";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import { type Download, expect, type Page, test } from "../support/policy-test";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import {
	createSettingsFixture,
	fixtureDatabaseUrl,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const BOM = [0xef, 0xbb, 0xbf];
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const FOCUS = "Tăng doanh thu buổi chiều";
const BUILD_TIMEOUT = 120_000;
const FNB_BIN = fileURLToPath(
	new URL("../../../jobs/bin/fnb.mjs", import.meta.url),
);
const SALES_FIELDS = new Set([
	"invoices",
	"net_amount",
	"net",
	"gross_amount",
	"paid_amount",
	"quantity",
	"items_sold",
	"value",
	"month_to_date_net_amount",
	"month_to_date_invoices",
]);

let fixture: SettingsFixture;

test.beforeAll(async () => {
	fixture = await createSettingsFixture();
});

test.afterAll(async () => {
	await fixture?.teardown();
});

interface BrowserPackFile {
	readonly text: string;
	readonly pack: DataPack;
	readonly packId: string;
	readonly download: Download;
}

interface FnbRun {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

function cliDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"DATABASE_URL is not set: this check runs fnb datapack against the local stack's database as a child process, so it stops here instead of skipping; set DATABASE_URL to the local database, as CI's e2e job does",
		);
	}
	try {
		return fixtureDatabaseUrl({ E2E_DATABASE_URL: url });
	} catch {
		throw new Error(
			"DATABASE_URL must be the local stack's database on a loopback host: this spec writes fixture logins and never reaches another database",
		);
	}
}

function runFnb(
	args: readonly string[],
	databaseUrl: string,
	folder: string,
): Promise<FnbRun> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [FNB_BIN, ...args], {
			cwd: folder,
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
				SUPABASE_DB_URL: "",
				INIT_CWD: folder,
			},
			windowsHide: true,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (code) =>
			resolve({
				code,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			}),
		);
	});
}

function salesFigures(rows: readonly unknown[]): number {
	let found = 0;
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		for (const [key, value] of Object.entries(row)) {
			if (SALES_FIELDS.has(key) && Number(value) > 0) found += 1;
		}
	}
	return found;
}

async function buildInBrowser(
	page: Page,
	role: SettingsRole,
	search: string,
): Promise<BrowserPackFile> {
	await fixture.signIn(page, role);
	await page.goto(`/#/xuat-du-lieu?tab=goi${search}`);
	const form = page.getByTestId("pack-form");
	await form.getByRole("button", { name: "Tạo gói", exact: true }).click();
	const result = page.getByTestId("pack-result");
	await expect(result).toBeVisible({ timeout: BUILD_TIMEOUT });
	await expect(result.getByTestId("pack-sample")).toHaveCount(0);
	await expect(result.getByTestId("pack-summary")).not.toContainText(
		"dữ liệu mẫu",
	);
	const [file] = await Promise.all([
		page.waitForEvent("download"),
		result.getByRole("link", { name: "Tải gói dữ liệu cho AI" }).click(),
	]);
	const bytes = new Uint8Array(await readFile(await file.path()));
	expect([...bytes.slice(0, 3)]).not.toEqual(BOM);
	const text = strictUtf8.decode(bytes);
	const parsed = await parsePack(text);
	expect(parsed.issues).toEqual([]);
	if (parsed.pack === null || parsed.packId === null) {
		throw new Error("the downloaded file is not a pack");
	}
	expect(file.suggestedFilename()).toBe(
		`goi-du-lieu_${parsed.pack.request.as_of}_tat-ca_${parsed.packId.slice(0, 8)}.json`,
	);
	await expect(result.getByTestId("pack-id")).toHaveText(
		parsed.packId.slice(0, 8),
	);
	return { text, pack: parsed.pack, packId: parsed.packId, download: file };
}

function fenceOf(
	client: SupabaseClient,
	storeIds: readonly string[],
): () => Promise<string> {
	return async () => {
		const { data, error } = await client.rpc("pack_fence", {
			store_ids: [...storeIds],
		});
		if (error) throw error;
		return data as string;
	};
}

test("the owner's browser pack equals the package's own build in the same session, apart from its time, and the copy carries that pack", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	watchConsoleErrors(page);
	const asOf = fixture.sales.to;
	const browserPack = await buildInBrowser(
		page,
		"owner",
		`&asOf=${asOf}&horizon=90d&lang=vi&focus=${encodeURIComponent(FOCUS)}`,
	);
	const { pack } = browserPack;
	expect(pack.sample).toBe(false);
	expect(pack.request.as_of).toBe(asOf);
	expect(pack.request.focus).toBe(FOCUS);
	expect(pack.request.stores.map((store) => store.id).sort()).toEqual(
		[...fixture.storeIds].sort(),
	);
	expect(pack.budget.estimated_tokens).toBeLessThanOrEqual(30_000);

	const client = await fixture.clientAs("owner");
	const storeIds = [...fixture.storeIds];
	const direct = await buildDataPack(
		{
			storeIds,
			asOf,
			horizon: "90d",
			language: "vi",
			focus: FOCUS,
			ownerNote: null,
			sample: false,
		},
		{
			source: createRpcReportSource(
				{ rpc: (fn, args) => client.rpc(fn, args) },
				"supabase",
			),
			clock: { now: () => new Date() },
			fence: fenceOf(client, storeIds),
		},
	);
	expect(await comparePackTexts(browserPack.text, direct.text)).toEqual({
		valid: true,
		identical_apart_from_generated_at: true,
		pack_id_equal: true,
		tables_differing: [],
	});

	const result = page.getByTestId("pack-result");
	await result.getByRole("button", { name: "Sao chép gói + prompt" }).click();
	await expect(result.getByTestId("pack-copy-status")).toHaveText(
		"Đã sao chép lời nhắc và gói dữ liệu. Dán vào khung chat của trợ lý.",
	);
	const copied = await clipboardText(page);
	expect(copied.startsWith("# Lời nhắc chiến lược fnb-strategy\n")).toBe(true);
	expect(copied).toBe(chatBundle(pack));
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("the browser's download and the pack of fnb datapack for the same owner, day, horizon, language and focus are identical apart from generated_at, as fnb datapack --check --against reports", async ({
	page,
}) => {
	const databaseUrl = cliDatabaseUrl();
	watchConsoleErrors(page);
	const asOf = fixture.sales.to;
	const browser = await buildInBrowser(
		page,
		"owner",
		`&asOf=${asOf}&horizon=90d&lang=vi&focus=${encodeURIComponent(FOCUS)}`,
	);
	const folder = await mkdtemp(join(tmpdir(), "fnb-pack-identity-"));
	try {
		const browserFile = join(folder, "browser.json");
		const cliFile = join(folder, "cli.json");
		await browser.download.saveAs(browserFile);
		expect(await readFile(browserFile, "utf8")).toBe(browser.text);
		const built = await runFnb(
			[
				"datapack",
				"--tenant",
				fixture.slug,
				"--member",
				fixture.logins.owner.email,
				"--as-of",
				asOf,
				"--horizon",
				"90d",
				"--language",
				"vi",
				"--focus",
				FOCUS,
				"--out",
				cliFile,
				"--json",
			],
			databaseUrl,
			folder,
		);
		expect(built.code, built.stderr).toBe(0);
		expect(
			JSON.parse(built.stdout.trim().split("\n").at(-1) ?? ""),
		).toMatchObject({
			valid: true,
			aggregates_only: true,
			as_of: asOf,
			horizon: "90d",
			language: "vi",
			stores: ["S1", "S2"],
		});
		const cli = await parsePack(await readFile(cliFile, "utf8"));
		expect(cli.valid).toBe(true);
		expect(cli.packId).toBe(browser.packId);
		const compared = await runFnb(
			["datapack", "--check", browserFile, "--against", cliFile, "--json"],
			databaseUrl,
			folder,
		);
		expect(
			JSON.parse(compared.stdout.trim().split("\n").at(-1) ?? ""),
			compared.stderr,
		).toEqual({
			valid: true,
			identical_apart_from_generated_at: true,
			pack_id_equal: true,
			tables_differing: [],
		});
		expect(compared.code).toBe(0);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
	expectNoConsoleErrors(page);
});

test("a publisher cannot build a pack: fnb datapack refuses its login with exit 1, and its own session reads no sales row", async () => {
	const databaseUrl = cliDatabaseUrl();
	const publisher = await fixture.addPublisher();
	const asOf = fixture.sales.to;
	const folder = await mkdtemp(join(tmpdir(), "fnb-pack-publisher-"));
	try {
		const out = join(folder, "publisher.json");
		const refused = await runFnb(
			[
				"datapack",
				"--tenant",
				fixture.slug,
				"--member",
				publisher.email,
				"--as-of",
				asOf,
				"--out",
				out,
			],
			databaseUrl,
			folder,
		);
		expect(refused.code, refused.stderr).toBe(1);
		expect(refused.stderr).toContain(
			"a publisher login reads no figures, so it cannot build a pack",
		);
		expect(existsSync(out)).toBe(false);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}

	const request = {
		storeIds: [...fixture.storeIds],
		asOf,
		horizon: "90d" as const,
		language: "vi" as const,
		focus: null,
		ownerNote: null,
		sample: false,
	};
	const owner = await fixture.clientAs("owner");
	const ownerBuild = await buildDataPack(request, {
		source: createRpcReportSource(
			{ rpc: (fn, args) => owner.rpc(fn, args) },
			"supabase",
		),
		clock: { now: () => new Date() },
		fence: fenceOf(owner, fixture.storeIds),
	});
	const session = anonymousClient();
	const { error } = await session.auth.signInWithPassword({
		email: publisher.email,
		password: publisher.password,
	});
	if (error) throw error;
	let ownerSales = 0;
	let ownerMonthToDate = 0;
	for (const call of ownerBuild.calls) {
		ownerSales += salesFigures(call.rows);
		if (call.name === "month_pace") {
			ownerMonthToDate += salesFigures(call.rows);
		}
		const { data, error: callError } = await session.rpc(call.name, call.args);
		expect(callError, call.key).toBeNull();
		expect(Array.isArray(data), call.key).toBe(true);
		expect(salesFigures(data as unknown[]), call.key).toBe(0);
	}
	expect(ownerSales).toBeGreaterThan(0);
	expect(ownerMonthToDate).toBeGreaterThan(0);
	await session.auth.signOut();
});

test("a manager limited to one store builds a pack of that store alone", async ({
	page,
}) => {
	watchConsoleErrors(page);
	const { pack } = await buildInBrowser(page, "store-manager", "");
	expect(pack.request.stores.map((store) => store.id)).toEqual([
		fixture.storeIds[0],
	]);
	expect(pack.sample).toBe(false);
	expectNoConsoleErrors(page);
});

test("a staff member reads the explanation instead of the pack form", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await fixture.signIn(page, "staff");
	await page.goto("/#/xuat-du-lieu?tab=goi");
	await expect(page.getByTestId("exports-denied")).toHaveText(
		"Chỉ chủ quán và quản lý xuất được dữ liệu.",
	);
	await expect(page.getByTestId("pack-form")).toHaveCount(0);
	expectNoConsoleErrors(page);
});
