import { describe, expect, it } from "vitest";
import {
	fillTemplate,
	message,
	NOTICE_TEMPLATE,
	placeholdersOf,
	renderHandover,
	renderLinkCodeEmail,
	renderNotice,
	renderQueuedMessage,
	TemplateError,
	VI_MESSAGES,
} from "../../../src/render/index.js";

const FACTS = {
	channelKind: "zalo_bot" as const,
	provider: "zalo_bot" as const,
	channelLabel: "Zalo Bot",
	readerTimezone: "Asia/Ho_Chi_Minh",
	tenantName: "Quán thử nghiệm",
	at: new Date("2026-11-09T02:05:00.000Z"),
};

const LEFTOVER_PLACEHOLDER = /\{[^{}\n]+\}/;

describe("templates", () => {
	it("render every queued kind with every placeholder supplied", () => {
		const test = renderQueuedMessage({ ...FACTS, kind: "test" });
		expect(test.text).toBe(
			"Tin thử từ FNB Manager: kênh Zalo Bot hoạt động lúc 09:05 09/11/2026. Đây là tin nhắn tự động.",
		);
		const notice = renderQueuedMessage({ ...FACTS, kind: "link_notice" });
		expect(notice.text.startsWith(renderNotice(FACTS))).toBe(true);
		expect(notice.text).toContain(
			"Trả lời ĐỒNG Ý để nhận bản tin và cảnh báo.",
		);
		const confirmation = renderQueuedMessage({
			...FACTS,
			kind: "link_confirmation",
		});
		expect(confirmation.text).toContain("của Quán thử nghiệm tại đây");
		expect(confirmation.text).toContain("Đây là tin nhắn tự động");
		for (const rendered of [test, notice, confirmation]) {
			expect(rendered.text).not.toMatch(LEFTOVER_PLACEHOLDER);
			expect(rendered.text).toBe(rendered.text.normalize("NFC"));
			expect(rendered.title ?? "").not.toMatch(/\d/);
		}
	});

	it("render the notice, the e-mail code and the hand-over block", () => {
		const notice = renderNotice(FACTS);
		expect(notice).toContain(
			"Khi liên kết, Quán thử nghiệm chỉ dùng mã tài khoản Zalo",
		);
		expect(notice).toContain("tự động gửi qua Zalo Bot");
		expect(placeholdersOf(NOTICE_TEMPLATE).sort()).toEqual([
			"kênh",
			"nhà cung cấp",
			"tenant",
		]);
		const email = renderLinkCodeEmail({
			...FACTS,
			channelKind: "email",
			provider: "brevo",
			code: "123456",
		});
		expect(email.title).toBe("Mã xác nhận nhận bản tin");
		expect(email.text).toContain(": 123456. Mã hết hạn sau 15 phút.");
		const handover = renderHandover({
			...FACTS,
			code: "FNB-7K3QX9MD",
			botName: "Bot synthetic",
		});
		expect(
			handover.startsWith(
				"Gửi nguyên khối này cho người nhận nếu bạn liên kết giúp họ:\n",
			),
		).toBe(true);
		expect(handover).toContain(
			"Gửi mã FNB-7K3QX9MD cho Bot synthetic trong 15 phút",
		);
		for (const text of [notice, email.text, handover]) {
			expect(text).not.toMatch(LEFTOVER_PLACEHOLDER);
		}
	});

	it("supply every placeholder of every catalogue entry through a renderer or the CLI", () => {
		const supplied: Record<string, Record<string, string>> = {
			"test.subject": {},
			"test.body": { label: "", time: "", date: "" },
			"link_confirmation.subject": {},
			"link_confirmation.body": { tenant: "" },
			"link_code.subject": {},
			"link_code.body": { notice: "", code: "" },
			"link_notice.subject": {},
			"link_notice.body": { notice: "" },
			"link.handover": { notice: "", code: "", bot: "" },
			"link.instruction": { code: "", bot: "" },
			"link.retry": {},
		};
		const digestAndAlertKeys: Record<string, readonly string[]> = {
			"digest.title": ["date", "weekday"],
			"digest.subject": ["date", "scope"],
			"digest.scope.all": ["count"],
			"digest.scope.one": ["store"],
			"digest.scope.some": ["count"],
			"digest.state.verified": [],
			"digest.state.unverified": [],
			"digest.state.unmatched": ["stores"],
			"digest.state.partial": ["stores", "time"],
			"digest.state.stores.more": ["count", "stores"],
			"digest.state.no_data": ["date"],
			"digest.stale": [],
			"digest.net": ["net"],
			"digest.vsBaseline": ["change"],
			"digest.vsBaseline.partial": ["change", "weeks"],
			"digest.vsBaseline.building": [],
			"digest.vsPrevious": ["change"],
			"digest.vsPrevious.likeForLike": ["change", "covered", "total"],
			"digest.invoices": ["invoices", "ticket"],
			"digest.invoices.only": ["invoices"],
			"digest.cash": ["cash"],
			"digest.peak": ["hour", "net"],
			"digest.topItems": ["items"],
			"digest.topItem": ["item", "quantity"],
			"digest.holiday": ["kind"],
			"digest.holiday.tet": [],
			"digest.holiday.holiday": [],
			"digest.stores.title": [],
			"digest.stores.line": ["change", "net", "store"],
			"digest.stores.line.partial": ["change", "net", "store", "weeks"],
			"digest.stores.line.building": ["net", "store"],
			"digest.stores.closed": ["store"],
			"digest.stores.noSales": ["store"],
			"digest.stores.unsettled": ["store"],
			"digest.stores.shiftOpen": ["store", "time"],
			"digest.stores.more": ["count"],
			"digest.attention.title": ["count"],
			"digest.attention.more": ["count"],
			"digest.finding.revenue_below_baseline": ["ratio", "store", "threshold"],
			"digest.finding.ticket_drop": ["drop", "reference", "store", "ticket"],
			"digest.finding.ticket_drop.baseline": [],
			"digest.finding.ticket_drop.previous": [],
			"digest.finding.drawer_variance": [
				"from",
				"shift",
				"store",
				"to",
				"variance",
			],
			"digest.finding.drawer_variance.more": ["count", "store"],
			"digest.finding.drawer_variance.shift": ["number"],
			"digest.finding.drawer_variance.shift.unknown": [],
			"digest.finding.unverified_day.unmatched": ["store"],
			"digest.finding.unverified_day.unchecked": ["store"],
			"digest.finding.zero_sales_day": ["store"],
			"digest.open.title": [],
			"digest.open.auth_failed": ["account", "date"],
			"digest.open.sync_stale": ["date", "store", "time"],
			"digest.open.sync_failed": ["date", "subject"],
			"digest.link.ngay": ["url"],
			"digest.link.today": ["url"],
			"digest.footer": [],
			"correction.title": ["date"],
			"correction.intro": [],
			"correction.net": ["net", "old"],
			"correction.invoices": ["invoices", "old"],
			"correction.store": ["invoices", "net", "oldInvoices", "oldNet", "store"],
			"correction.attention": ["count"],
			"alert.subject": [],
			"alert.reminder.subject": [],
			"alert.resolved.subject": [],
			"alert.auth_failed": ["account", "count"],
			"alert.auth_failed.stores": ["account"],
			"alert.auth_failed.resolved": ["account"],
			"alert.sync_stale": ["minutes", "store", "threshold"],
			"alert.sync_stale.reminder": ["date", "store", "time"],
			"alert.sync_stale.resolved": ["store", "time"],
			"alert.sync_stale.previous_day": ["minutes", "store", "threshold"],
			"alert.sync_failed": ["count", "stage", "subject"],
			"alert.sync_failed.stage.config": [],
			"alert.sync_failed.stage.connect": [],
			"alert.sync_failed.stage.run": [],
			"alert.sync_failed.subject.kind": ["account", "kind"],
			"alert.sync_failed.kind.nightly": [],
			"alert.sync_failed.kind.backfill": [],
			"alert.sync_failed.kind.reconciliation": [],
			"alert.sync_failed.kind.incremental": [],
			"alert.sync_dispatch_failed": ["count", "store"],
			"alert.zero_sales_open": ["minutes", "store"],
			"alert.nightly_missing": ["hours"],
			"alert.nightly_missing.resolved": ["time"],
			"alert.job_failed": ["conclusion", "time", "workflow"],
			"alert.job_failed.workflows_active": [],
			"alert.channel_failed": ["label", "reason"],
			"alert.digest_failed": ["attempts", "date"],
			"alert.generic": ["rule"],
			"alert.generic.resolved": ["rule"],
			"alert.footer": [],
			"workflow.sync": [],
			"workflow.backup": [],
			"workflow.migrate": [],
			"workflow.deploy_web": [],
			"workflow.deploy_functions": [],
			"workflow.notify": [],
			"workflow.workflows_active": [],
			"workflow.other": [],
			"reason.token_invalid": [],
			"reason.unauthorized": [],
			"reason.no_credit": [],
			"reason.not_found": [],
			"reason.blocked_by_user": [],
			"reason.secret_missing": [],
			"reason.sender_missing": [],
			"reason.permission_denied": [],
			"reason.account_under_validation": [],
		};
		for (const [key, names] of Object.entries(digestAndAlertKeys)) {
			supplied[key] = Object.fromEntries(names.map((name) => [name, ""]));
		}
		expect(Object.keys(supplied).sort()).toEqual(
			Object.keys(VI_MESSAGES).sort(),
		);
		for (const [key, template] of Object.entries(VI_MESSAGES)) {
			expect(placeholdersOf(template).sort(), key).toEqual(
				Object.keys(supplied[key] ?? {}).sort(),
			);
		}
	});

	it("fail on an unknown or missing placeholder", () => {
		expect(() => fillTemplate("Xin chào {tên}", {})).toThrow(TemplateError);
		expect(() => message("test.body", { label: "x", time: "y" })).toThrow(
			/date/,
		);
		expect(() => renderQueuedMessage({ ...FACTS, kind: "digest" })).toThrow(
			TemplateError,
		);
		expect(fillTemplate("{a} và {a}", { a: 1 })).toBe("1 và 1");
	});
});
