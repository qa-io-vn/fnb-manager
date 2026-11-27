import { type RestClient, RestError } from "@fnb/zalo-mini";
import { mockSdkCalls, resetMockSdk } from "@fnb/zalo-mini/testing/mock-sdk";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_TEMPLATE } from "../../../../packages/notify/src/messages/notice";
import { SAMPLE_TENANT_ID } from "../shift/sample";
import { createRestTeamClient, type TeamClient } from "../team/client";
import {
	createDemoTeamClient,
	DEMO_BOT_NAME,
	DEMO_LINK_CODES,
	DEMO_OA_ID,
	DEMO_TENANT_NAME,
	demoNoticeText,
} from "../team/demo";
import { TEAM_PATHS } from "../team/env";
import { renderStaffApp } from "../test/render-app";
import { primaryActions, renderTeam, screenReady } from "../test/team-harness";
import {
	clockText,
	destinationState,
	NOTICE_VERSION,
	NOTIFY_FUNCTIONS,
	readLinkCode,
	readSettings,
	ruleLabelKey,
	secondsLeft,
	toggled,
} from "./contract";

const NOTICE_TEXT = demoNoticeText(DEMO_TENANT_NAME);

interface FakeRest extends RestClient {
	readonly selects: string[];
	readonly calls: { fn: string; args: Readonly<Record<string, unknown>> }[];
}

function fakeRest(
	answers: Readonly<Record<string, (args: Record<string, unknown>) => unknown>>,
): FakeRest {
	const selects: string[] = [];
	const calls: { fn: string; args: Readonly<Record<string, unknown>> }[] = [];
	return {
		selects,
		calls,
		async select(table) {
			selects.push(table);
			return [];
		},
		async rpc(fn, args = {}) {
			calls.push({ fn, args: { ...args } });
			const answer = answers[fn];
			if (answer === undefined) throw new RestError(404, null);
			return answer({ ...args });
		},
	};
}

const LIVE_SETTINGS = {
	consent: {
		state: "active",
		granted_at: "2026-11-01T03:00:00+00:00",
		revoked_at: null,
		channel: "zalo_bot",
	},
	destinations: [
		{
			id: "c1",
			kind: "zalo_bot",
			provider: "zalo_bot",
			label: "Zalo Bot",
			address_hint: "…9b2c",
			status: "pending",
			enabled: true,
			muted_rules: [],
			linked_at: null,
			last_ok_at: null,
			disabled_reason: null,
			link_stage: "acceptance",
			link_expires_at: "2026-11-20T03:00:00+00:00",
		},
		{
			id: "c2",
			kind: "email",
			provider: "brevo",
			label: "E-mail",
			address_hint: "n…@example.com",
			status: "active",
			enabled: true,
			muted_rules: ["checklist_unfinished", "a_rule_added_later"],
			linked_at: "2026-11-01T00:00:00+00:00",
			last_ok_at: null,
			disabled_reason: null,
			link_stage: null,
			link_expires_at: null,
		},
	],
	rules: [
		{ rule_key: "staff_sync_stale", category: "sync", delivery: "immediate" },
		{
			rule_key: "checklist_unfinished",
			category: "operations",
			delivery: "immediate",
		},
		{
			rule_key: "a_rule_added_later",
			category: "business",
			delivery: "immediate",
		},
	],
	notice: { version: NOTICE_VERSION, text: "Khi liên kết, Cửa hàng Thật …" },
	bot_name: "Bot Thật",
};

function liveRest(): FakeRest {
	let muted: string[] = ["checklist_unfinished", "a_rule_added_later"];
	return fakeRest({
		[NOTIFY_FUNCTIONS.settings]: () => ({
			...LIVE_SETTINGS,
			destinations: [
				LIVE_SETTINGS.destinations[0],
				{ ...LIVE_SETTINGS.destinations[1], muted_rules: muted },
				{
					...LIVE_SETTINGS.destinations[1],
					id: "c3",
					kind: "telegram",
					provider: "telegram",
					label: "Telegram",
					address_hint: null,
					status: "pending",
					muted_rules: [],
					linked_at: null,
				},
			],
		}),
		[NOTIFY_FUNCTIONS.followTarget]: () => "synthetic-oa-live",
		[NOTIFY_FUNCTIONS.setMutedRules]: (args) => {
			muted = args.p_muted_rules as string[];
			return muted;
		},
		[NOTIFY_FUNCTIONS.stop]: () => 3,
		[NOTIFY_FUNCTIONS.startBotLink]: () => {
			throw new RestError(409, "23505");
		},
	});
}

