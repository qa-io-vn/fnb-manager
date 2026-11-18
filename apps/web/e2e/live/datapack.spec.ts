import { readFile } from "node:fs/promises";
import {
	buildDataPack,
	chatBundle,
	comparePackTexts,
	type DataPack,
	parsePack,
} from "@fnb/datapack";
import { createRpcReportSource } from "@fnb/reports";
import { expect, type Page, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPage } from "../support/checks";
import { clipboardText } from "../support/clipboard";
import { isLocalStackConfigured } from "../support/local-stack";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import {
	createSettingsFixture,
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
	return { text, pack: parsed.pack, packId: parsed.packId };
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
