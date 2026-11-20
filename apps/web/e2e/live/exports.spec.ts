import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
	liveLogin,
} from "../support/local-stack";
import { expect, type Page, test } from "../support/policy-test";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import {
	createSettingsFixture,
	openFixtureDatabase,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const PREFERENCES_KEY = "fnb.preferences.v1";
const BOM = [0xef, 0xbb, 0xbf];
const STORE_FILES = ["hoa-don", "dong-hoa-don", "thanh-toan", "ca"] as const;
const CASHIER_LOGIN = "cashier@example.com";
const CUSTOMER_NAME = "Khách Thử Nghiệm";
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

interface Target {
	readonly client: SupabaseClient;
	readonly tenantId: string | null;
	readonly signIn: (page: Page) => Promise<void>;
	readonly month: string;
	readonly storeNames: readonly string[];
	readonly fixture: SettingsFixture | null;
}

function previousMonth(date: string): string {
	const [year, month] = date.split("-").map(Number) as [number, number];
	return month === 1
		? `${year - 1}-12`
		: `${year}-${String(month - 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { from: string; to: string } {
	const [year, number] = month.split("-").map(Number) as [number, number];
	const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
	return {
		from: `${month}-01`,
		to: `${month}-${String(last).padStart(2, "0")}`,
	};
}

async function signInWith(page: Page, email: string, password: string) {
	await page.goto("/#/dang-nhap");
	await page.getByLabel("E-mail").fill(email);
	await page.getByLabel("Mật khẩu").fill(password);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
}

async function enrichFixture(fixture: SettingsFixture, month: string) {
	const sql = openFixtureDatabase();
	const { from, to } = monthBounds(month);
	try {
		await sql`
			insert into public.invoice_payments (
				tenant_id, store_id, invoice_id, sequence_no, business_date,
				payment_method_external_id, payment_method_name, amount, reference_no
			)
			select i.tenant_id, i.store_id, i.id, 1, i.business_date,
				i.primary_payment_method_external_id, i.primary_payment_method_name, i.paid_amount,
				'REF-' || i.external_id
			from public.invoices i
			where i.tenant_id = ${fixture.tenantId}
				and i.business_date between ${from}::date and ${to}::date
		`;
		await sql`
			insert into public.shifts (
				tenant_id, store_id, external_id, name, cashier_name, opened_at, closed_at,
				sales_amount, orders_count, opening_float_amount, expected_cash_amount, cash_drawer_amount
			)
			select ${fixture.tenantId}::uuid, s.id, 'CA-' || to_char(d, 'YYYYMMDD'),
				${CASHIER_LOGIN}, 'Thu ngân Lê',
				(d::date + time '07:30') at time zone 'Asia/Ho_Chi_Minh',
				(d::date + time '22:10') at time zone 'Asia/Ho_Chi_Minh',
				coalesce((select sum(i.net_amount) from public.invoices i where i.store_id = s.id and i.business_date = d::date), 0),
				(select count(*) from public.invoices i where i.store_id = s.id and i.business_date = d::date),
				500000, 1500000, case when extract(day from d)::integer % 2 = 0 then 1499000 else 1500000 end
			from public.stores s
			cross join generate_series(${from}::date, ${to}::date, interval '1 day') d
			where s.tenant_id = ${fixture.tenantId}
				and exists (select 1 from public.invoices i where i.store_id = s.id and i.business_date = d::date)
		`;
		await sql`
			update public.invoices
			set customer_name = ${CUSTOMER_NAME}, customer_phone = '0900000000'
			where tenant_id = ${fixture.tenantId}
				and business_date between ${from}::date and ${to}::date
				and external_id like '%-1'
		`;
	} finally {
		await sql.end();
	}
}

let target: Target;

test.beforeAll(async () => {
	const login = liveLogin();
	if (login.external) {
		const client = anonymousClient();
		const { error } = await client.auth.signInWithPassword({
			email: login.email,
			password: login.password,
		});
		if (error) throw error;
		let tenantId: string | null = null;
		if (login.tenantSlug !== null) {
			const { data, error: tenantError } = await client
				.from("tenants")
				.select("id")
				.eq("slug", login.tenantSlug)
				.single();
			if (tenantError) throw tenantError;
			tenantId = (data as { id: string }).id;
		}
		const today = new Date().toISOString().slice(0, 10);
		const { data: stores, error: storeError } = await client
			.from("stores")
			.select("name")
			.eq("active", true)
			.match(tenantId === null ? {} : { tenant_id: tenantId });
		if (storeError) throw storeError;
		target = {
			client,
			tenantId,
			signIn: (page) => signInWith(page, login.email, login.password),
			month: previousMonth(today),
			storeNames: (stores as { name: string }[]).map((store) => store.name),
			fixture: null,
		};
		return;
	}
	const fixture = await createSettingsFixture();
	const month = previousMonth(fixture.sales.to);
	await enrichFixture(fixture, month);
	target = {
		client: await fixture.clientAs("owner"),
		tenantId: fixture.tenantId,
		signIn: (page) => fixture.signIn(page, "owner"),
		month,
		storeNames: ["Cửa hàng thử 1", "Cửa hàng thử 2"],
		fixture,
	};
});

test.afterAll(async () => {
	await target?.fixture?.teardown();
});

async function openExportTab(
	page: Page,
	signIn: (page: Page) => Promise<void>,
) {
	watchConsoleErrors(page);
	if (target.tenantId !== null) {
		await page.addInitScript(
			([key, tenantId]) => {
				if (window.localStorage.getItem(key as string) === null) {
					window.localStorage.setItem(
						key as string,
						JSON.stringify({ tenantId, storeIds: null }),
					);
				}
			},
			[PREFERENCES_KEY, target.tenantId],
		);
	}
	await signIn(page);
	await page.goto("/#/xuat-du-lieu?tab=xuat");
	await expect(
		page.getByRole("heading", { level: 1, name: "Xuất dữ liệu" }),
	).toBeVisible();
}

async function exportMonth(
	page: Page,
	format: "csv" | "json",
	personal: boolean,
): Promise<Record<string, Uint8Array>> {
	await openExportTab(page, target.signIn);
	const form = page.getByTestId("export-form");
	await expect(form.getByRole("button", { name: "Xuất dữ liệu" })).toBeEnabled({
		timeout: 30_000,
	});
	for (const name of target.storeNames) {
		await expect(
			form.getByRole("checkbox", { name, exact: true }),
		).toBeChecked();
	}
	await page.getByLabel("Từ tháng").selectOption(target.month);
	await page.getByLabel("Đến tháng").selectOption(target.month);
	const personalBox = form.getByRole("checkbox", {
		name: "Kèm thông tin cá nhân",
	});
	await expect(personalBox).not.toBeChecked();
	if (personal) await personalBox.check();
	await form
		.getByRole("radio", { name: format === "csv" ? /^CSV/ : /^JSON/ })
		.check();
	await form.getByRole("button", { name: "Xuất dữ liệu" }).click();
	const confirm = page.getByTestId("exports-confirm");
	const result = page.getByTestId("export-result");
	await expect(confirm.or(result)).toBeVisible({ timeout: 120_000 });
	if (await confirm.isVisible()) {
		await confirm.getByRole("button", { name: "Vẫn xuất" }).click();
	}
	await expect(result).toBeVisible({ timeout: 300_000 });
	const lines = result.getByTestId("export-checks").getByRole("listitem");
	await expect(lines.first()).toBeVisible();
	for (const line of await lines.all()) {
		await expect(line).not.toHaveAttribute("data-verified", "false");
		await expect(line).not.toHaveAttribute("data-daily-matched", "false");
	}
	await expect(result.getByTestId("export-received")).toHaveText(
		/^Đã nhận [\d.,]+ MB \(chưa nén\)$/,
	);
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		result.getByTestId("export-download").click(),
	]);
	expect(download.suggestedFilename()).toBe(
		`fnb-xuat-du-lieu_${target.month}_${target.month}.zip`,
	);
	const path = await download.path();
	return unzipSync(new Uint8Array(await readFile(path)));
}

interface ManifestFile {
	readonly path: string;
	readonly table: string;
	readonly store: string | null;
	readonly rows: number;
	readonly bytes: number;
	readonly verified: boolean;
	readonly database_totals: { rows: number; fingerprint: string } | null;
	readonly exporter_totals: { rows: number; fingerprint: string } | null;
}

interface Manifest {
	readonly personal_columns: boolean;
	readonly stores: readonly { label: string; id: string; name: string }[];
	readonly files: readonly ManifestFile[];
}

const FINGERPRINT_COLUMNS: Readonly<Record<string, [string, string]>> = {
	invoices: ["invoices", "invoice_fingerprint"],
	invoice_lines: ["lines", "line_fingerprint"],
	invoice_payments: ["payments", "payment_fingerprint"],
	shifts: ["shifts", "shift_fingerprint"],
};

async function expectManifestEqualsDatabase(
	manifest: Manifest,
	month: string,
): Promise<void> {
	const { from, to } = monthBounds(month);
	for (const store of manifest.stores) {
		const { data, error } = await target.client.rpc("export_control_totals", {
			store_ids: [store.id],
			from_date: from,
			to_date: to,
		});
		expect(error).toBeNull();
		const row = (data as Record<string, unknown>[])[0] as Record<
			string,
			unknown
		>;
		for (const file of manifest.files.filter(
			(entry) => entry.store === store.label,
		)) {
			const [count, fingerprint] = FINGERPRINT_COLUMNS[file.table] as [
				string,
				string,
			];
			expect(file.rows, file.path).toBe(Number(row[count]));
			expect(file.database_totals?.fingerprint, file.path).toBe(
				row[fingerprint],
			);
			expect(file.exporter_totals?.fingerprint, file.path).toBe(
				row[fingerprint],
			);
		}
	}
}

function expectedPaths(manifest: Manifest, month: string, extension: string) {
	return [
		"manifest.json",
		"doc-truoc.txt",
		`${month}/tong-hop-ngay.${extension}`,
		...manifest.stores.flatMap((store) =>
			STORE_FILES.map((stem) => `${month}/${store.label}/${stem}.${extension}`),
		),
	];
}

test("a month's CSV export is verified against the tables, keeps diacritics and leaves personal data out", async ({
	page,
}) => {
	const files = await exportMonth(page, "csv", false);
	const manifest = JSON.parse(
		strictUtf8.decode(files["manifest.json"]),
	) as Manifest;
	expect(manifest.personal_columns).toBe(false);
	expect(Object.keys(files)).toEqual(
		expectedPaths(manifest, target.month, "csv"),
	);
	expect(manifest.files.every((file) => file.verified)).toBe(true);
	for (const file of manifest.files) {
		const bytes = files[file.path] as Uint8Array;
		expect([...bytes.slice(0, 3)], file.path).toEqual(BOM);
		expect(() => strictUtf8.decode(bytes), file.path).not.toThrow();
		expect(bytes.length, file.path).toBe(file.bytes);
	}
	await expectManifestEqualsDatabase(manifest, target.month);
	const first = manifest.stores[0];
	if (!first) throw new Error("no store in the manifest");
	const invoices = strictUtf8.decode(
		files[`${target.month}/${first.label}/hoa-don.csv`],
	);
	expect(invoices).toContain(first.name);
	expect(invoices.split("\r\n")[0]).not.toContain("customer_name");
	expect(invoices).not.toContain(CUSTOMER_NAME);
	const shifts = strictUtf8.decode(
		files[`${target.month}/${first.label}/ca.csv`],
	);
	expect(shifts.split("\r\n")[0]?.split(/[,;]/)).not.toContain("name");
	expect(shifts).not.toContain(CASHIER_LOGIN);
	if (target.fixture !== null) {
		expect(
			strictUtf8.decode(
				files[`${target.month}/${first.label}/dong-hoa-don.csv`],
			),
		).toMatch(/Trà sữa|Trà đào|Cà phê|Bánh flan|Hạt hướng dương/);
	}
	expect(strictUtf8.decode(files["doc-truoc.txt"])).toContain("receipt_no");
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("the same month as JSON carries no byte order mark and, when ticked, the personal columns", async ({
	page,
}) => {
	test.skip(
		target.fixture === null,
		"personal data is exported only on the fixture tenant",
	);
	const files = await exportMonth(page, "json", true);
	const manifest = JSON.parse(
		strictUtf8.decode(files["manifest.json"]),
	) as Manifest;
	expect(manifest.personal_columns).toBe(true);
	expect(Object.keys(files)).toEqual(
		expectedPaths(manifest, target.month, "json"),
	);
	expect(manifest.files.every((file) => file.verified)).toBe(true);
	for (const file of manifest.files) {
		const bytes = files[file.path] as Uint8Array;
		expect(bytes[0], file.path).toBe("{".charCodeAt(0));
		const document = JSON.parse(strictUtf8.decode(bytes));
		expect(document.format, file.path).toBe("fnb-export");
		expect(document.rows, file.path).toHaveLength(file.rows);
	}
	await expectManifestEqualsDatabase(manifest, target.month);
	const label = manifest.stores[0]?.label;
	const invoices = JSON.parse(
		strictUtf8.decode(files[`${target.month}/${label}/hoa-don.json`]),
	);
	expect(invoices.columns).toContain("customer_name");
	expect(JSON.stringify(invoices.rows)).toContain(CUSTOMER_NAME);
	const shifts = JSON.parse(
		strictUtf8.decode(files[`${target.month}/${label}/ca.json`]),
	);
	expect(shifts.rows[0]?.name).toBe(CASHIER_LOGIN);
	expectNoConsoleErrors(page);
});

for (const [role, explained] of [
	["staff", true],
	["viewer", true],
	["store-manager", false],
] as const satisfies readonly (readonly [SettingsRole, boolean])[]) {
	test(`a ${role} ${explained ? "sees the explanation instead of the form" : "gets the form without the personal-data box"}`, async ({
		page,
	}) => {
		test.skip(
			target.fixture === null,
			"roles are checked on the fixture tenant",
		);
		const fixture = target.fixture as SettingsFixture;
		await openExportTab(page, (current) => fixture.signIn(current, role));
		if (explained) {
			await expect(page.getByTestId("exports-denied")).toHaveText(
				"Chỉ chủ quán và quản lý xuất được dữ liệu.",
			);
			await expect(page.getByTestId("export-form")).toHaveCount(0);
		} else {
			await expect(
				page
					.getByTestId("export-form")
					.getByRole("button", { name: "Xuất dữ liệu" }),
			).toBeEnabled({ timeout: 30_000 });
			await expect(page.getByTestId("export-personal")).toHaveCount(0);
		}
		await checkPage(page);
		expectNoConsoleErrors(page);
	});
}
