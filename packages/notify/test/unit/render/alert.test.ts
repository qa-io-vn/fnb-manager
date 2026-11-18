import { describe, expect, it } from "vitest";
import { BREVO_LIMITS, ZALO_BOT_LIMITS } from "../../../src/index.js";
import {
	type AlertFacts,
	fitSubject,
	fitToUnits,
	renderAlert,
	renderQueuedMessage,
	utf16Units,
	workflowKeyOf,
} from "../../../src/render/index.js";

const ZONE = "Asia/Ho_Chi_Minh";
const AT = new Date("2026-11-09T02:05:00.000Z");
const FOOTER = "Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.";
const LEFTOVER = /\{[^{}\n]+\}/;

function facts(overrides: Partial<AlertFacts>): AlertFacts {
	return {
		kind: "alert",
		ruleKey: null,
		templateRef: null,
		params: {},
		storeName: "Cửa hàng thử",
		accountName: "Tài khoản thử",
		readerTimezone: ZONE,
		at: AT,
		...overrides,
	};
}

function body(rendered: { text: string }): string {
	const lines = rendered.text.split("\n");
	expect(lines.at(-1)).toBe(FOOTER);
	return lines.slice(0, -1).join("\n");
}

describe("alert render", () => {
	it("renders every opening template from the episode facts", () => {
		const cases: [Partial<AlertFacts>, string][] = [
			[
				{ ruleKey: "auth_failed", params: { store_count: 2 } },
				"Cảnh báo: POS từ chối đăng nhập Tài khoản thử. Đồng bộ 2 cửa hàng đã dừng. Cập nhật mật khẩu ở .env, secret GitHub và secret Edge Function, rồi chạy lại đồng bộ.",
			],
			[
				{ ruleKey: "auth_failed" },
				"Cảnh báo: POS từ chối đăng nhập Tài khoản thử. Đồng bộ các cửa hàng của tài khoản này đã dừng. Cập nhật mật khẩu ở .env, secret GitHub và secret Edge Function, rồi chạy lại đồng bộ.",
			],
			[
				{
					ruleKey: "sync_stale",
					params: { minutes_without_sync: 95, threshold_minutes: 90 },
				},
				"Cảnh báo: Cửa hàng thử chưa đồng bộ thành công trong 95 phút mở cửa (ngưỡng 90). Số liệu hôm nay có thể chưa cập nhật.",
			],
			[
				{
					ruleKey: "sync_stale",
					params: {
						minutes_without_sync: 120,
						threshold_minutes: 90,
						scope: "previous_day",
					},
				},
				"Cửa hàng thử: hôm qua có 120 phút mở cửa liền nhau không đồng bộ được (ngưỡng 90).",
			],
			[
				{
					ruleKey: "sync_failed",
					params: { stage: "connect", occurrences: 2 },
				},
				"Cảnh báo: đồng bộ Cửa hàng thử lỗi khi kết nối POS (2 lần liên tiếp). Hệ thống sẽ thử lại; nếu còn lỗi, chạy fnb status.",
			],
			[
				{
					ruleKey: "sync_failed",
					storeName: null,
					params: { kind: "nightly", occurrences: 1 },
				},
				"Cảnh báo: đồng bộ Tài khoản thử (đồng bộ đêm) lỗi khi đồng bộ dữ liệu (1 lần liên tiếp). Hệ thống sẽ thử lại; nếu còn lỗi, chạy fnb status.",
			],
			[
				{ ruleKey: "sync_dispatch_failed", params: { occurrences: 3 } },
				"Cảnh báo: lịch đồng bộ không gọi được hàm đồng bộ cho Cửa hàng thử (3 lần). Xem nhật ký Edge Function sync-incremental.",
			],
			[
				{
					ruleKey: "sync_dispatch_failed",
					params: { sync_alert_occurrences: 4, occurrences: 1 },
				},
				"Cảnh báo: lịch đồng bộ không gọi được hàm đồng bộ cho Cửa hàng thử (4 lần). Xem nhật ký Edge Function sync-incremental.",
			],
			[
				{ ruleKey: "zero_sales_open", params: { open_minutes: 130 } },
				"Cửa hàng thử: đã mở cửa 130 phút nhưng chưa có hóa đơn nào hôm nay.",
			],
			[
				{ ruleKey: "nightly_missing", params: { hours: 30 } },
				"Cảnh báo: đồng bộ đêm chưa chạy thành công trong 30 giờ qua. Kiểm tra tab Actions của kho mã.",
			],
			[
				{
					ruleKey: "job_failed",
					params: {
						workflow: "sync",
						conclusion: "failure",
						opened_at: 1_762_653_600,
					},
				},
				'Cảnh báo: tác vụ tự động "Đồng bộ đêm" thất bại lúc 09:00 (failure). Mở tab Actions của kho mã để xem nhật ký.',
			],
			[
				{ ruleKey: "job_failed", params: { workflow: "workflows_active" } },
				"Một số tác vụ theo lịch đã bị GitHub tắt vì kho mã lâu không hoạt động và vừa được bật lại.",
			],
			[
				{
					ruleKey: "channel_failed",
					params: { channel_kind: "zalo_bot", error_code: "token_invalid" },
				},
				"Cảnh báo: kênh Zalo không gửi được tin (token không hợp lệ). Kiểm tra token hoặc liên kết lại trong Cài đặt → Cảnh báo.",
			],
			[
				{
					ruleKey: "digest_failed",
					params: { business_date: "2026-11-07", attempts: 5 },
				},
				"Cảnh báo: chưa tạo được bản tin ngày 07/11/2026 sau 5 lần thử.",
			],
		];
		for (const [input, expected] of cases) {
			const rendered = renderAlert(facts(input));
			expect(body(rendered)).toBe(expected);
			expect(rendered.title).toBe("Cảnh báo vận hành từ FNB Manager");
			expect(rendered.text).not.toMatch(LEFTOVER);
			expect(rendered.title).not.toMatch(/\d/);
		}
	});

	it("renders reminders and resolution notices", () => {
		const reminder = renderAlert(
			facts({
				kind: "alert_reminder",
				ruleKey: "sync_stale",
				params: { opened_at: 1_762_653_600 },
			}),
		);
		expect(body(reminder)).toBe(
			"Nhắc lại: Cửa hàng thử vẫn chưa đồng bộ được (từ 09:00 09/11/2025).",
		);
		expect(reminder.title).toBe("Nhắc lại cảnh báo vận hành");
		expect(
			body(
				renderAlert(facts({ kind: "alert_resolved", ruleKey: "sync_stale" })),
			),
		).toBe("Đã khôi phục: Cửa hàng thử đồng bộ lại được lúc 09:05.");
		expect(
			body(
				renderAlert(facts({ kind: "alert_resolved", ruleKey: "auth_failed" })),
			),
		).toBe("Đã khôi phục: Tài khoản thử đăng nhập lại được, đồng bộ tiếp tục.");
		expect(
			body(
				renderAlert(
					facts({ kind: "alert_resolved", ruleKey: "nightly_missing" }),
				),
			),
		).toBe("Đã khôi phục: đồng bộ đêm chạy thành công lúc 09:05.");
	});

	it("finds the rule in the params or the template reference and renders through the queue", () => {
		expect(
			body(
				renderAlert(
					facts({
						templateRef: "alert.nightly_missing.v1",
						params: { hours: 30 },
					}),
				),
			),
		).toContain("30 giờ qua");
		const queued = renderQueuedMessage({
			kind: "alert",
			channelKind: "email",
			provider: "brevo",
			channelLabel: "E-mail",
			readerTimezone: ZONE,
			tenantName: "Quán thử",
			at: AT,
			ruleKey: null,
			params: { rule_key: "sync_dispatch_failed", occurrences: 2 },
			storeName: "Cửa hàng thử",
			accountName: null,
		});
		expect(queued.text).toContain("(2 lần)");
		expect(queued.title).toBe("Cảnh báo vận hành từ FNB Manager");
	});

	it("maps workflow names to keys", () => {
		expect(workflowKeyOf("Sync")).toBe("sync");
		expect(workflowKeyOf("Migrate database")).toBe("migrate");
		expect(workflowKeyOf("deploy_web")).toBe("deploy_web");
		expect(workflowKeyOf("Zalo tokens")).toBe("zalo_tokens");
		expect(workflowKeyOf(" Zalo tokens ")).toBe("zalo_tokens");
		expect(workflowKeyOf("zalo_tokens")).toBe("zalo_tokens");
		expect(workflowKeyOf("Something else")).toBe("other");
		expect(
			body(
				renderAlert(
					facts({
						ruleKey: "job_failed",
						params: {
							workflow: "zalo_tokens",
							conclusion: "timed_out",
							opened_at: 1_762_653_600,
						},
					}),
				),
			),
		).toBe(
			'Cảnh báo: tác vụ tự động "Làm mới token Zalo" thất bại lúc 09:00 (timed_out). Mở tab Actions của kho mã để xem nhật ký.',
		);
	});
});