function unlinkedDemo(role: "staff" | "manager" = "staff") {
	return createDemoTeamClient({
		settings: { delayMs: 0, notify: "unlinked" },
		role,
	});
}

function linkedDemo(role: "staff" | "manager" = "staff") {
	return createDemoTeamClient({
		settings: { delayMs: 0, notify: "linked" },
		role,
	});
}

beforeEach(() => {
	resetMockSdk();
});

afterEach(() => {
	vi.restoreAllMocks();
	window.history.replaceState(null, "", "/");
});

describe("the notifications answers", () => {
	it("reads the member's consent, destinations, rules, notice and bot", () => {
		const settings = readSettings(LIVE_SETTINGS);
		expect(settings.consent).toEqual({
			state: "active",
			grantedAt: "2026-11-01T03:00:00+00:00",
			revokedAt: null,
		});
		expect(settings.destinations.map(destinationState)).toEqual([
			"waiting",
			"receiving",
		]);
		expect(settings.destinations[0]).toMatchObject({
			linkStage: "acceptance",
			hint: "…9b2c",
		});
		expect(settings.destinations[1]?.mutedRules).toEqual([
			"checklist_unfinished",
			"a_rule_added_later",
		]);
		expect(settings.rules.map(ruleLabelKey)).toEqual([
			"notify.rule.staff_sync_stale",
			"notify.rule.checklist_unfinished",
			"notify.category.business",
		]);
		expect(ruleLabelKey({ key: "unknown_rule", category: null })).toBe(
			"notify.rule.other",
		);
		expect(settings.notice?.version).toBe(NOTICE_VERSION);
		expect(settings.botName).toBe("Bot Thật");
		expect(() => readSettings({ ...LIVE_SETTINGS, consent: null })).toThrow();
	});

	it("reads a link code only in the code's shape", () => {
		const answer = {
			channel_id: "c1",
			notice_version: NOTICE_VERSION,
			code: "FNB-ABCD2345",
			expires_at: "2026-11-19T05:15:00+00:00",
			bot_name: null,
		};
		expect(readLinkCode(answer)).toEqual({
			channelId: "c1",
			noticeVersion: NOTICE_VERSION,
			code: "FNB-ABCD2345",
			expiresAt: "2026-11-19T05:15:00+00:00",
			botName: null,
		});
		expect(() => readLinkCode({ ...answer, code: "1234" })).toThrow();
		expect(() => readLinkCode({ ...answer, expires_at: "soon" })).toThrow();
	});

	it("counts the code down and toggles a rule", () => {
		const now = Date.parse("2026-11-19T05:00:00Z");
		expect(secondsLeft("2026-11-19T05:15:00Z", now)).toBe(900);
		expect(clockText(900)).toBe("15:00");
		expect(clockText(61)).toBe("01:01");
		expect(secondsLeft("2026-11-19T04:59:00Z", now)).toBe(0);
		expect(toggled(["a", "b"], "a", true)).toEqual(["b"]);
		expect(toggled(["b"], "a", false)).toEqual(["b", "a"]);
	});

	it("shows the phase 12 notice word for word", () => {
		const filled = NOTICE_TEMPLATE.replace("{tenant}", DEMO_TENANT_NAME)
			.replace("{kênh}", "Zalo")
			.replace("{nhà cung cấp}", "Zalo Bot")
			.normalize("NFC");
		expect(NOTICE_TEXT).toBe(filled);
	});
});

