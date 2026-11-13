import { describe, expect, it } from "vitest";
import { DIGEST_LINK_MAX_STORES, digestLink } from "../../../src/index.js";
import {
	type DigestModel,
	type DigestStoreLine,
	digestModelSchema,
	renderDigest,
	utf16Units,
} from "../../../src/render/index.js";
import { DAY, STORE_A, STORE_B } from "../../fixtures/ngay-rows.js";

const BASE = "https://example.github.io/app/";
const NBSP = "\u00a0";
const FOOTER =
	"T\u1eaft ho\u1eb7c \u0111\u1ed5i k\u00eanh nh\u1eadn: C\u00e0i \u0111\u1eb7t \u2192 C\u1ea3nh b\u00e1o.";

function visibleText(html: string | null): string {
	return (html ?? "")
		.replace(/<head>.*?<\/head>/s, "")
		.replace(/<[^>]+>/g, " ")
		.replaceAll("&zwnj;", "\u200c")
		.replaceAll("&nbsp;", NBSP)
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&amp;", "&")
		.replace(/\s+/g, " ")
		.trim();
}

function manyStores(
	count: number,
	state: DigestStoreLine["state"],
	nameLength = 30,
): DigestStoreLine[] {
	return Array.from({ length: count }, (_, index) => {
		const prefix = `C\u1eeda h\u00e0ng s\u1ed1 ${index + 1} `;
		return {
			storeId: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
			name: `${prefix}${"x".repeat(Math.max(0, nameLength - prefix.length))}`,
			state,
			net: 1_000_000 + index,
			invoices: 10,
			vsBaseline: {
				change: 0.01,
				sampleDays: 8,
				unavailable: null,
			},
		};
	});
}

function attentionCounts(text: string): {
	title: number;
	represented: number;
	more: number;
} {
	const lines = text.split("\n");
	const start = lines.findIndex((line) =>
		line.startsWith("C\u1ea7n ch\u00fa \u00fd ("),
	);
	const title = Number(/\((\d+)\)/.exec(lines[start] ?? "")?.[1] ?? Number.NaN);
	let represented = 0;
	let more = 0;
	for (const line of lines.slice(start + 1)) {
		if (line === "") {
			break;
		}
		const cut = /^\u2022 v\u00e0 (\d+) m\u1ee5c kh\u00e1c$/.exec(line);
		if (cut) {
			more = Number(cut[1]);
			continue;
		}
		const hiddenShifts = /v\u00e0 (\d+) ca l\u1ec7ch k\u00e9t kh\u00e1c/.exec(
			line,
		);
		represented += hiddenShifts ? Number(hiddenShifts[1]) : 1;
	}
	return { title, represented, more };
}

function money(text: string): string {
	return text.replaceAll(" ₫", `${NBSP}₫`);
}
const ZONE = "Asia/Ho_Chi_Minh";

function comparison(change: number | null, sampleDays: number | null = 8) {
	return {
		change,
		sampleDays,
		unavailable: change === null ? ("building_baseline" as const) : null,
	};
}

function model(overrides: Partial<DigestModel> = {}): DigestModel {
	return digestModelSchema.parse({
		version: 1,
		tenantId: "33333333-3333-4333-8333-333333333333",
		businessDate: DAY,
		scope: { storeIds: [STORE_A, STORE_B], allStores: true },
		dataState: "verified",
		holidayKind: null,
		totals: {
			net: 12_345_000,
			vsBaseline: comparison(-0.082),
			vsPrevious: comparison(0.031, null),
			invoices: 312,
			avgTicket: 39_567,
			cashToCount: 4_560_000,
			peakHour: { hour: 19, net: 1_234_000 },
			topItems: [
				{ name: "Trà sữa", quantity: 85 },
				{ name: "Cà phê", quantity: 60 },
				{ name: "Bánh", quantity: 41 },
			],
		},
		stores: [
			{
				storeId: STORE_A,
				name: "Cửa hàng 1",
				state: "verified",
				net: 7_100_000,
				invoices: 180,
				vsBaseline: comparison(-0.02),
			},
			{
				storeId: STORE_B,
				name: "Cửa hàng 2",
				state: "verified",
				net: 5_245_000,
				invoices: 132,
				vsBaseline: comparison(-0.071, 4),
			},
		],
		findings: [
			{
				ruleKey: "revenue_below_baseline",
				storeId: STORE_B,
				values: {
					ratio: 0.58,
					threshold: 0.75,
					current: 1,
					reference: 2,
					sample_weeks: 8,
				},
			},
			{
				ruleKey: "drawer_variance",
				storeId: STORE_A,
				values: {
					shift_number: 2,
					shift_external_id: "s-2",
					from: "14:00",
					to: "22:00",
					variance: -62_000,
					rank: 1,
					max_lines: 3,
					flagged_total: 1,
				},
			},
		],
		openAlerts: [
			{
				ruleKey: "auth_failed",
				storeId: null,
				accountId: "66666666-6666-4666-8666-666666666666",
				accountName: "Tài khoản thử",
				runKind: null,
				openedAt: "2026-11-06T03:00:00.000Z",
			},
		],
		link: { kind: "ngay", path: `#/bao-cao/ngay?date=${DAY}` },
		stale: false,
		builtAt: "2026-11-07T20:30:00.000Z",
		...overrides,
	});
}

