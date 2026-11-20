import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type DataPack,
	normalizePlanText,
	PLAN_LINT_CODE_IDS,
} from "@fnb/datapack";
import { samplePlan } from "@fnb/datapack/testing";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedPackText, rememberPack } from "../../datapack/pack-cache";
import {
	I18nProvider,
	isMessageKey,
	type Language,
	messages,
	translate,
} from "../../i18n";
import {
	type CheckedPlan,
	issueMessage,
	planPackId,
} from "../../plans/paste-check";
import { vndFormatters } from "../../test/render";
import { PlanPasteBox } from "./paste-page";

const NOW = new Date("2026-11-12T03:00:00Z");
const FIXTURES = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"..",
	"packages",
	"datapack",
	"test",
	"fixtures",
);

function fixture(...parts: string[]): string {
	return readFileSync(join(FIXTURES, ...parts), "utf8");
}

const GOLDEN_TEXT = fixture("demo-pack.json");
const GOLDEN = JSON.parse(GOLDEN_TEXT) as DataPack;
const LINT_PACK_TEXT = fixture("plans", "lint-pack.json");
const LINT_PACK = JSON.parse(LINT_PACK_TEXT) as DataPack;
const MISSING_SECTION = fixture("plans", "missing-section.md");
const UNKNOWN_KPI = fixture("plans", "unknown-kpi.md");
const EXPECTED_CODES = JSON.parse(
	fixture("plans", "lint", "expected.json"),
) as Record<string, string[]>;

function lintFixture(name: string): string {
	return fixture("plans", "lint", name);
}

function renderBox(
	options: {
		language?: Language;
		onSave?: (checked: CheckedPlan) => void;
	} = {},
) {
	return render(
		<I18nProvider
			language={options.language ?? "vi"}
			onLanguageChange={() => undefined}
		>
			<MemoryRouter initialEntries={["/ke-hoach/dan"]}>
				<PlanPasteBox
					formatters={vndFormatters(
						options.language === "en" ? "en-GB" : "vi-VN",
					)}
					now={() => NOW}
					{...(options.onSave === undefined ? {} : { onSave: options.onSave })}
				/>
			</MemoryRouter>
		</I18nProvider>,
	);
}

function paste(text: string): void {
	fireEvent.change(screen.getByTestId("plan-text"), {
		target: { value: text },
	});
}

async function checkPasted(text: string): Promise<void> {
	paste(text);
	await userEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
}

function attach(text: string, name = "goi-du-lieu.json"): void {
	const file = new File([text], name, { type: "application/json" });
	fireEvent.change(screen.getByTestId("plan-pack-file"), {
		target: { files: [file] },
	});
}

function issueCodes(): string[] {
	return within(screen.getByTestId("plan-issues"))
		.getAllByRole("listitem")
		.map((item) => item.getAttribute("data-code") ?? "");
}

function issueItem(code: string): HTMLElement {
	const item = screen
		.getByTestId("plan-issues")
		.querySelector(`[data-code="${code}"]`);
	if (!(item instanceof HTMLElement)) throw new Error(`no issue ${code}`);
	return item;
}