describe("Nhận thông báo", () => {
	it("is reached from the Cá nhân tab", async () => {
		renderStaffApp();
		const navigation = await screen.findByRole("navigation", {
			name: "Điều hướng chính",
		});
		fireEvent.click(
			within(navigation).getByRole("button", { name: "Cá nhân" }),
		);
		const section = await screen.findByTestId("profile-notifications");
		fireEvent.click(
			within(section).getByRole("button", { name: "Cài đặt nhận thông báo" }),
		);
		expect(await screen.findByTestId("destination-list")).toBeInTheDocument();
	});

	it("lists the linked destination, the consent and every action, without a link or a primary action", async () => {
		renderTeam({ path: TEAM_PATHS.notifications });
		const list = await screenReady("destination-list");
		const items = within(list).getAllByTestId("destination");
		expect(items).toHaveLength(1);
		expect(items[0]).toHaveTextContent("Zalo Bot");
		expect(items[0]).toHaveTextContent("…3f7a");
		expect(
			within(items[0] as HTMLElement).getByTestId("destination-state"),
		).toHaveTextContent("Đang nhận");
		expect(screen.getByTestId("consent-state")).toHaveTextContent(
			"Bạn đồng ý nhận bản tin và cảnh báo lúc",
		);
		expect(screen.getByTestId("bot-linked")).toHaveTextContent(
			"Zalo Bot đã được liên kết.",
		);
		expect(screen.queryByTestId("bot-not-ready")).toBeNull();
		expect(screen.getAllByTestId("mute-destination")).toHaveLength(1);
		expect(
			within(screen.getByTestId("notify-stop")).getByRole("button", {
				name: "Dừng nhận thông báo",
			}),
		).toBeEnabled();
		expect(screen.getByTestId("notify-group")).toHaveTextContent(
			"Nhờ quản lý thêm bạn vào nhóm Zalo nhân viên",
		);
		expect(screen.queryAllByText("Chưa sẵn sàng")).toHaveLength(0);
		expect(document.querySelectorAll("a")).toHaveLength(0);
		expect(primaryActions()).toHaveLength(0);
	});

	it("shows the notice before any code, and the code only after the member asks for it", async () => {
		const client = unlinkedDemo();
		const start = vi.spyOn(client, "startBotLink");
		renderTeam({ path: TEAM_PATHS.notifications, client });
		expect(await screenReady("destinations-empty")).toHaveTextContent(
			"Bạn chưa liên kết nơi nhận nào.",
		);
		expect(screen.getByTestId("consent-state")).toHaveTextContent(
			"Bạn chưa đồng ý nhận bản tin và cảnh báo.",
		);
		expect(screen.getByTestId("mute-empty")).toHaveTextContent(
			"Liên kết một nơi nhận để chọn loại tin.",
		);
		expect(screen.getByTestId("stop-nothing")).toHaveTextContent(
			"Bạn đang không nhận thông báo nào.",
		);
		const bot = screen.getByTestId("notify-bot");
		fireEvent.click(
			within(bot).getByRole("button", { name: "Liên kết Zalo Bot" }),
		);
		const notice = within(bot).getByTestId("bot-notice");
		expect(within(notice).getByTestId("notice-text").textContent).toBe(
			NOTICE_TEXT,
		);
		expect(notice.dataset.version).toBe(NOTICE_VERSION);
		expect(within(bot).queryByTestId("link-code")).toBeNull();
		expect(start).not.toHaveBeenCalled();
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(
			within(notice).getByRole("button", { name: "Tạo mã liên kết" }),
		);
		const code = await within(bot).findByTestId("link-code");
		expect(start).toHaveBeenCalledWith(SAMPLE_TENANT_ID, NOTICE_VERSION);
		expect(code).toHaveTextContent(DEMO_LINK_CODES[0]);
		expect(within(bot).getByTestId("link-countdown").textContent).toMatch(
			/^Mã hết hạn sau 1[45]:\d\d$/,
		);
		expect(within(bot).getByTestId("link-steps")).toHaveTextContent(
			`Mở Zalo và tìm ${DEMO_BOT_NAME}.`,
		);
		expect(within(bot).getByTestId("link-steps")).toHaveTextContent(
			"Trả lời ĐỒNG Ý để bắt đầu nhận tin.",
		);
		expect(within(bot).queryByTestId("bot-notice")).toBeNull();
		expect(document.querySelectorAll("a")).toHaveLength(0);
		expect(primaryActions()).toHaveLength(0);
		const waiting = await screen.findByTestId("destination-waiting");
		expect(waiting).toHaveTextContent(
			"Gửi mã liên kết cho Bot trong khung chat Zalo để tiếp tục.",
		);
		expect(screen.getByTestId("consent-state")).toHaveTextContent(
			"Bạn chưa đồng ý",
		);
	});

	it("says when the code has expired and shows the notice again for a new one", async () => {
		const client = unlinkedDemo();
		renderTeam({ path: TEAM_PATHS.notifications, client });
		const bot = await screenReady("notify-bot");
		fireEvent.click(
			await within(bot).findByRole("button", { name: "Liên kết Zalo Bot" }),
		);
		fireEvent.click(
			within(bot).getByRole("button", { name: "Tạo mã liên kết" }),
		);
		await within(bot).findByTestId("link-code");
		const later = Date.now() + 16 * 60_000;
		vi.spyOn(Date, "now").mockReturnValue(later);
		expect(
			await within(bot).findByTestId("link-expired", {}, { timeout: 3000 }),
		).toHaveTextContent("Mã đã hết hạn. Tạo mã mới để liên kết.");
		expect(within(bot).queryByTestId("link-code")).toBeNull();
		fireEvent.click(within(bot).getByRole("button", { name: "Tạo mã mới" }));
		expect(within(bot).getByTestId("notice-text").textContent).toBe(
			NOTICE_TEXT,
		);
	});

	it("goes back without a code when the member chooses later", async () => {
		const client = unlinkedDemo();
		const start = vi.spyOn(client, "startBotLink");
		renderTeam({ path: TEAM_PATHS.notifications, client });
		const bot = await screenReady("notify-bot");
		fireEvent.click(
			await within(bot).findByRole("button", { name: "Liên kết Zalo Bot" }),
		);
		fireEvent.click(within(bot).getByRole("button", { name: "Để sau" }));
		expect(within(bot).queryByTestId("bot-notice")).toBeNull();
		expect(
			within(bot).getByRole("button", { name: "Liên kết Zalo Bot" }),
		).toBeInTheDocument();
		expect(start).not.toHaveBeenCalled();
	});

	it("explains a refused code", async () => {
		const client = unlinkedDemo();
		vi.spyOn(client, "startBotLink").mockRejectedValue(
			new RestError(400, "55000"),
		);
		renderTeam({ path: TEAM_PATHS.notifications, client });
		const bot = await screenReady("notify-bot");
		fireEvent.click(
			await within(bot).findByRole("button", { name: "Liên kết Zalo Bot" }),
		);
		fireEvent.click(
			within(bot).getByRole("button", { name: "Tạo mã liên kết" }),
		);
		expect(await within(bot).findByTestId("bot-failed")).toHaveTextContent(
			"Bạn đã tạo 5 mã trong một giờ.",
		);
		expect(within(bot).queryByTestId("link-code")).toBeNull();
		expect(within(bot).getByTestId("bot-notice")).toBeInTheDocument();
	});

	it("mutes and unmutes a kind of message on the member's own destination", async () => {
		const client = linkedDemo();
		const mute = vi.spyOn(client, "setMutedRules");
		renderTeam({ path: TEAM_PATHS.notifications, client });
		const group = await screenReady("mute-destination");
		expect(group).toHaveTextContent("Zalo Bot …3f7a");
		const boxes = within(group).getAllByRole("checkbox");
		expect(
			boxes.map((box) => box.closest("label")?.textContent?.trim()),
		).toEqual([
			"Số liệu cửa hàng chưa cập nhật",
			"Checklist chưa xong",
			"Bản tin hằng ngày cho nhân viên",
		]);
		expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
		const checklist = within(group).getByTestId("mute-checklist_unfinished");
		// the switches stay disabled until the member's rules have loaded; on a loaded CI runner that can follow the
		// first paint, and a click on a disabled checkbox does nothing
		await waitFor(() => expect(checklist).toBeEnabled());
		fireEvent.click(checklist);
		expect(checklist).not.toBeChecked();
		await waitFor(() =>
			expect(mute).toHaveBeenCalledWith(expect.any(String), [
				"checklist_unfinished",
			]),
		);
		expect(await screen.findByTestId("destination-muted")).toHaveTextContent(
			"Đã tắt 1 loại tin ở nơi nhận này.",
		);
		fireEvent.click(within(group).getByTestId("mute-checklist_unfinished"));
		await waitFor(() =>
			expect(mute).toHaveBeenLastCalledWith(expect.any(String), []),
		);
		await waitFor(() =>
			expect(screen.queryByTestId("destination-muted")).toBeNull(),
		);
		expect(
			within(group).getByTestId("mute-checklist_unfinished"),
		).toBeChecked();
	});

	it("puts a refused mute back as it was", async () => {
		const client = linkedDemo();
		vi.spyOn(client, "setMutedRules").mockRejectedValue(
			new RestError(403, "42501"),
		);
		renderTeam({ path: TEAM_PATHS.notifications, client });
		const group = await screenReady("mute-destination");
		fireEvent.click(within(group).getByTestId("mute-staff_sync_stale"));
		expect(await within(group).findByTestId("mute-failed")).toHaveTextContent(
			"Bạn không có quyền làm việc này",
		);
		expect(within(group).getByTestId("mute-staff_sync_stale")).toBeChecked();
	});

	it("stops every notification only after the confirm step, and says the staff app is unaffected", async () => {
		const client = linkedDemo();
		const stop = vi.spyOn(client, "stopNotifications");
		renderTeam({ path: TEAM_PATHS.notifications, client });
		const panel = await screenReady("notify-stop");
		expect(within(panel).getByTestId("stop-staff-ops")).toHaveTextContent(
			"Dừng nhận thông báo không ảnh hưởng đến việc bạn dùng ứng dụng nhân viên.",
		);
		fireEvent.click(
			await within(panel).findByRole("button", {
				name: "Dừng nhận thông báo",
			}),
		);
		const confirm = within(panel).getByTestId("stop-confirm");
		expect(confirm).toHaveTextContent("Dừng nhận mọi thông báo?");
		expect(stop).not.toHaveBeenCalled();
		fireEvent.click(
			within(confirm).getByRole("button", { name: "Không dừng" }),
		);
		expect(within(panel).queryByTestId("stop-confirm")).toBeNull();
		expect(stop).not.toHaveBeenCalled();
		fireEvent.click(
			within(panel).getByRole("button", { name: "Dừng nhận thông báo" }),
		);
		fireEvent.click(
			within(within(panel).getByTestId("stop-confirm")).getByRole("button", {
				name: "Dừng nhận",
			}),
		);
		const done = await within(panel).findByTestId("stop-done");
		expect(stop).toHaveBeenCalledWith(SAMPLE_TENANT_ID);
		expect(done).toHaveTextContent("Đã dừng nhận thông báo.");
		expect(done).toHaveTextContent("Đã hủy 1 tin đang chờ gửi.");
		await waitFor(() =>
			expect(screen.getByTestId("destination-state")).toHaveTextContent(
				"Đã dừng",
			),
		);
		expect(screen.getByTestId("destination-reason")).toHaveTextContent(
			"Bạn đã dừng nhận thông báo.",
		);
		expect(screen.getByTestId("consent-state")).toHaveTextContent(
			"Bạn đã dừng nhận thông báo lúc",
		);
		expect(
			within(screen.getByTestId("notify-bot")).getByRole("button", {
				name: "Liên kết Zalo Bot",
			}),
		).toBeInTheDocument();
		expect(within(panel).getByTestId("stop-staff-ops")).toBeInTheDocument();
	});

	it("asks to follow the OA only after its purpose line, and only on a tap", async () => {
		renderTeam({ path: TEAM_PATHS.notifications });
		const follow = await screenReady("notify-follow");
		const purpose = await within(follow).findByTestId("follow-purpose");
		expect(purpose).toHaveTextContent(
			"Theo dõi OA để nhận tin vận hành ngay trong Zalo.",
		);
		const button = within(follow).getByRole("button", { name: "Theo dõi OA" });
		expect(
			purpose.compareDocumentPosition(button) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(mockSdkCalls().filter((call) => call.api === "followOA")).toEqual(
			[],
		);
		fireEvent.click(button);
		expect(await within(follow).findByTestId("follow-done")).toHaveTextContent(
			"Bạn đã theo dõi OA.",
		);
		expect(mockSdkCalls().filter((call) => call.api === "followOA")).toEqual([
			expect.objectContaining({ args: { id: DEMO_OA_ID } }),
		]);
	});

	it("changes nothing else when the follow is refused", async () => {
		window.history.replaceState(null, "", "/?follow=refused");
		renderTeam({ path: TEAM_PATHS.notifications });
		const follow = await screenReady("notify-follow");
		fireEvent.click(
			await within(follow).findByRole("button", { name: "Theo dõi OA" }),
		);
		expect(
			await within(follow).findByTestId("follow-refused"),
		).toHaveTextContent("Bạn chưa theo dõi OA.");
		expect(
			within(follow).getByRole("button", { name: "Theo dõi OA" }),
		).toBeEnabled();
		expect(screen.getAllByTestId("destination")).toHaveLength(1);
		expect(screen.getByTestId("destination-state")).toHaveTextContent(
			"Đang nhận",
		);
		expect(screen.getByTestId("consent-state").dataset.state).toBe("active");
	});
});

describe("Nhận thông báo in live mode", () => {
	function renderLive(rest: FakeRest): TeamClient {
		const client = createRestTeamClient(rest);
		renderTeam({ path: TEAM_PATHS.notifications, client });
		return client;
	}

	it("reads the member's settings and the brand's OA through the member functions only", async () => {
		const rest = liveRest();
		renderLive(rest);
		const list = await screenReady("destination-list");
		const items = within(list).getAllByTestId("destination");
		expect(items.map((item) => item.dataset.state)).toEqual([
			"waiting",
			"receiving",
			"waiting",
		]);
		expect(items[0]).toHaveTextContent(
			"Trả lời ĐỒNG Ý trong khung chat với Bot",
		);
		expect(
			within(items[2] as HTMLElement).getByTestId("destination-waiting"),
		).toHaveTextContent(
			"Mã liên kết đã hết hạn. Tạo mã mới ở mục Liên kết Zalo Bot.",
		);
		expect(
			within(items[1] as HTMLElement).getByTestId("destination-muted"),
		).toHaveTextContent("Đã tắt 2 loại tin ở nơi nhận này.");
		const follow = screen.getByTestId("notify-follow");
		fireEvent.click(
			await within(follow).findByRole("button", { name: "Theo dõi OA" }),
		);
		await within(follow).findByTestId("follow-done");
		expect(mockSdkCalls().filter((call) => call.api === "followOA")).toEqual([
			expect.objectContaining({ args: { id: "synthetic-oa-live" } }),
		]);
		expect(rest.selects).toEqual([]);
		expect(
			rest.calls.filter((call) => call.fn === NOTIFY_FUNCTIONS.settings)[0],
		).toEqual({
			fn: "my_notifications",
			args: { p_tenant_id: SAMPLE_TENANT_ID },
		});
		expect(
			rest.calls.find((call) => call.fn === NOTIFY_FUNCTIONS.followTarget),
		).toEqual({ fn: "my_follow_oa", args: { p_tenant_id: SAMPLE_TENANT_ID } });
	});

	it("labels a rule the app does not know by its category and mutes through the function", async () => {
		const rest = liveRest();
		renderLive(rest);
		const groups = await screen.findAllByTestId("mute-destination");
		const mail = groups.find((group) => group.dataset.destination === "c2");
		expect(mail).toBeDefined();
		const later = within(mail as HTMLElement).getByTestId(
			"mute-a_rule_added_later",
		);
		expect(later.closest("label")).toHaveTextContent(
			"Cảnh báo kinh doanh khác",
		);
		expect(later).not.toBeChecked();
		fireEvent.click(later);
		await waitFor(() =>
			expect(
				rest.calls.find((call) => call.fn === NOTIFY_FUNCTIONS.setMutedRules),
			).toEqual({
				fn: "set_my_muted_rules",
				args: { p_channel_id: "c2", p_muted_rules: ["checklist_unfinished"] },
			}),
		);
	});

	it("stops through the function and tells an already linked Bot apart", async () => {
		const rest = liveRest();
		renderLive(rest);
		const bot = await screenReady("notify-bot");
		fireEvent.click(
			await within(bot).findByRole("button", { name: "Liên kết Zalo Bot" }),
		);
		expect(within(bot).getByTestId("notice-text")).toHaveTextContent(
			"Khi liên kết, Cửa hàng Thật",
		);
		fireEvent.click(
			within(bot).getByRole("button", { name: "Tạo mã liên kết" }),
		);
		expect(await within(bot).findByTestId("bot-failed")).toHaveTextContent(
			"Zalo Bot của bạn đã được liên kết.",
		);
		expect(
			rest.calls.find((call) => call.fn === NOTIFY_FUNCTIONS.startBotLink),
		).toEqual({
			fn: "start_bot_link",
			args: { p_tenant_id: SAMPLE_TENANT_ID, p_notice_version: NOTICE_VERSION },
		});
		const panel = screen.getByTestId("notify-stop");
		fireEvent.click(
			within(panel).getByRole("button", { name: "Dừng nhận thông báo" }),
		);
		fireEvent.click(within(panel).getByRole("button", { name: "Dừng nhận" }));
		expect(await within(panel).findByTestId("stop-done")).toHaveTextContent(
			"Đã hủy 3 tin đang chờ gửi.",
		);
		expect(
			rest.calls.find((call) => call.fn === NOTIFY_FUNCTIONS.stop),
		).toEqual({
			fn: "stop_my_notifications",
			args: { p_tenant_id: SAMPLE_TENANT_ID },
		});
	});

	it("shows the follow step as not ready when the brand has no OA", async () => {
		const rest = fakeRest({
			[NOTIFY_FUNCTIONS.settings]: () => LIVE_SETTINGS,
			[NOTIFY_FUNCTIONS.followTarget]: () => null,
		});
		renderLive(rest);
		expect(await screenReady("follow-not-ready")).toHaveTextContent(
			"Ứng dụng chưa biết OA của cửa hàng.",
		);
	});
});