describe("Zalo alert render", () => {
	const OPENING: [Partial<AlertFacts>, string][] = [
		[
			{
				ruleKey: "zalo_token_failed",
				params: {
					kind: "oa",
					brand: "brand-1",
					reason: "refused",
					error_code: -216,
				},
			},
			"Cảnh báo: Zalo từ chối làm mới token OA của thương hiệu brand-1 (mã lỗi -216). Cấp lại bằng fnb zalo oa authorize, rồi kiểm tra bằng fnb zalo status.",
		],
		[
			{
				ruleKey: "zalo_token_failed",
				params: {
					kind: "developer",
					brand: "brand-2",
					reason: "refused",
					error_code: -124,
				},
			},
			"Cảnh báo: Zalo từ chối làm mới token nhà phát triển Mini App của thương hiệu brand-2 (mã lỗi -124). Cấp lại bằng fnb zalo zmp seed, rồi kiểm tra bằng fnb zalo status.",
		],
		[
			{
				ruleKey: "zalo_token_failed",
				params: { kind: "oa", brand: "brand-1", reason: "not_configured" },
			},
			"Cảnh báo: chưa làm mới được token OA của thương hiệu brand-1 vì nơi chạy tác vụ thiếu App secret của thương hiệu. Thêm secret đó, rồi chạy lại tác vụ.",
		],
		[
			{
				ruleKey: "zalo_token_failed",
				params: { kind: "developer", brand: "brand-1", reason: "unanswered" },
			},
			"Cảnh báo: Zalo không trả lời khi làm mới token nhà phát triển Mini App của thương hiệu brand-1. Token cũ không được dùng lại; lần chạy sau sẽ đọc lại trạng thái. Nếu còn lỗi, chạy fnb zalo status.",
		],
		[
			{
				ruleKey: "zalo_token_failed",
				params: { kind: "oa", brand: "brand-1", reason: "refused" },
			},
			"Cảnh báo: chưa làm mới được token OA của thương hiệu brand-1. Chạy fnb zalo status để xem trạng thái.",
		],
		[
			{ ruleKey: "zalo_token_failed", params: {} },
			"Cảnh báo: chưa làm mới được token Zalo của thương hiệu ?. Chạy fnb zalo status để xem trạng thái.",
		],
		[
			{
				ruleKey: "oa_package_expiring",
				params: {
					days_left: 30,
					notice_days: 30,
					expires_on: "2026-12-09",
					tier: "tang_truong",
				},
			},
			"Cảnh báo: gói Tăng trưởng của OA hết hạn ngày 09/12/2026, còn 30 ngày. Gia hạn trong trang quản lý OA để tin nhắn qua OA không bị gián đoạn.",
		],
		[
			{
				ruleKey: "oa_package_expiring",
				params: {
					days_left: 7,
					notice_days: 7,
					expires_on: "2026-11-16",
					tier: "toan_dien",
				},
			},
			"Cảnh báo: gói Toàn diện của OA hết hạn ngày 16/11/2026, còn 7 ngày. Gia hạn trong trang quản lý OA để tin nhắn qua OA không bị gián đoạn.",
		],
		[
			{
				ruleKey: "oa_package_expiring",
				params: {
					days_left: 0,
					notice_days: 7,
					expires_on: "2026-11-09",
					tier: "co_ban",
				},
			},
			"Cảnh báo: gói Cơ bản của OA hết hạn ngày 09/11/2026. Gia hạn ngay trong trang quản lý OA để tin nhắn qua OA không bị gián đoạn.",
		],
		[
			{
				ruleKey: "zalo_webhook_unverified",
				params: {
					unverified: 11,
					max_per_day: 10,
					mode: "observe",
					business_date: "2026-11-09",
				},
			},
			"Cảnh báo: ngày 09/11/2026, webhook OA nhận 11 sự kiện sai chữ ký (ngưỡng 10 mỗi ngày). Chế độ quan sát vẫn lưu các sự kiện này; kiểm tra khóa bí mật OA trong secret Edge Function trước khi chuyển sang chế độ chặn.",
		],
		[
			{
				ruleKey: "zalo_webhook_unverified",
				params: {
					unverified: 1,
					max_per_day: 0,
					mode: "enforce",
					business_date: "2026-11-09",
				},
			},
			"Cảnh báo: ngày 09/11/2026, webhook OA từ chối 1 sự kiện sai chữ ký (ngưỡng 0 mỗi ngày). Kiểm tra khóa bí mật OA trong secret Edge Function; nếu khóa đúng, có thể có người gửi sự kiện giả.",
		],
		[
			{
				ruleKey: "zalo_webhook_unverified",
				params: { unverified: 21, max_per_day: 20 },
			},
			"Cảnh báo: ngày ?, webhook OA nhận 21 sự kiện sai chữ ký (ngưỡng 20 mỗi ngày). Kiểm tra khóa bí mật OA trong secret Edge Function.",
		],
	];

	it("renders the token, package and webhook alerts from their count-only facts", () => {
		for (const [input, expected] of OPENING) {
			const rendered = renderAlert(
				facts({ ...input, storeName: null, accountName: null }),
			);
			expect(body(rendered)).toBe(expected);
			expect(body(rendered)).not.toContain("Cảnh báo vận hành:");
			expect(rendered.title).toBe("Cảnh báo vận hành từ FNB Manager");
			expect(rendered.text).not.toMatch(LEFTOVER);
		}
	});

	it("reminds of and resolves a token failure", () => {
		const params = { kind: "oa", brand: "brand-1", reason: "refused" };
		const reminder = renderAlert(
			facts({
				kind: "alert_reminder",
				ruleKey: "zalo_token_failed",
				params: { ...params, opened_at: 1_762_653_600 },
			}),
		);
		expect(body(reminder)).toBe(
			"Nhắc lại: token OA của thương hiệu brand-1 vẫn chưa được làm mới (từ 09:00 09/11/2025). Chạy fnb zalo status để xem trạng thái.",
		);
		expect(reminder.title).toBe("Nhắc lại cảnh báo vận hành");
		const resolved = renderAlert(
			facts({
				kind: "alert_resolved",
				templateRef: "alert.zalo_token_failed.resolved.v1",
				params: { ...params, kind: "developer" },
			}),
		);
		expect(body(resolved)).toBe(
			"Đã khôi phục: token nhà phát triển Mini App của thương hiệu brand-1 đã được lưu lại lúc 09:05.",
		);
		expect(resolved.title).toBe("Đã khôi phục");
	});

	it("fits every channel without truncation", () => {
		for (const [input] of OPENING) {
			for (const kind of ["alert", "alert_reminder"] as const) {
				const rendered = renderAlert(facts({ ...input, kind }));
				expect(utf16Units(rendered.text)).toBeLessThanOrEqual(
					ZALO_BOT_LIMITS.maxTextUnits,
				);
				expect(fitToUnits(rendered.text, ZALO_BOT_LIMITS.maxTextUnits)).toBe(
					rendered.text,
				);
				expect(fitSubject(rendered.title, BREVO_LIMITS.maxSubjectChars)).toBe(
					rendered.title,
				);
				expect(rendered.text.split("\n")[0]).not.toMatch(/₫|\d{1,3}(\.\d{3})+/);
			}
		}
	});
});
