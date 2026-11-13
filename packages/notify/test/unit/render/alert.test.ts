import { describe, expect, it } from "vitest";
import {
	type AlertFacts,
	renderAlert,
	renderQueuedMessage,
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
		expect(workflowKeyOf("Something else")).toBe("other");
	});
});
