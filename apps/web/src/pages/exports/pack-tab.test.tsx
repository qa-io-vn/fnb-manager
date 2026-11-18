import {
	chatBundle,
	DataPackError,
	type DataPackRequest,
	PACK_GAPS,
	type PackErrorCode,
	parsePack,
} from "@fnb/datapack";
import { createDemoReportSource } from "@fnb/demo-analytics";
import type { ReportSource } from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreRow } from "../../data/row-source";
import {
	type BrowserPack,
	type BrowserPackOptions,
	type BuildBrowserPack,
	buildBrowserPack,
} from "../../datapack/browser-pack";
import {
	cachedPacks,
	cachedPackText,
	OWNER_NOTE_KEY_PREFIX,
	PACK_CACHE_SIZE,
	PACK_KEY_PREFIX,
	rememberedOwnerNote,
	rememberOwnerNote,
	rememberPack,
} from "../../datapack/pack-cache";
import { I18nProvider, type Language } from "../../i18n";
import { noticeRoutes } from "../../reports/card-adapter";
import type { Membership, SettingsSource } from "../../settings/source";
import { SignOutButton } from "../../shell/sign-out-button";
import { ExportsPage } from "./exports-page";
import {
	errorCodeOf,
	failureOf,
	PACK_FAILURES,
	type PackFormValues,
	packDefaults,
	packRequestOf,
	requestTextLength,
} from "./pack-request";
import { PackWorkflow } from "./pack-tab";

const NOW = new Date("2026-11-12T03:00:00Z");
const CLOCK = { now: () => NOW };
const DAY = 86_400_000;

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

function storeRow(id: string, name: string): StoreRow {
	return {
		id,
		tenantId: TENANT.id,
		name,
		code: null,
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
		posAccountId: "44444444-4444-4444-8444-444444444444",
	};
}

const DEMO_STORES = [
	storeRow("MOCK-S1", "Cửa hàng mẫu 1"),
	storeRow("MOCK-S2", "Cửa hàng mẫu 2"),
];

const current = vi.hoisted(() => ({
	mode: "demo" as "live" | "demo",
	membership: null as unknown,
	analytics: { status: "loading" } as unknown,
	signedOut: 0,
}));

vi.mock("../../app-mode/app-mode", () => ({
	useAppMode: () => ({ mode: current.mode }),
}));

vi.mock("../../auth/session", () => ({
	useSession: () => ({
		status: "signed-in",
		client: {
			rpc: async () => ({ data: "fence", error: null }),
			auth: {
				signOut: async () => {
					current.signedOut += 1;
					return { error: null };
				},
			},
		},
	}),
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: TENANT,
		stores: DEMO_STORES,
		selectedStores: DEMO_STORES,
	}),
}));

vi.mock("../../data/analytics-source-context", () => ({
	useAnalyticsSourceState: () => current.analytics,
}));

vi.mock("../../settings/settings-source-context", () => ({
	useSettingsSourceState: () => ({
		status: "ready",
		source: {
			kind: "demo",
			membership: async () => current.membership,
		} as unknown as SettingsSource,
		manual: {},
	}),
	useRetrySettingsSource: () => () => undefined,
}));

function demoSource(): ReportSource {
	return createDemoReportSource({ now: () => NOW });
}

const fixedBuild: BuildBrowserPack = (request, options) =>
	buildBrowserPack(request, { ...options, clock: CLOCK });

function renderWorkflow({
	build = fixedBuild,
	stores = DEMO_STORES,
	allStores = true,
	search = "",
	language = "vi",
	tenant = TENANT,
}: {
	build?: BuildBrowserPack;
	stores?: readonly StoreRow[];
	allStores?: boolean;
	search?: string;
	language?: Language;
	tenant?: typeof TENANT;
} = {}) {
	return render(
		<I18nProvider language={language} onLanguageChange={() => undefined}>
			<MemoryRouter>
				<PackWorkflow
					source={demoSource()}
					rpc={null}
					sample
					tenant={tenant}
					stores={stores}
					allStores={allStores}
					params={new URLSearchParams(search)}
					language={language}
					build={build}
					now={NOW}
				/>
			</MemoryRouter>
		</I18nProvider>,
	);
}