function editedGolden(): string {
	return GOLDEN_TEXT.replace(
		/("ALL\/avg_ticket":\s*\[\s*)([1-9])/,
		(_match, row: string, digit: string) =>
			`${row}${digit === "9" ? "8" : String(Number(digit) + 1)}`,
	);
}

function packKeys(): string[] {
	return Object.keys(localStorage).filter((key) =>
		/^fnb\.pack\.[0-9a-f]{64}$/.test(key),
	);
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("finding the plan's pack", () => {
	it("reads the pack id from the front matter, also through a fence and Windows line ends", () => {
		expect(planPackId(MISSING_SECTION)).toBe(GOLDEN.pack_id);
		expect(
			planPackId(
				`Đây là kế hoạch:\r\n\r\n\`\`\`markdown\r\n${MISSING_SECTION.replaceAll("\n", "\r\n")}\`\`\`\r\n`,
			),
		).toBe(GOLDEN.pack_id);
		expect(planPackId("# Kế hoạch\n")).toBeNull();
		expect(planPackId('---\n{"pack": "abc"}\n---\n')).toBeNull();
		expect(planPackId("---\n{not json}\n---\n")).toBeNull();
	});

	it("finds the pack in the device cache first and checks the plan without asking for a file", async () => {
		rememberPack(GOLDEN.pack_id, GOLDEN_TEXT, NOW);
		renderBox();
		await checkPasted(MISSING_SECTION);
		const result = await screen.findByTestId("plan-result");
		expect(screen.queryByTestId("plan-pack-missing")).toBeNull();
		expect(result).toHaveAttribute("data-ok", "false");
		expect(screen.getByTestId("plan-summary")).toHaveTextContent(
			"Kế hoạch chưa hợp lệ: 1 lỗi, 0 lưu ý.",
		);
		expect(screen.getByTestId("plan-pack")).toHaveTextContent(
			`Đã kiểm tra với gói ${GOLDEN.pack_id.slice(0, 8)}, dữ liệu đến hết 11/11/2026.`,
		);
		expect(screen.getByTestId("plan-sample")).toBeInTheDocument();
		expect(issueCodes()).toEqual(["section_missing:7"]);
		expect(
			within(issueItem("section_missing:7")).getByTestId("plan-issue-message"),
		).toHaveTextContent("Thiếu mục 7: Lịch khuyến mãi.");
		expect(
			within(issueItem("section_missing:7")).getByTestId("plan-issue-line"),
		).toHaveTextContent("Cả kế hoạch");
	});

	it("says which pack is missing, by its id prefix, and builds nothing when it is neither cached nor attached", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		rememberPack(LINT_PACK.pack_id, LINT_PACK_TEXT, NOW);
		renderBox();
		await checkPasted(UNKNOWN_KPI);
		const missing = await screen.findByTestId("plan-pack-missing");
		expect(missing).toHaveAttribute("data-pack", GOLDEN.pack_id);
		expect(missing).toHaveTextContent(
			`Không tìm thấy gói dữ liệu ${GOLDEN.pack_id.slice(0, 8)} trên thiết bị này.`,
		);
		expect(missing).toHaveTextContent("Ứng dụng không tự tạo gói mới để thay");
		expect(missing).not.toHaveTextContent(GOLDEN.pack_id);
		expect(
			within(missing).getByRole("button", {
				name: "Đính kèm gói dữ liệu (.json)",
			}),
		).toBeEnabled();
		expect(screen.queryByTestId("plan-result")).toBeNull();
		expect(screen.getByRole("button", { name: "Lưu kế hoạch" })).toBeDisabled();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(packKeys()).toEqual([`fnb.pack.${LINT_PACK.pack_id}`]);
	});

	it("validates an attached pack, keeps it on the device and checks the plan; the next plan finds it there", async () => {
		renderBox();
		await checkPasted(UNKNOWN_KPI);
		await screen.findByTestId("plan-pack-missing");
		attach(`﻿${GOLDEN_TEXT}`);
		await screen.findByTestId("plan-result");
		expect(screen.queryByTestId("plan-pack-missing")).toBeNull();
		expect(issueCodes()).toEqual(["kpi_unknown:net_sales"]);
		expect(
			within(issueItem("kpi_unknown:net_sales")).getByTestId(
				"plan-issue-message",
			),
		).toHaveTextContent("KPI “net_sales” không có trong danh mục chỉ số.");
		expect(cachedPackText(GOLDEN.pack_id, NOW)).toBe(GOLDEN_TEXT);

		await checkPasted(MISSING_SECTION);
		await waitFor(() => expect(issueCodes()).toEqual(["section_missing:7"]));
		expect(screen.queryByTestId("plan-pack-missing")).toBeNull();
	});

	it("refuses a file that is not a valid pack, names its codes and keeps nothing", async () => {
		renderBox();
		await checkPasted(MISSING_SECTION);
		await screen.findByTestId("plan-pack-missing");
		attach("this is not json");
		expect(await screen.findByTestId("plan-pack-refused")).toHaveTextContent(
			"Mã lỗi: not_json",
		);
		attach(editedGolden());
		await waitFor(() =>
			expect(screen.getByTestId("plan-pack-refused")).toHaveTextContent(
				"Mã lỗi: pack_id_mismatch",
			),
		);
		expect(screen.getByTestId("plan-pack-refused")).toHaveTextContent(
			"Tệp này không phải gói dữ liệu hợp lệ nên chưa được dùng.",
		);
		expect(screen.queryByTestId("plan-result")).toBeNull();
		expect(packKeys()).toEqual([]);
	});

	it("asks for a pack when the plan names none, then checks against the attached file", async () => {
		renderBox();
		const withoutFrontMatter = MISSING_SECTION.slice(
			MISSING_SECTION.indexOf("# Kế hoạch mẫu"),
		);
		await checkPasted(withoutFrontMatter);
		expect(await screen.findByTestId("plan-pack-missing")).toHaveTextContent(
			"Phần đầu của kế hoạch không ghi mã gói dữ liệu",
		);
		attach(GOLDEN_TEXT);
		await screen.findByTestId("plan-result");
		expect(issueCodes()).toContain("front_matter_missing");
		expect(issueCodes()).toContain("section_missing:7");
	});

	it("checks a plan naming another pack against the file attached for it, showing both ids and pack_mismatch", async () => {
		renderBox();
		const other = MISSING_SECTION.replace(GOLDEN.pack_id, "f".repeat(64));
		await checkPasted(other);
		expect(await screen.findByTestId("plan-pack-missing")).toHaveTextContent(
			"ffffffff",
		);
		attach(GOLDEN_TEXT);
		await screen.findByTestId("plan-result");
		expect(screen.getByTestId("plan-pack-other")).toHaveTextContent(
			`Kế hoạch ghi gói ffffffff, còn tệp đính kèm là gói ${GOLDEN.pack_id.slice(0, 8)}.`,
		);
		expect(issueCodes()).toContain("pack_mismatch");
	});
});

describe("the issues", () => {
	it("shows each issue with its line in the checked text, its code, its detail as data and the line itself", async () => {
		rememberPack(LINT_PACK.pack_id, LINT_PACK_TEXT, NOW);
		renderBox();
		const plan = `Chào anh chị, đây là kế hoạch:\n\n${lintFixture("citation_mismatch.md")}`;
		await checkPasted(plan);
		await screen.findByTestId("plan-result");
		expect(issueCodes()).toEqual([
			"citation_mismatch:kpi:ALL/net_revenue:w28",
			"preamble_text",
		]);
		const mismatch = issueItem("citation_mismatch:kpi:ALL/net_revenue:w28");
		expect(mismatch).toHaveAttribute("data-level", "error");
		expect(mismatch).toHaveTextContent("Lỗi · Dòng 21");
		expect(mismatch).toHaveTextContent(
			"Con số viết trước trích dẫn [[kpi:ALL/net_revenue:w28]] không khớp với ô được trích.",
		);
		expect(mismatch).toHaveTextContent(
			"Mã: citation_mismatch:kpi:ALL/net_revenue:w28",
		);
		expect(within(mismatch).getByTestId("plan-issue-detail")).toHaveTextContent(
			"Chi tiết: 1,32 tỷ đồng",
		);
		const normalized = normalizePlanText(plan).split("\n");
		const line21 = normalized[20] ?? "";
		expect(line21).toContain("[[kpi:ALL/net_revenue:w28]]");
		expect(line21.trim().length).toBeGreaterThan(160);
		expect(mismatch).toHaveTextContent(`${line21.trim().slice(0, 160)}…`);
		expect(issueItem("preamble_text")).toHaveAttribute("data-level", "warning");
		expect(issueItem("preamble_text")).toHaveTextContent("Lưu ý · Cả kế hoạch");
		const lines = within(screen.getByTestId("plan-normalized")).getAllByRole(
			"listitem",
		);
		expect(lines).toHaveLength(normalized.length - 1);
		expect(lines[20]).toHaveTextContent(line21.trim());
		expect(screen.getByTestId("plan-result")).not.toHaveTextContent(
			"Chào anh chị",
		);
	});

	it("copies the list of problems for the assistant, and offers it in a box when the clipboard is refused", async () => {
		rememberPack(GOLDEN.pack_id, GOLDEN_TEXT, NOW);
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		renderBox();
		await checkPasted(MISSING_SECTION);
		await screen.findByTestId("plan-result");
		await userEvent.click(
			screen.getByRole("button", { name: "Sao chép danh sách lỗi" }),
		);
		const expected = [
			`Kết quả kiểm tra kế hoạch với gói dữ liệu ${GOLDEN.pack_id.slice(0, 8)}: 1 lỗi, 0 lưu ý. Hãy sửa rồi gửi lại toàn bộ kế hoạch.`,
			"- Cả kế hoạch · Lỗi · section_missing:7: Thiếu mục 7: Lịch khuyến mãi.",
		].join("\n");
		expect(writeText).toHaveBeenCalledWith(expected);
		expect(screen.getByTestId("plan-copy-status")).toHaveTextContent(
			"Đã sao chép danh sách. Dán vào khung chat để trợ lý sửa kế hoạch.",
		);
		writeText.mockRejectedValueOnce(
			new DOMException("denied", "NotAllowedError"),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Sao chép danh sách lỗi" }),
		);
		expect(await screen.findByTestId("plan-copy-text")).toHaveValue(expected);
		expect(
			screen.getByRole("textbox", { name: "Danh sách lỗi để gửi lại trợ lý" }),
		).toHaveAttribute("readonly");
		expect(screen.getByTestId("plan-copy-status")).toHaveTextContent(
			"Trình duyệt không cho sao chép tự động.",
		);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: undefined,
		});
	});

	it("puts the details of a warning in the copied list", async () => {
		rememberPack(LINT_PACK.pack_id, LINT_PACK_TEXT, NOW);
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		renderBox();
		await checkPasted(lintFixture("uncited_numbers.md"));
		await screen.findByTestId("plan-result");
		await userEvent.click(
			screen.getByRole("button", { name: "Sao chép danh sách lỗi" }),
		);
		expect(writeText.mock.calls[0]?.[0]).toContain(
			"- Cả kế hoạch · Lưu ý · uncited_numbers:2: 2 con số ở mục 1, 2 hoặc ở phần Căn cứ chưa có trích dẫn. (Chi tiết: 25:850; 25:120)",
		);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: undefined,
		});
	});

	it("reads in English", async () => {
		rememberPack(GOLDEN.pack_id, GOLDEN_TEXT, NOW);
		renderBox({ language: "en" });
		paste(MISSING_SECTION);
		await userEvent.click(screen.getByRole("button", { name: "Check" }));
		await screen.findByTestId("plan-result");
		expect(screen.getByTestId("plan-summary")).toHaveTextContent(
			"The plan is not valid yet. Errors: 1; warnings: 0.",
		);
		expect(
			within(issueItem("section_missing:7")).getByTestId("plan-issue-message"),
		).toHaveTextContent("Section 7 is missing: Promotion calendar.");
		expect(
			screen.getByRole("button", { name: "Save the plan" }),
		).toBeDisabled();
	});
});

