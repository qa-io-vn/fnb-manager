import { describe, expect, it } from "vitest";
import {
	nextResendNumber,
	resendDedupePrefix,
	revisionDigestId,
	revisionEntries,
} from "../../../src/postgres/index.js";
import {
	correctionDelta,
	type DigestModel,
	type DigestStoreLine,
	digestModelSchema,
	renderCorrection,
	utf16Units,
} from "../../../src/render/index.js";
import { DAY, STORE_A, STORE_B } from "../../fixtures/ngay-rows.js";

const ZONE = "Asia/Ho_Chi_Minh";
const BASE = "https://example.github.io/app/";
const NBSP = " ";
const DIGEST_ID = "55555555-5555-4555-8555-555555555555";
const CHAT = "66666666-6666-4666-8666-666666666666";
const MAIL = "77777777-7777-4777-8777-777777777777";
const HOOK = "88888888-8888-4888-8888-888888888888";

function comparison(change: number | null) {
	return {
		change,
		sampleDays: 8,
		unavailable: change === null ? ("building_baseline" as const) : null,
	};
}

function store(
	storeId: string,
	name: string,
	net: number,
	invoices: number,
): DigestStoreLine {
	return {
		storeId,
		name,
		state: "verified",
		net,
		invoices,
		vsBaseline: comparison(0.01),
	};
}

function model(overrides: Partial<DigestModel> = {}): DigestModel {
	return digestModelSchema.parse({
		version: 1,
		tenantId: "33333333-3333-4333-8333-333333333333",
		businessDate: DAY,
		scope: { storeIds: [STORE_A, STORE_B], allStores: true },
		dataState: "unverified",
		holidayKind: null,
		totals: {
			net: 12_345_000,
			vsBaseline: comparison(-0.082),
			vsPrevious: comparison(0.031),
			invoices: 312,
			avgTicket: 39_567,
			cashToCount: 4_560_000,
			peakHour: { hour: 19, net: 1_234_000 },
			topItems: [{ name: "Trà sữa", quantity: 85 }],
		},
		stores: [
			store(STORE_A, "Cửa hàng 1", 7_100_000, 180),
			store(STORE_B, "Cửa hàng 2", 5_245_000, 132),
		],
		findings: [],
		openAlerts: [],
		link: { kind: "ngay", path: `#/bao-cao/ngay?date=${DAY}` },
		stale: false,
		builtAt: "2026-11-07T20:30:00.000Z",
		...overrides,
	});
}

const DRAWER = {
	ruleKey: "drawer_variance" as const,
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
};

function zaloOptions(maxUnits?: number) {
	return {
		channel: "zalo_bot" as const,
		appBaseUrl: BASE,
		timeZone: ZONE,
		currencyCode: "VND",
		...(maxUnits === undefined ? {} : { maxUnits }),
	};
}

function money(text: string): string {
	return text.replaceAll(" ₫", `${NBSP}₫`);
}