function pendingBuild(): {
	readonly build: BuildBrowserPack;
	readonly calls: { request: DataPackRequest; options: BrowserPackOptions }[];
} {
	const calls: { request: DataPackRequest; options: BrowserPackOptions }[] = [];
	return {
		calls,
		build: (request, options) => {
			calls.push({ request, options });
			return new Promise<BrowserPack>((_resolve, reject) => {
				options.signal.addEventListener("abort", () =>
					reject(new DOMException("stopped", "AbortError")),
				);
			});
		},
	};
}

function fakePack(overrides: Partial<BrowserPack> = {}): BrowserPack {
	return {
		text: "{}\n",
		bundle: "# Lời nhắc chiến lược fnb-strategy\n\nbundle",
		packId: "a".repeat(64),
		estimatedTokens: 12_000,
		trimmed: [],
		asOf: "2026-11-11",
		horizon: "90d",
		language: "vi",
		sample: false,
		stores: [{ id: "MOCK-S1", label: "S1" }],
		gaps: [],
		tables: [{ id: "kpi", title: "KPI", rows: 18 }],
		...overrides,
	};
}

function values(overrides: Partial<PackFormValues> = {}): PackFormValues {
	return {
		asOf: "",
		horizon: "90d",
		language: "vi",
		focus: "",
		ownerNote: "",
		...overrides,
	};
}

let blobs: Blob[] = [];

beforeEach(() => {
	blobs = [];
	URL.createObjectURL = vi.fn((blob: Blob) => {
		blobs.push(blob);
		return `blob:fnb-${blobs.length}`;
	});
	URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
	window.localStorage.clear();
	vi.unstubAllGlobals();
});