describe("the summary and Lưu kế hoạch", () => {
	it("counts sections, initiatives, correct citations and KPIs of a valid plan, and keeps Lưu disabled for a member who may not save", async () => {
		rememberPack(GOLDEN.pack_id, GOLDEN_TEXT, NOW);
		renderBox();
		await checkPasted(samplePlan(GOLDEN));
		const result = await screen.findByTestId("plan-result");
		expect(result).toHaveAttribute("data-ok", "true");
		expect(screen.getByTestId("plan-summary")).toHaveTextContent(
			/^Kế hoạch hợp lệ: 10 mục, 5 sáng kiến, \d+ trích dẫn đúng, 3 KPI\.$/,
		);
		expect(screen.queryByTestId("plan-issues")).toBeNull();
		expect(screen.getByRole("button", { name: "Lưu kế hoạch" })).toBeDisabled();
		expect(screen.getByTestId("plan-save-note")).toHaveTextContent(
			"Chỉ chủ hoặc quản lý mới lưu được kế hoạch.",
		);
	});

	it("blocks Lưu on errors only: warnings leave it enabled once saving exists", async () => {
		rememberPack(LINT_PACK.pack_id, LINT_PACK_TEXT, NOW);
		const onSave = vi.fn();
		renderBox({ onSave });
		const save = () => screen.getByRole("button", { name: "Lưu kế hoạch" });
		expect(save()).toBeDisabled();
		expect(screen.getByTestId("plan-save-note")).toHaveTextContent(
			"Kiểm tra kế hoạch trước khi lưu.",
		);
		await checkPasted(lintFixture("front_matter_extra_fields.md"));
		await screen.findByTestId("plan-result");
		expect(screen.getByTestId("plan-warnings")).toHaveTextContent(
			"Còn 1 lưu ý; lưu ý không chặn việc lưu.",
		);
		expect(save()).toBeEnabled();
		await userEvent.click(save());
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave.mock.calls[0]?.[0].lint.ok).toBe(true);
		await checkPasted(lintFixture("kpi_unknown.md"));
		await screen.findByTestId("plan-result");
		expect(save()).toBeDisabled();
		expect(screen.getByTestId("plan-save-note")).toHaveTextContent(
			"Sửa các lỗi rồi kiểm tra lại trước khi lưu.",
		);
	});

	it("asks for a plan when the box is empty, and clears the result when the text changes", async () => {
		rememberPack(GOLDEN.pack_id, GOLDEN_TEXT, NOW);
		renderBox();
		await userEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
		expect(screen.getByTestId("plan-empty")).toHaveTextContent(
			"Hãy dán kế hoạch trước khi kiểm tra.",
		);
		expect(screen.getByTestId("plan-text")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		await checkPasted(MISSING_SECTION);
		await screen.findByTestId("plan-result");
		paste(UNKNOWN_KPI);
		expect(screen.queryByTestId("plan-result")).toBeNull();
	});

	it("writes the plan box in 16 px text so phones do not zoom in", () => {
		renderBox();
		expect(screen.getByTestId("plan-text")).toHaveClass("text-base");
		expect(
			screen.getByRole("textbox", { name: "Kế hoạch của trợ lý" }),
		).toBeInTheDocument();
	});
});