describe("digest correction render", () => {
	it("lists only the changed figures, with no amount in the first line", () => {
		const before = model();
		const after = model({
			dataState: "verified",
			totals: { ...before.totals, net: 12_445_000 },
			stores: [
				store(STORE_A, "Cửa hàng 1", 7_200_000, 180),
				store(STORE_B, "Cửa hàng 2", 5_245_000, 132),
			],
		});
		const rendered = renderCorrection(
			correctionDelta(before, after),
			after,
			zaloOptions(),
		);
		expect(rendered?.text).toBe(
			money(
				[
					"Cập nhật bản tin ngày 07/11/2026",
					"",
					"Sau lần đồng bộ đêm, số liệu đã thay đổi:",
					"• Doanh thu thuần: 12.445.000 ₫ (trước đó 12.345.000 ₫)",
					"• Cửa hàng 1: 7.200.000 ₫, 180 hóa đơn (trước đó 7.100.000 ₫, 180 hóa đơn)",
					"",
					`Xem báo cáo ngày: ${BASE}#/bao-cao/ngay?date=${DAY}`,
					"Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.",
				].join("\n"),
			),
		);
		expect(rendered?.text).not.toContain("Hóa đơn:");
		expect(rendered?.text).toBe(rendered?.text.normalize("NFC"));
		const first = rendered?.text.split("\n")[0] ?? "";
		expect(first).not.toContain("₫");
		expect(first.replace(/\d{2}\/\d{2}\/\d{4}/, "")).not.toMatch(/\d/);
		expect(rendered?.html).toBeNull();
	});

	it("adds a new drawer variance as a new attention line without an intro", () => {
		const before = model();
		const after = model({ findings: [DRAWER] });
		const rendered = renderCorrection(
			correctionDelta(before, after),
			after,
			zaloOptions(),
		);
		expect(rendered?.text).toContain("Mới cần chú ý (1):");
		expect(rendered?.text).toContain(
			money("• Cửa hàng 1: Ca 2 (14:00–22:00) lệch két -62.000 ₫."),
		);
		expect(rendered?.text).not.toContain("Sau lần đồng bộ đêm");
	});

	it("renders nothing for a state-only change or a removed finding", () => {
		const before = model({ findings: [DRAWER] });
		const after = model({ dataState: "verified" });
		expect(
			renderCorrection(correctionDelta(before, after), after, zaloOptions()),
		).toBeNull();
	});

	it("gives e-mail a figure-free subject and escaped Vietnamese HTML", () => {
		const before = model();
		const after = model({ totals: { ...before.totals, invoices: 313 } });
		const rendered = renderCorrection(correctionDelta(before, after), after, {
			...zaloOptions(),
			channel: "email",
		});
		expect(rendered?.title).toBe("Cập nhật bản tin ngày 07/11/2026");
		expect(rendered?.text).toContain("• Hóa đơn: 313 (trước đó 312)");
		expect(rendered?.html).toContain('lang="vi"');
	});

	it("fits 1,900 units on the Zalo Bot with many changed stores and findings", () => {
		const stores = Array.from({ length: 50 }, (_, index) =>
			store(
				`${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
				`Cửa hàng số ${index + 1} ${"x".repeat(20)}`,
				1_000_000 + index,
				10,
			),
		);
		const before = model({ stores });
		const after = model({
			stores: stores.map((entry) => ({
				...entry,
				net: (entry.net ?? 0) + 1000,
			})),
			findings: stores.slice(0, 20).map((entry, index) => ({
				...DRAWER,
				storeId: entry.storeId,
				values: { ...DRAWER.values, shift_external_id: `s-${index}` },
			})),
		});
		const rendered = renderCorrection(
			correctionDelta(before, after),
			after,
			zaloOptions(),
		);
		expect(utf16Units(rendered?.text ?? "")).toBeLessThanOrEqual(1900);
		expect(rendered?.text).toContain("• và 47 cửa hàng khác");
		expect(rendered?.text).toContain("Mới cần chú ý (20):");
	});
});

describe("digest revision payload", () => {
	const channels = [
		{
			id: CHAT,
			kind: "zalo_bot",
			provider: "zalo_bot",
			readerTimezone: ZONE,
			currencyCode: "VND",
		},
		{
			id: MAIL,
			kind: "email",
			provider: "brevo",
			readerTimezone: ZONE,
			currencyCode: "VND",
		},
		{
			id: HOOK,
			kind: "webhook",
			provider: "hmac_webhook",
			readerTimezone: ZONE,
			currencyCode: "VND",
		},
	];

	it("carries the rebuilt digest and the correction per digest destination", () => {
		const before = model();
		const after = model({ totals: { ...before.totals, net: 12_445_000 } });
		const entries = revisionEntries(before, after, channels, BASE);
		expect(entries.map((entry) => entry.channel_id)).toEqual([CHAT, MAIL]);
		const [chat, mail] = entries;
		expect(Object.keys(chat ?? {}).sort()).toEqual([
			"channel_id",
			"correction",
			"digest",
		]);
		expect(chat?.digest.title).toBe(chat?.digest.body.split("\n")[0]);
		expect(chat?.digest.body).toContain(money("12.445.000 ₫"));
		expect(chat?.correction?.body).toContain(
			money("• Doanh thu thuần: 12.445.000 ₫ (trước đó 12.345.000 ₫)"),
		);
		expect(mail?.digest.title).toBe(
			"Bản tin ngày 07/11/2026 · Tất cả 2 cửa hàng",
		);
		expect(mail?.correction?.title).toBe("Cập nhật bản tin ngày 07/11/2026");
	});

	it("sends no correction body when nothing shown changed", () => {
		const before = model();
		const after = model({ dataState: "verified" });
		const entries = revisionEntries(before, after, channels, null);
		expect(entries).toHaveLength(2);
		expect(entries.every((entry) => entry.correction === null)).toBe(true);
		expect(JSON.parse(JSON.stringify(entries))).toEqual(entries);
	});

	it("reads the digest id from any column name the scan returns", () => {
		expect(revisionDigestId({ digest_id: DIGEST_ID })).toBe(DIGEST_ID);
		expect(revisionDigestId({ id: DIGEST_ID, revision: 0 })).toBe(DIGEST_ID);
		expect(revisionDigestId({ other: 1 })).toBeNull();
		expect(revisionDigestId(null)).toBeNull();
	});
});

describe("resend numbering", () => {
	it("numbers each copy after the highest one already queued", () => {
		const prefix = resendDedupePrefix(DIGEST_ID, CHAT, 0);
		expect(prefix).toBe(`digest:${DIGEST_ID}:${CHAT}:r0:resend:`);
		expect(nextResendNumber(prefix, [])).toBe(1);
		expect(nextResendNumber(prefix, [`${prefix}1`])).toBe(2);
		expect(
			nextResendNumber(prefix, [
				`${prefix}1`,
				`${prefix}3`,
				`${prefix}0e3a1c2b-uuid`,
				`digest:${DIGEST_ID}:${MAIL}:r0:resend:9`,
			]),
		).toBe(4);
	});
});