function zalo(value: DigestModel, maxUnits?: number) {
	return renderDigest(value, {
		channel: "zalo_bot",
		appBaseUrl: BASE,
		timeZone: ZONE,
		currencyCode: "VND",
		...(maxUnits === undefined ? {} : { maxUnits }),
	});
}

describe("digest render", () => {
	it("renders the specification's example exactly", () => {
		const rendered = zalo(model());
		expect(rendered.text).toBe(
			money(
				[
					"Bản tin ngày 07/11/2026 (Thứ Bảy)",
					"Tất cả 2 cửa hàng · đã đối soát",
					"",
					"Doanh thu thuần: 12.345.000 ₫",
					"• So với mức nền cùng thứ: -8,2%",
					"• So với hôm trước: +3,1%",
					"Hóa đơn: 312 · Trung bình 39.567 ₫/hóa đơn",
					"Tiền mặt cần đếm: 4.560.000 ₫",
					"Cao điểm: 19 giờ (1.234.000 ₫)",
					"Bán chạy: Trà sữa (85), Cà phê (60), Bánh (41)",
					"",
					"Theo cửa hàng:",
					"• Cửa hàng 1: 7.100.000 ₫ (-2,0% so với mức nền)",
					"• Cửa hàng 2: 5.245.000 ₫ (-7,1% so với mức nền, 4/8 tuần)",
					"",
					"Cần chú ý (2):",
					"• Cửa hàng 2: doanh thu thuần chỉ bằng 58% mức nền cùng thứ (ngưỡng 75%).",
					"• Cửa hàng 1: Ca 2 (14:00–22:00) lệch két -62.000 ₫.",
					"",
					"Đang mở:",
					"• POS từ chối đăng nhập Tài khoản thử (từ 06/11).",
					"",
					`Xem báo cáo ngày: ${BASE}#/bao-cao/ngay?date=${DAY}`,
					"Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.",
				].join("\n"),
			),
		);
		expect(rendered.truncation).toEqual([]);
		expect(rendered.text).toBe(rendered.text.normalize("NFC"));
	});

	it("puts no amount in the first line or the e-mail subject", () => {
		const email = renderDigest(model(), {
			channel: "email",
			appBaseUrl: BASE,
			timeZone: ZONE,
			currencyCode: "VND",
		});
		expect(email.title).toBe("Bản tin ngày 07/11/2026 · Tất cả 2 cửa hàng");
		const first = email.text.split("\n")[0] ?? "";
		for (const text of [first, email.title]) {
			expect(text).not.toContain("₫");
			expect(text).not.toContain("%");
			expect(text.replace(/\d{2}\/\d{2}\/\d{4}/, "")).not.toMatch(/\d{3}/);
		}
		expect(email.html).toContain('lang="vi"');
	});

	it("writes every state line and links to Hôm nay before the day ended", () => {
		const unverified = zalo(model({ dataState: "unverified" })).text;
		expect(unverified).toContain(
			"Tất cả 2 cửa hàng · chưa đối soát, số liệu có thể đổi sau lần đồng bộ đêm",
		);
		const unmatched = model({
			dataState: "unmatched",
			stores: model().stores.map((store, index) =>
				index === 1 ? { ...store, state: "unmatched" } : store,
			),
		});
		expect(zalo(unmatched).text).toContain("chưa khớp với POS ở Cửa hàng 2");
		const partial = model({
			dataState: "partial",
			stores: model().stores.map((store, index) =>
				index === 1 ? { ...store, state: "shift_open" } : store,
			),
			link: { kind: "hom_nay", path: "#/" },
		});
		const partialText = zalo(partial).text;
		expect(partialText).toContain(
			"Cửa hàng 2 chưa đồng bộ xong, số liệu tính đến 03:30",
		);
		expect(partialText).toContain(
			"• Cửa hàng 2: còn ca chưa đóng, số liệu tính đến 03:30",
		);
		expect(partialText).toContain(`Xem Hôm nay: ${BASE}#/`);
		const empty = zalo(
			model({
				dataState: "no_data",
				stores: model().stores.map((store) => ({
					...store,
					state: "no_sales",
				})),
				findings: [],
			}),
		).text;
		expect(empty).toContain("Ngày 07/11/2026 chưa có hóa đơn nào.");
		expect(empty).not.toContain("Doanh thu thuần");
		expect(empty).toContain("• Cửa hàng 1: không có hóa đơn");
		const holiday = zalo(model({ holidayKind: "tet", stale: true })).text;
		expect(holiday).toContain(
			"Ngày lễ (Tết): mức nền không tính các ngày lễ và Tết.",
		);
		expect(holiday).toContain("Một số số liệu đang cập nhật.");
		const building = zalo(
			model({ totals: { ...model().totals, vsBaseline: comparison(null, 0) } }),
		).text;
		expect(building).toContain("• Chưa đủ dữ liệu để so với mức nền cùng thứ");
		expect(zalo(model(), undefined).text).toContain("Xem báo cáo ngày");
		const noLink = renderDigest(model(), {
			channel: "zalo_bot",
			appBaseUrl: null,
			timeZone: ZONE,
			currencyCode: "VND",
		}).text;
		expect(noLink).not.toContain("Xem báo cáo");
		expect(noLink.endsWith("Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.")).toBe(
			true,
		);
	});

	it("truncates in the specified order and fits 50 stores and 20 findings into 1,900 units", () => {
		const stores = Array.from({ length: 50 }, (_, index) => ({
			storeId: `store-${index}`,
			name: `Cửa hàng có tên khá dài số ${index + 1}`,
			state: "verified" as const,
			net: 1_000_000 + index,
			invoices: 10,
			vsBaseline: comparison(0.01 * index),
		}));
		const findings = Array.from({ length: 20 }, (_, index) => ({
			ruleKey: "revenue_below_baseline" as const,
			storeId: `store-${index}`,
			values: { ratio: 0.5, threshold: 0.75 },
		}));
		const big = model({
			scope: {
				storeIds: stores.map((store) => store.storeId),
				allStores: true,
			},
			stores,
			findings,
		});
		const rendered = zalo(big);
		expect(utf16Units(rendered.text)).toBeLessThanOrEqual(1900);
		expect(rendered.units).toBeLessThanOrEqual(1900);
		expect(rendered.truncation).toEqual([
			"top_items",
			"peak_hour",
			"stores_5",
			"stores_3",
			"attention_3",
		]);
		expect(rendered.text).toContain("• và 47 cửa hàng khác");
		expect(rendered.text).toContain("Cần chú ý (20):");
		expect(rendered.text).toContain("• và 17 mục khác");
		expect(rendered.text).not.toContain("Bán chạy:");
		expect(rendered.text).not.toContain("Cao điểm:");
		expect(
			rendered.text.startsWith("Bản tin ngày 07/11/2026 (Thứ Bảy)\n"),
		).toBe(true);
		expect(rendered.text).toContain("Doanh thu thuần:");
		expect(rendered.text).toContain("Xem báo cáo ngày:");
		expect(
			rendered.text.endsWith("Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo."),
		).toBe(true);
		const telegram = renderDigest(big, {
			channel: "telegram",
			appBaseUrl: BASE,
			timeZone: ZONE,
			currencyCode: "VND",
		});
		expect(telegram.units).toBeLessThanOrEqual(4000);
		const dropped = zalo(model(), 700);
		expect(dropped.truncation.slice(0, 2)).toEqual(["top_items", "peak_hour"]);
	});

	it("caps drawer lines at max_lines and adds the 'more' line", () => {
		const drawer = Array.from({ length: 5 }, (_, index) => ({
			ruleKey: "drawer_variance" as const,
			storeId: STORE_A,
			values: {
				shift_number: index + 1,
				shift_external_id: `s-${index + 1}`,
				from: "06:00",
				to: "14:00",
				variance: -100_000 + index,
				rank: index + 1,
				max_lines: 3,
				flagged_total: 5,
			},
		}));
		const text = zalo(model({ findings: drawer })).text;
		expect(text).toContain("Cần chú ý (5):");
		expect(text).toContain("• Cửa hàng 1: Ca 3 (06:00–14:00)");
		expect(text).not.toContain("Ca 4 (");
		expect(text).toContain(
			"• Cửa hàng 1: và 2 ca lệch két khác (xem báo cáo ngày).",
		);
	});

	it("escapes a store named with markup in the e-mail HTML and keeps the bot text plain", () => {
		const hostile = model({
			stores: model().stores.map((store, index) =>
				index === 0 ? { ...store, name: "<b>&</b>" } : store,
			),
		});
		const email = renderDigest(hostile, {
			channel: "email",
			appBaseUrl: BASE,
			timeZone: ZONE,
			currencyCode: "VND",
		});
		expect(email.html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
		expect(email.html).not.toContain("<b>&</b>");
		expect(zalo(hostile).text).toContain(money("• <b>&</b>: 7.100.000 ₫"));
	});

	it("keeps the title, the bounded state line, the headline, the link and the footer for 50 partial or unmatched stores", () => {
		for (const [state, dataState, nameLength] of [
			["unsettled", "partial", 30],
			["unmatched", "unmatched", 40],
		] as const) {
			const stores = manyStores(50, state, nameLength);
			const big = model({
				scope: {
					storeIds: stores.map((store) => store.storeId),
					allStores: true,
				},
				dataState,
				stores,
				findings: stores.slice(0, 20).map((store) => ({
					ruleKey: "revenue_below_baseline" as const,
					storeId: store.storeId,
					values: { ratio: 0.5, threshold: 0.75 },
				})),
			});
			const rendered = zalo(big);
			const lines = rendered.text.split("\n");
			expect(rendered.units).toBeLessThanOrEqual(1900);
			expect(rendered.truncation).not.toContain("hard_cut");
			expect(lines[0]).toBe("Bản tin ngày 07/11/2026 (Thứ Bảy)");
			expect(lines[1]).toContain("Tất cả 50 cửa hàng · ");
			expect(lines[1]).toContain(`${stores[2]?.name} và 47 cửa hàng khác`);
			expect(lines[1]).not.toContain(stores[3]?.name ?? "missing");
			expect(rendered.text).toContain(money("Doanh thu thuần: 12.345.000 ₫"));
			expect(lines).toContain(
				`Xem báo cáo ngày: ${BASE}#/bao-cao/ngay?date=${DAY}`,
			);
			expect(rendered.text.endsWith(FOOTER)).toBe(true);
		}
	});

	it("leaves the store filter out of the link of a large narrowed scope and keeps it for a small one", () => {
		const stores = manyStores(50, "verified");
		const storeIds = stores.map((store) => store.storeId);
		const storeFacts = storeIds.map((storeId) => ({
			storeId,
			openingMinutes: null,
			closeAt: "2026-11-07T17:00:00.000Z",
			lastShiftClosedAt: null,
			openShifts: 0,
			settledAt: "2026-11-07T20:30:00.000Z",
			dayEnded: true,
		}));
		const wide = digestLink({
			businessDate: DAY,
			allStores: false,
			storeIds,
			storeFacts,
		});
		expect(wide.path).toBe(`#/bao-cao/ngay?date=${DAY}`);
		const rendered = zalo(
			model({
				scope: { storeIds, allStores: false },
				stores,
				findings: [],
				link: wide,
			}),
		);
		expect(rendered.units).toBeLessThanOrEqual(1900);
		expect(rendered.text.split("\n")).toContain(
			`Xem báo cáo ngày: ${BASE}${wide.path}`,
		);
		expect(rendered.text.endsWith(FOOTER)).toBe(true);
		const few = storeIds.slice(0, DIGEST_LINK_MAX_STORES);
		const narrow = digestLink({
			businessDate: DAY,
			allStores: false,
			storeIds: few,
			storeFacts: storeFacts.slice(0, DIGEST_LINK_MAX_STORES),
		});
		expect(narrow.path).toBe(
			`#/bao-cao/ngay?date=${DAY}&store=${few.join(",")}`,
		);
		const small = zalo(
			model({
				scope: { storeIds: few, allStores: false },
				stores: stores.slice(0, DIGEST_LINK_MAX_STORES),
				findings: [],
				link: narrow,
			}),
		);
		expect(small.text.split("\n")).toContain(
			`Xem báo cáo ngày: ${BASE}${narrow.path}`,
		);
		expect(small.units).toBeLessThanOrEqual(1900);
	});

	it("shortens only the droppable sections when a hard cut is needed", () => {
		const stores = manyStores(50, "verified");
		const big = model({
			scope: {
				storeIds: stores.map((store) => store.storeId),
				allStores: true,
			},
			stores,
			findings: stores.slice(0, 20).map((store) => ({
				ruleKey: "revenue_below_baseline" as const,
				storeId: store.storeId,
				values: { ratio: 0.5, threshold: 0.75 },
			})),
		});
		const cut = zalo(big, 700);
		expect(cut.truncation.at(-1)).toBe("hard_cut");
		expect(cut.units).toBeLessThanOrEqual(700);
		expect(cut.text.startsWith("Bản tin ngày 07/11/2026 (Thứ Bảy)\n")).toBe(
			true,
		);
		expect(cut.text).toContain(money("Doanh thu thuần: 12.345.000 ₫"));
		expect(cut.text).toContain("\n…\n");
		expect(cut.text.split("\n")).toContain(
			`Xem báo cáo ngày: ${BASE}#/bao-cao/ngay?date=${DAY}`,
		);
		expect(cut.text.endsWith(FOOTER)).toBe(true);
	});

	it("counts every finding once when the attention lines are cut", () => {
		const stores = manyStores(50, "verified");
		const drawer = Array.from({ length: 5 }, (_, index) => ({
			ruleKey: "drawer_variance" as const,
			storeId: stores[0]?.storeId ?? "",
			values: {
				shift_number: index + 1,
				shift_external_id: `s-${index + 1}`,
				from: "08:00",
				to: "14:00",
				variance: -60_000 - index,
				rank: index + 1,
				max_lines: 3,
				flagged_total: 5,
			},
		}));
		const many = model({
			scope: {
				storeIds: stores.map((store) => store.storeId),
				allStores: true,
			},
			stores,
			findings: [
				...stores.slice(1, 21).map((store) => ({
					ruleKey: "revenue_below_baseline" as const,
					storeId: store.storeId,
					values: { ratio: 0.5, threshold: 0.75 },
				})),
				...drawer,
			],
		});
		const rendered = zalo(many);
		expect(rendered.truncation).toContain("attention_3");
		const counts = attentionCounts(rendered.text);
		expect(counts).toEqual({ title: 25, represented: 3, more: 22 });

		const drawerFirst = model({
			scope: {
				storeIds: stores.map((store) => store.storeId),
				allStores: true,
			},
			stores,
			openAlerts: [],
			findings: [
				{
					ruleKey: "zero_sales_day" as const,
					storeId: stores[1]?.storeId ?? "",
					values: {},
				},
				...drawer,
			],
		});
		const full = zalo(drawerFirst, 4000);
		expect(attentionCounts(full.text)).toEqual({
			title: 6,
			represented: 6,
			more: 0,
		});
		let tight: ReturnType<typeof zalo> | null = null;
		for (let max = full.units; max > 0 && tight === null; max -= 5) {
			const candidate = zalo(drawerFirst, max);
			if (candidate.truncation.at(-1) === "attention_3") {
				tight = candidate;
			}
		}
		expect(tight?.text).toContain("• và 3 mục khác");
		expect(attentionCounts(tight?.text ?? "")).toEqual({
			title: 6,
			represented: 3,
			more: 3,
		});
	});

	it("labels a like-for-like previous-day change with the stores it covers", () => {
		const base = model();
		const text = zalo(
			model({
				totals: {
					...base.totals,
					vsPrevious: {
						change: 0.031,
						sampleDays: null,
						unavailable: null,
						basis: "like_for_like",
						coveredStores: 1,
						totalStores: 2,
					},
				},
			}),
		).text;
		expect(text).toContain("• So với hôm trước (cùng 1/2 cửa hàng): +3,1%");
		expect(text).not.toContain("• So với hôm trước: +3,1%");
		const allStores = zalo(
			model({
				totals: {
					...base.totals,
					vsPrevious: {
						change: 0.031,
						sampleDays: null,
						unavailable: null,
						basis: "all_stores",
						coveredStores: 2,
						totalStores: 2,
					},
				},
			}),
		).text;
		expect(allStores).toContain("• So với hôm trước: +3,1%");
	});

	it("keeps amounts out of the e-mail preview with a figure-free preheader", () => {
		const email = renderDigest(model(), {
			channel: "email",
			appBaseUrl: BASE,
			timeZone: ZONE,
			currencyCode: "VND",
		});
		const visible = visibleText(email.html);
		const preview = visible.slice(0, 150);
		expect(
			preview.startsWith(
				"Bản tin ngày 07/11/2026 (Thứ Bảy) · Tất cả 2 cửa hàng · đã đối soát",
			),
		).toBe(true);
		expect(preview).not.toContain("₫");
		expect(preview).not.toContain("%");
		expect(preview).not.toMatch(/\d{1,3}\.\d{3}/);
		expect(visible).toContain("Doanh thu thuần: 12.345.000 ₫");
		expect(email.html).toContain('style="display:none');
	});
});