describe("the lint messages", () => {
	it("give every lint code a message in Vietnamese and in English", () => {
		expect(PLAN_LINT_CODE_IDS).toHaveLength(24);
		for (const code of PLAN_LINT_CODE_IDS) {
			const key = `plans.lint.${code}`;
			expect(isMessageKey(key), key).toBe(true);
			if (!isMessageKey(key)) continue;
			expect(messages.vi[key].trim(), key).not.toBe("");
			expect(messages.en[key].trim(), key).not.toBe("");
		}
	});

	it("fill every parameter of every fixture's codes in both languages", () => {
		const codes = Object.values(EXPECTED_CODES).flat();
		expect(new Set(codes.map((code) => code.split(":")[0]))).toEqual(
			new Set(PLAN_LINT_CODE_IDS),
		);
		for (const language of ["vi", "en"] as const) {
			const t = (
				key: Parameters<typeof translate>[1],
				params?: Parameters<typeof translate>[2],
			) => translate(language, key, params);
			for (const code of codes) {
				const message = issueMessage(t, language, code);
				expect(message, `${language} ${code}`).not.toMatch(/\{\w+\}/);
				expect(message, `${language} ${code}`).not.toBe(code);
			}
		}
		const t = (
			key: Parameters<typeof translate>[1],
			params?: Parameters<typeof translate>[2],
		) => translate("vi", key, params);
		expect(issueMessage(t, "vi", "initiative_field_missing:2:effort")).toBe(
			"Sáng kiến 2 thiếu mục “Công sức”, hoặc mục đó để trống.",
		);
		expect(issueMessage(t, "vi", "citation_unknown:kpi:ALL/x:w29")).toBe(
			"Trích dẫn [[kpi:ALL/x:w29]] không trỏ tới ô nào của gói dữ liệu; phần context không bao giờ được trích dẫn.",
		);
	});
});