async function textOf(blob: Blob | undefined): Promise<string> {
	if (blob === undefined) throw new Error("no blob");
	const bytes = new Uint8Array(await blob.arrayBuffer());
	expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

describe("the pack form's values", () => {
	it("reads the as-of day, horizon, language and focus from the address and falls back otherwise", () => {
		expect(
			packDefaults(
				new URLSearchParams(
					"tab=goi&asOf=2026-11-10&horizon=180d&lang=en&focus=B%C3%A1n+chi%E1%BB%81u",
				),
				{ language: "vi", asOf: "2026-11-11", ownerNote: "Sửa quán" },
			),
		).toEqual({
			asOf: "2026-11-10",
			horizon: "180d",
			language: "en",
			focus: "Bán chiều",
			ownerNote: "Sửa quán",
		});
		expect(
			packDefaults(new URLSearchParams("asOf=2026-02-30&horizon=7d&lang=fr"), {
				language: "en",
				asOf: "2026-11-11",
				ownerNote: "",
			}),
		).toEqual(values({ asOf: "2026-11-11", language: "en" }));
	});

	it("builds the request from the top bar's stores, with null for an empty day and empty texts", () => {
		expect(
			packRequestOf(values({ focus: "  " }), ["MOCK-S1", "MOCK-S2"], true),
		).toEqual({
			storeIds: ["MOCK-S1", "MOCK-S2"],
			asOf: null,
			horizon: "90d",
			language: "vi",
			focus: null,
			ownerNote: null,
			sample: true,
		});
		expect(
			packRequestOf(
				values({ asOf: "2026-11-01", ownerNote: "Sửa quán tháng 10" }),
				["MOCK-S2"],
				false,
			),
		).toMatchObject({
			asOf: "2026-11-01",
			ownerNote: "Sửa quán tháng 10",
			sample: false,
		});
	});

	it("counts characters as the builder does: composed, runs of spaces collapsed, ends trimmed", () => {
		expect(requestTextLength("  a \n\t b  ")).toBe(3);
		expect(requestTextLength("Tăng")).toBe(4);
		expect(requestTextLength("Tăng")).toBe(4);
	});

	it("names each refusal the screen explains, keeps its code, and calls the rest a failure", () => {
		for (const code of PACK_FAILURES) {
			const error = new DataPackError(code, "x");
			expect(failureOf(error)).toBe(code);
			expect(errorCodeOf(error)).toBe(code);
		}
		expect(failureOf(new DataPackError("pack_invalid", "x"))).toBe("failed");
		expect(errorCodeOf(new DataPackError("pack_invalid", "x"))).toBe(
			"pack_invalid",
		);
		expect(failureOf(new Error("offline"))).toBe("failed");
		expect(errorCodeOf(new Error("offline"))).toBeNull();
		expect(errorCodeOf({ code: "22023" })).toBeNull();
	});
});

describe("the Gói dữ liệu cho AI tab", () => {
	it("idle: shows the top bar's stores read-only, the day, the horizon, the focus with suggestions, the note and the plan language", async () => {
		const user = userEvent.setup();
		rememberOwnerNote(TENANT.id, "Quán sửa trong tháng 10");
		renderWorkflow({ search: "horizon=12m&lang=en" });
		const stores = screen.getByTestId("pack-stores-field");
		expect(
			within(stores)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Cửa hàng mẫu 1", "Cửa hàng mẫu 2"]);
		expect(within(stores).queryAllByRole("checkbox")).toHaveLength(0);
		expect(stores).toHaveTextContent("Muốn đổi, hãy chọn lại ở đó");
		const asOf = screen.getByLabelText("Dữ liệu đến hết ngày");
		expect(asOf).toHaveValue("2026-11-11");
		expect(asOf).toHaveAttribute("max", "2026-11-11");
		for (const name of ["30 ngày", "90 ngày", "6 tháng"]) {
			expect(screen.getByRole("radio", { name })).not.toBeChecked();
		}
		expect(screen.getByRole("radio", { name: "12 tháng" })).toBeChecked();
		expect(screen.getByRole("radio", { name: "Tiếng Anh" })).toBeChecked();
		expect(screen.getByLabelText("Ghi chú của chủ quán")).toHaveValue(
			"Quán sửa trong tháng 10",
		);
		const focus = screen.getByLabelText("Trọng tâm");
		expect(focus).toHaveValue("");
		const chip = within(screen.getByTestId("pack-focus-suggestions")).getByRole(
			"button",
			{ name: "Tăng doanh thu buổi chiều" },
		);
		await user.click(chip);
		expect(focus).toHaveValue("Tăng doanh thu buổi chiều");
		expect(chip).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "Tạo gói" })).toBeEnabled();
	});

	it("building: shows Đang tạo gói n/N in a live region, sends the form's request and stops on Dừng", async () => {
		const user = userEvent.setup();
		const pending = pendingBuild();
		renderWorkflow({
			build: pending.build,
			stores: [DEMO_STORES[1] as StoreRow],
			allStores: false,
			search: "asOf=2026-11-01",
		});
		await user.click(screen.getByRole("radio", { name: "6 tháng" }));
		await user.type(screen.getByLabelText("Ghi chú của chủ quán"), "Sửa quán");
		await user.click(screen.getByRole("button", { name: "Tạo gói" }));
		const progress = await screen.findByTestId("pack-progress-line");
		expect(progress).toHaveAttribute("role", "status");
		expect(progress).toHaveTextContent("Đang tạo gói…");
		const [call] = pending.calls;
		expect(call?.request).toEqual({
			storeIds: ["MOCK-S2"],
			asOf: "2026-11-01",
			horizon: "180d",
			language: "vi",
			focus: null,
			ownerNote: "Sửa quán",
			sample: true,
		});
		expect(call?.options.rpc).toBeNull();
		call?.options.onProgress(3, 18);
		expect(await screen.findByText("Đang tạo gói 3/18")).toBe(
			screen.getByTestId("pack-progress-line"),
		);
		await user.click(screen.getByRole("button", { name: "Dừng" }));
		expect(call?.options.signal.aborted).toBe(true);
		expect(await screen.findByTestId("pack-stopped")).toHaveTextContent(
			"Đã dừng tạo gói. Chưa có tệp nào được tạo.",
		);
		expect(blobs).toHaveLength(0);
	});

	it("built: summarises the demo's sample pack, lists its tables and gaps, downloads its exact text and copies the prompt with it", async () => {
		const user = userEvent.setup();
		renderWorkflow({
			search: "focus=T%C4%83ng+gi%C3%A1+tr%E1%BB%8B+h%C3%B3a+%C4%91%C6%A1n",
		});
		await user.click(screen.getByRole("button", { name: "Tạo gói" }));
		const result = await screen.findByTestId(
			"pack-result",
			{},
			{ timeout: 30_000 },
		);
		const text = await textOf(blobs[0]);
		expect(blobs[0]?.type).toBe("application/json");
		const parsed = await parsePack(text);
		expect(parsed.valid).toBe(true);
		if (parsed.pack === null || parsed.packId === null)
			throw new Error("no pack");
		expect(parsed.pack.sample).toBe(true);
		expect(parsed.pack.request.focus).toBe("Tăng giá trị hóa đơn");
		expect(parsed.pack.request.as_of).toBe("2026-11-11");

		const summary = within(result).getByTestId("pack-summary");
		expect(summary).toHaveTextContent("dữ liệu mẫu");
		expect(within(result).getByTestId("pack-source")).toHaveTextContent(
			"dữ liệu mẫu của bản demo",
		);
		expect(within(result).getByTestId("pack-tokens")).toHaveTextContent(
			`khoảng ${parsed.pack.budget.estimated_tokens.toLocaleString("vi-VN")} / 30.000 token`,
		);
		expect(within(result).getByTestId("pack-id")).toHaveTextContent(
			parsed.packId.slice(0, 8),
		);
		expect(within(result).getByTestId("pack-table-count")).toHaveTextContent(
			"20 bảng",
		);
		expect(within(result).getByTestId("pack-as-of-day")).toHaveTextContent(
			"11/11/2026",
		);
		expect(within(result).getByTestId("pack-stores")).toHaveTextContent(
			"S1 · Cửa hàng mẫu 1, S2 · Cửa hàng mẫu 2",
		);
		expect(within(result).getByTestId("pack-totals-only")).toHaveTextContent(
			"Gói chỉ chứa số tổng hợp",
		);
		const tables = within(result).getByTestId("pack-tables");
		expect(within(tables).getAllByRole("listitem")).toHaveLength(20);
		const kpiRows = Object.keys(parsed.pack.tables.kpi?.rows ?? {}).length;
		expect(tables.querySelector('[data-table="kpi"]')).toHaveTextContent(
			`${parsed.pack.tables.kpi?.title}: ${kpiRows} dòng`,
		);

		const download = within(result).getByRole("link", {
			name: "Tải gói dữ liệu cho AI",
		});
		expect(download).toHaveAttribute("href", "blob:fnb-1");
		expect(download).toHaveAttribute(
			"download",
			`goi-du-lieu_2026-11-11_tat-ca_${parsed.packId.slice(0, 8)}.json`,
		);
		expect(cachedPackText(parsed.packId)).toBe(text);

		await user.click(
			within(result).getByRole("button", { name: "Sao chép gói + prompt" }),
		);
		const copied = await navigator.clipboard.readText();
		expect(copied).toBe(chatBundle(parsed.pack));
		expect(copied.startsWith("# Lời nhắc chiến lược fnb-strategy\n")).toBe(
			true,
		);
		const status = within(result).getByTestId("pack-copy-status");
		expect(status).toHaveAttribute("aria-live", "polite");
		expect(status).toHaveTextContent("Đã sao chép lời nhắc và gói dữ liệu.");
		expect(screen.queryByTestId("pack-copy-dialog")).toBeNull();

		const gaps = within(result)
			.getAllByRole("listitem")
			.filter((item) => item.hasAttribute("data-gap"));
		expect(gaps.length).toBeGreaterThan(0);
		for (const item of gaps) {
			const code = item.getAttribute("data-gap") as keyof typeof PACK_GAPS;
			const setting = PACK_GAPS[code].setting;
			const links = within(item).queryAllByRole("link");
			expect(item.textContent).not.toMatch(/exports\./);
			if (setting === null) {
				expect(links).toHaveLength(0);
			} else {
				expect(links.map((link) => link.getAttribute("href"))).toEqual([
					noticeRoutes[setting],
				]);
			}
		}
		const target = gaps.find(
			(item) => item.getAttribute("data-gap") === "target",
		);
		expect(target).toHaveTextContent("S2 · Cửa hàng mẫu 2");
		expect(
			within(target as HTMLElement).getByRole("link", {
				name: "Đặt mục tiêu tháng",
			}),
		).toHaveAttribute("href", "/cai-dat/du-lieu-nhap-tay?tab=muc-tieu");

		const steps = within(result).getByTestId("pack-steps");
		expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
		expect(
			within(steps).getByRole("link", { name: "Dán kế hoạch" }),
		).toHaveAttribute("href", "/ke-hoach/dan");

		await user.click(
			within(result).getByRole("button", { name: "Tạo gói khác" }),
		);
		expect(await screen.findByTestId("pack-form")).toBeInTheDocument();
		expect(screen.getByLabelText("Trọng tâm")).toHaveValue(
			"Tăng giá trị hóa đơn",
		);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fnb-1");
	}, 60_000);

	it.each([
		[
			"pack_text_contact_details",
			"Điều muốn ưu tiên hoặc ghi chú có vẻ chứa e-mail, số điện thoại",
		],
		["pack_text_too_long", "quá dài."],
		[
			"pack_as_of_not_complete",
			"Số liệu chỉ đến được hết ngày 11/11/2026 hoặc một ngày sớm hơn",
		],
		["pack_stores_invalid", "tối đa 10 cửa hàng"],
		["pack_data_changed", "Hãy chờ khoảng một phút rồi thử lại."],
		["pack_not_aggregate", "tên món giống số điện thoại"],
		[
			"pack_over_budget",
			"Gói vượt giới hạn 30.000 token cả sau khi rút gọn. Hãy chọn ít cửa hàng hơn.",
		],
		["pack_invalid", "Không tạo được gói dữ liệu. Thử lại sau ít phút."],
	] as const)(
		"shows %s in an error card with its code and a retry",
		async (code, message) => {
			const user = userEvent.setup();
			let attempts = 0;
			renderWorkflow({
				build: async () => {
					attempts += 1;
					throw new DataPackError(code as PackErrorCode, "refused");
				},
			});
			await user.click(screen.getByRole("button", { name: "Tạo gói" }));
			const card = await screen.findByTestId("pack-failed");
			expect(card).toHaveAttribute("role", "alert");
			expect(within(card).getByTestId("pack-failed-message")).toHaveTextContent(
				message,
			);
			expect(within(card).getByTestId("pack-failed-code")).toHaveTextContent(
				`Mã lỗi: ${code}`,
			);
			await user.click(within(card).getByRole("button", { name: "Thử lại" }));
			await waitFor(() => expect(attempts).toBe(2));
			expect(await screen.findByTestId("pack-failed")).toBeInTheDocument();
			await user.click(screen.getByRole("radio", { name: "30 ngày" }));
			expect(screen.queryByTestId("pack-failed")).toBeNull();
		},
	);

	it("explains a failed read in English without a code", async () => {
		const user = userEvent.setup();
		renderWorkflow({
			language: "en",
			build: async () => {
				throw new Error("offline");
			},
		});
		await user.click(screen.getByRole("button", { name: "Build the pack" }));
		const card = await screen.findByTestId("pack-failed");
		expect(card).toHaveTextContent(
			"The data pack could not be built. Try again in a few minutes.",
		);
		expect(within(card).queryByTestId("pack-failed-code")).toBeNull();
		expect(
			within(card).getByRole("button", { name: "Try again" }),
		).toBeEnabled();
	});

	const refusingClipboard = (): Pick<Clipboard, "writeText"> => ({
		writeText: async () => {
			throw new DOMException("denied", "NotAllowedError");
		},
	});
	const missingClipboard = (): undefined => undefined;

	it.each([
		["refuses", refusingClipboard],
		["has no clipboard API", missingClipboard],
	] as const)(
		"the copy fallback: when the browser %s, a dialog offers the text selected and a download",
		async (_case, clipboard) => {
			const user = userEvent.setup();
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: clipboard(),
			});
			const pack = fakePack({ stores: [{ id: "MOCK-S2", label: "S2" }] });
			renderWorkflow({ build: async () => pack, allStores: false });
			await user.click(screen.getByRole("button", { name: "Tạo gói" }));
			const result = await screen.findByTestId("pack-result");
			const copy = within(result).getByRole("button", {
				name: "Sao chép gói + prompt",
			});
			await user.click(copy);
			const dialog = await screen.findByRole("dialog", {
				name: "Sao chép thủ công",
			});
			expect(within(result).getByTestId("pack-copy-status")).toHaveTextContent(
				"Trình duyệt không cho sao chép tự động.",
			);
			const box = within(dialog).getByRole("textbox", {
				name: "Gói dữ liệu kèm lời nhắc",
			}) as HTMLTextAreaElement;
			expect(box).toHaveAttribute("readonly");
			expect(box.value).toBe(pack.bundle);
			expect(box).toHaveFocus();
			expect([box.selectionStart, box.selectionEnd]).toEqual([
				0,
				pack.bundle.length,
			]);
			expect(dialog).toHaveTextContent("Ctrl+C");
			const download = within(dialog).getByRole("link", {
				name: "Tải văn bản này",
			});
			expect(download).toHaveAttribute(
				"download",
				`goi-du-lieu-kem-prompt_2026-11-11_s2_${"a".repeat(8)}.txt`,
			);
			const bundleBlob = blobs.at(-1);
			expect(download).toHaveAttribute("href", `blob:fnb-${blobs.length}`);
			expect(await textOf(bundleBlob)).toBe(pack.bundle);
			await user.click(within(dialog).getByRole("button", { name: "Đóng" }));
			expect(screen.queryByTestId("pack-copy-dialog")).toBeNull();
			expect(copy).toHaveFocus();
		},
	);

	it("offers Chia sẻ only where the browser can share files, and shares the pack file", async () => {
		const user = userEvent.setup();
		const shared: ShareData[] = [];
		Object.defineProperty(navigator, "canShare", {
			configurable: true,
			value: (data: ShareData) => (data.files?.length ?? 0) === 1,
		});
		Object.defineProperty(navigator, "share", {
			configurable: true,
			value: async (data: ShareData) => {
				shared.push(data);
			},
		});
		try {
			const pack = fakePack({ text: '{"a":1}\n' });
			renderWorkflow({ build: async () => pack });
			await user.click(screen.getByRole("button", { name: "Tạo gói" }));
			const result = await screen.findByTestId("pack-result");
			await user.click(within(result).getByRole("button", { name: "Chia sẻ" }));
			expect(shared).toHaveLength(1);
			const file = shared[0]?.files?.[0];
			expect(file?.name).toBe(
				`goi-du-lieu_2026-11-11_tat-ca_${"a".repeat(8)}.json`,
			);
			expect(file?.type).toBe("application/json");
			expect(await file?.text()).toBe('{"a":1}\n');
		} finally {
			Reflect.deleteProperty(navigator, "canShare");
			Reflect.deleteProperty(navigator, "share");
		}
	});

	it("hides Chia sẻ where the browser cannot share files, and shows trimming and a small pack", async () => {
		const user = userEvent.setup();
		renderWorkflow({
			build: async () =>
				fakePack({ trimmed: ["heatmap_invoices:drop", "pairs:all_only"] }),
		});
		await user.click(screen.getByRole("button", { name: "Tạo gói" }));
		const result = await screen.findByTestId("pack-result");
		expect(
			within(result).queryByRole("button", { name: "Chia sẻ" }),
		).toBeNull();
		expect(within(result).queryByTestId("pack-source")).toBeNull();
		expect(within(result).queryByTestId("pack-sample")).toBeNull();
		expect(within(result).getByTestId("pack-small")).toBeInTheDocument();
		expect(within(result).getByTestId("pack-trimmed")).toHaveTextContent(
			"bỏ bảng số hóa đơn theo giờ",
		);
		expect(within(result).getByTestId("pack-gaps-none")).toBeInTheDocument();
	});

	it("refuses more than ten stores and over-long texts before building", async () => {
		const user = userEvent.setup();
		const many = Array.from({ length: 11 }, (_, index) =>
			storeRow(
				`${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
				`Cửa hàng ${index + 1}`,
			),
		);
		const pending = pendingBuild();
		const { unmount } = renderWorkflow({ build: pending.build, stores: many });
		expect(screen.getByRole("button", { name: "Tạo gói" })).toBeDisabled();
		expect(screen.getByTestId("pack-stores-error")).toHaveTextContent(
			"Một gói có tối đa 10 cửa hàng. Hãy chọn ít cửa hàng hơn ở thanh trên cùng.",
		);
		unmount();
		renderWorkflow({ build: pending.build });
		const build = screen.getByRole("button", { name: "Tạo gói" });
		const focus = screen.getByLabelText("Trọng tâm");
		await user.click(focus);
		await user.paste("a".repeat(281));
		expect(focus).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByText("Tối đa 280 ký tự.")).toBeInTheDocument();
		expect(build).toBeDisabled();
		await user.type(focus, "{Backspace}");
		expect(focus).not.toHaveAttribute("aria-invalid");
		expect(build).toBeEnabled();
		expect(pending.calls).toHaveLength(0);
	});

	it("remembers the owner's note on this device, per tenant, and forgets an emptied one", async () => {
		const user = userEvent.setup();
		const key = `${OWNER_NOTE_KEY_PREFIX}${TENANT.id}`;
		const first = renderWorkflow({ build: pendingBuild().build });
		await user.type(
			screen.getByLabelText("Ghi chú của chủ quán"),
			"Mới sửa quán",
		);
		expect(window.localStorage.getItem(key)).toBe("Mới sửa quán");
		first.unmount();
		const again = renderWorkflow({ build: pendingBuild().build });
		expect(screen.getByLabelText("Ghi chú của chủ quán")).toHaveValue(
			"Mới sửa quán",
		);
		expect(screen.getByLabelText("Trọng tâm")).toHaveValue("");
		again.unmount();
		const other = { ...TENANT, id: "55555555-5555-4555-8555-555555555555" };
		const elsewhere = renderWorkflow({
			build: pendingBuild().build,
			tenant: other,
		});
		expect(screen.getByLabelText("Ghi chú của chủ quán")).toHaveValue("");
		elsewhere.unmount();
		renderWorkflow({ build: pendingBuild().build });
		await user.clear(screen.getByLabelText("Ghi chú của chủ quán"));
		expect(window.localStorage.getItem(key)).toBeNull();
		expect(rememberedOwnerNote(TENANT.id)).toBe("");
	});
});

describe("the device's pack cache", () => {
	const id = (digit: string) => digit.repeat(64);
	const at = (days: number) => new Date(NOW.getTime() + days * DAY);

	it("keeps up to five recent packs as fnb.pack.<pack_id>, newest first", () => {
		for (const [index, digit] of ["1", "2", "3", "4", "5", "6"].entries()) {
			rememberPack(id(digit), `pack ${digit}\n`, at(index / 24));
		}
		const kept = cachedPacks(at(1));
		expect(kept).toHaveLength(PACK_CACHE_SIZE);
		expect(kept.map((entry) => entry.packId)).toEqual(
			["6", "5", "4", "3", "2"].map(id),
		);
		expect(
			window.localStorage.getItem(`${PACK_KEY_PREFIX}${id("1")}`),
		).toBeNull();
		expect(
			JSON.parse(
				window.localStorage.getItem(`${PACK_KEY_PREFIX}${id("6")}`) ?? "{}",
			),
		).toEqual({ text: "pack 6\n", savedAt: at(5 / 24).getTime() });
		expect(cachedPackText(id("4"), at(1))).toBe("pack 4\n");
	});

	it("removes a pack after 14 days", () => {
		rememberPack(id("a"), "old\n", NOW);
		rememberPack(id("b"), "newer\n", at(5));
		expect(cachedPackText(id("a"), at(14))).toBe("old\n");
		expect(cachedPackText(id("a"), at(14.01))).toBeNull();
		expect(
			window.localStorage.getItem(`${PACK_KEY_PREFIX}${id("a")}`),
		).toBeNull();
		expect(cachedPackText(id("b"), at(14.01))).toBe("newer\n");
		rememberPack(id("c"), "latest\n", at(18));
		expect(cachedPacks(at(18)).map((entry) => entry.packId)).toEqual([
			id("c"),
			id("b"),
		]);
		expect(cachedPacks(at(19.01)).map((entry) => entry.packId)).toEqual([
			id("c"),
		]);
	});

	it("leaves the note and malformed entries out, and stays quiet when the storage refuses", () => {
		rememberOwnerNote(TENANT.id, "Ghi chú");
		window.localStorage.setItem(`${PACK_KEY_PREFIX}${id("d")}`, "{broken");
		rememberPack("not-a-pack-id", "text", NOW);
		expect(cachedPacks(NOW)).toEqual([]);
		expect(rememberedOwnerNote(TENANT.id)).toBe("Ghi chú");
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("full", "QuotaExceededError");
		});
		expect(() => rememberPack(id("e"), "e\n", NOW)).not.toThrow();
		expect(cachedPackText(id("e"), NOW)).toBeNull();
		vi.restoreAllMocks();
	});

	it("removes every pack at sign-out and keeps the note", async () => {
		const user = userEvent.setup();
		rememberPack(id("7"), "seven\n");
		rememberPack(id("8"), "eight\n");
		rememberOwnerNote(TENANT.id, "Ghi chú");
		render(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter>
						<SignOutButton />
					</MemoryRouter>
				</QueryClientProvider>
			</I18nProvider>,
		);
		const before = current.signedOut;
		expect(cachedPacks()).toHaveLength(2);
		await user.click(screen.getByRole("button", { name: "Đăng xuất" }));
		await waitFor(() => expect(cachedPacks()).toEqual([]));
		expect(current.signedOut).toBe(before + 1);
		expect(
			window.localStorage.getItem(`${PACK_KEY_PREFIX}${id("7")}`),
		).toBeNull();
		expect(rememberedOwnerNote(TENANT.id)).toBe("Ghi chú");
	});
});

describe("who gets the pack tab", () => {
	function renderPage(
		membership: Membership | null,
		path = "/xuat-du-lieu?tab=goi",
	) {
		current.membership = membership;
		current.analytics = { status: "ready", source: demoSource() };
		return render(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider
					client={
						new QueryClient({ defaultOptions: { queries: { retry: false } } })
					}
				>
					<MemoryRouter initialEntries={[path]}>
						<ExportsPage />
					</MemoryRouter>
				</QueryClientProvider>
			</I18nProvider>,
		);
	}

	it.each([
		["an owner", { role: "owner", storeIds: null }],
		[
			"a manager limited to one store",
			{ role: "manager", storeIds: ["MOCK-S1"] },
		],
	] as const)("gives %s the form", async (_name, membership) => {
		renderPage(membership);
		expect(await screen.findByTestId("pack-form")).toBeInTheDocument();
	});

	it.each([
		["staff", { role: "staff", storeIds: null }],
		["viewer", { role: "viewer", storeIds: null }],
		["no membership", null],
	] as const)(
		"explains to %s that only owners and managers build packs",
		async (_name, membership) => {
			renderPage(membership);
			expect(await screen.findByTestId("exports-denied")).toHaveTextContent(
				"Chỉ chủ quán và quản lý xuất được dữ liệu.",
			);
			expect(screen.queryByTestId("pack-form")).toBeNull();
		},
	);

	it("gives the publisher nothing under the heading", async () => {
		renderPage({ role: "publisher", storeIds: null }, "/xuat-du-lieu");
		await waitFor(() =>
			expect(screen.queryByText("Đang kiểm tra quyền của bạn…")).toBeNull(),
		);
		expect(screen.queryByTestId("exports-denied")).toBeNull();
		expect(screen.queryByTestId("pack-form")).toBeNull();
		expect(screen.queryByText("Gói dữ liệu cho AI")).toBeNull();
	});

	it("explains that building needs https or this computer", async () => {
		vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues });
		renderPage({ role: "owner", storeIds: null });
		expect(await screen.findByTestId("pack-insecure")).toHaveTextContent(
			"Trình duyệt chỉ tạo được gói dữ liệu khi ứng dụng mở qua https hoặc trên chính máy này (localhost).",
		);
		expect(screen.queryByTestId("pack-form")).toBeNull();
	});
});
