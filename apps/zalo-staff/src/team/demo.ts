import { type MemberRole, REFUSAL, RestError } from "@fnb/zalo-mini";
import {
	type Announcement,
	MAX_BODY_LENGTH,
	MAX_TITLE_LENGTH,
	type ReaderRole,
} from "../announcements/contract";
import {
	type Destination,
	type LinkCode,
	type MutableRule,
	NOTICE_VERSION,
	type NotificationConsent,
	type NotificationSettings,
	RULE_KEYS,
} from "../notifications/contract";
import {
	MAX_DETAILS_LENGTH,
	MAX_REFUSAL_LENGTH,
	type OwnRequest,
	type PendingRequest,
	type RequestKind,
} from "../requests/contract";
import { canManage } from "../shift/model";
import { SAMPLE_MEMBER_ID, SAMPLE_OTHER_MEMBER_ID } from "../shift/sample";
import type { TeamClient } from "./client";

export const DEMO_STORE_1 = "00000000-0000-4000-8000-0000000005a1";
export const DEMO_STORE_2 = "00000000-0000-4000-8000-0000000005a2";
export const DEMO_OA_ID = "mock-oa-sample";
export const DEMO_TITLES = {
	pinned: "Lịch vệ sinh máy pha cà phê",
	unread: "Nhắc kiểm kê cuối tháng",
	read: "Đổi giờ mở cửa Cửa hàng Mẫu 2",
	own: "Họp đầu tuần lúc 8 giờ",
} as const;
export const DEMO_LINK_TEXT = "www.vidu-bao-tri.vn";
export const DEMO_MEMBER_NAME = "Thành viên thử";
export const DEMO_TENANT_NAME = "Cửa hàng Mẫu";
export const DEMO_BOT_NAME = "Bot Mẫu";
export const DEMO_LINK_CODES = [
	"FNB-MAUTHU27",
	"FNB-MAUTHU35",
	"FNB-MAUTHU48",
	"FNB-MAUTHU59",
	"FNB-MAUTHU62",
] as const;
export const DEMO_NOTICE_TEMPLATE =
	"Khi liên kết, {tenant} chỉ dùng mã tài khoản Zalo hoặc địa chỉ e-mail đăng nhập của bạn để gửi bản tin số liệu hằng ngày và cảnh báo vận hành. Tin do hệ thống tự động gửi qua Zalo Bot. Việc liên kết là tự nguyện và không ảnh hưởng đến công việc của bạn. Bạn có thể ngừng bất cứ lúc nào trong Cài đặt → Cảnh báo, hoặc nhờ chủ cửa hàng gỡ liên kết. Nhật ký gửi tin được lưu khoảng 13 tháng.";

export function demoNoticeText(tenantName: string): string {
	return DEMO_NOTICE_TEMPLATE.replace("{tenant}", tenantName).normalize("NFC");
}

const MAX_DEMO_DELAY_MS = 10_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LINK_LIFETIME_MS = 15 * MINUTE;
const LINKS_PER_HOUR = 5;

export type DemoNotify = "linked" | "unlinked";

export interface TeamDemoSettings {
	readonly delayMs: number;
	readonly notify?: DemoNotify;
}

export function teamDemoSettingsFrom(search: string): TeamDemoSettings {
	const params = new URLSearchParams(search);
	const delay = Number(params.get("dataDelay") ?? "0");
	return {
		delayMs:
			Number.isInteger(delay) && delay > 0
				? Math.min(delay, MAX_DEMO_DELAY_MS)
				: 0,
		notify: params.get("notify") === "unlinked" ? "unlinked" : "linked",
	};
}

const STAFF_RULES: readonly MutableRule[] = [
	{ key: "staff_sync_stale", category: "sync" },
	{ key: "checklist_unfinished", category: "operations" },
	{ key: "staff_daily_digest", category: "digest" },
];

const MANAGER_RULES: readonly MutableRule[] = [
	{ key: "daily_digest", category: "digest" },
	{ key: "revenue_below_baseline", category: "business" },
	{ key: "zero_sales_open", category: "business" },
	{ key: "cash_count_variance", category: "business" },
	{ key: "staff_sync_stale", category: "sync" },
	{ key: "checklist_unfinished", category: "operations" },
];

const OWNER_RULES: readonly MutableRule[] = [
	{ key: "daily_digest", category: "digest" },
	{ key: "revenue_below_baseline", category: "business" },
	{ key: "zero_sales_open", category: "business" },
	{ key: "sync_failed", category: "sync" },
	{ key: "sync_stale", category: "sync" },
	{ key: "channel_failed", category: "channel" },
	{ key: "cash_count_variance", category: "business" },
];

export function demoRules(role: MemberRole): readonly MutableRule[] {
	switch (role) {
		case "owner":
			return OWNER_RULES;
		case "manager":
			return MANAGER_RULES;
		case "staff":
			return STAFF_RULES;
		default:
			return [];
	}
}

function catalogueOrder(keys: readonly string[]): string[] {
	return RULE_KEYS.filter((key) => keys.includes(key));
}

export const DEMO_KINDS: readonly RequestKind[] = [
	{ key: "mua_hang", label: "Mua hàng cho cửa hàng" },
	{ key: "chenh_lech_tien", label: "Giải trình chênh lệch tiền" },
	{ key: "ngoai_le_checklist", label: "Ngoại lệ checklist" },
	{ key: "khac", label: "Khác" },
];

interface DemoPerson {
	readonly userId: string;
	readonly name: string;
	readonly role: ReaderRole;
	readonly storeIds: readonly string[] | null;
}

const PEOPLE: readonly DemoPerson[] = [
	{
		userId: demoId("d", 1),
		name: "Nhân viên Mẫu An",
		role: "staff",
		storeIds: [DEMO_STORE_1],
	},
	{
		userId: demoId("d", 2),
		name: "Nhân viên Mẫu Bình",
		role: "staff",
		storeIds: [DEMO_STORE_1],
	},
	{
		userId: demoId("d", 3),
		name: "Nhân viên Mẫu Chi",
		role: "staff",
		storeIds: [DEMO_STORE_2],
	},
	{
		userId: demoId("d", 4),
		name: "Nhân viên Mẫu Dũng",
		role: "staff",
		storeIds: [DEMO_STORE_2],
	},
	{
		userId: SAMPLE_OTHER_MEMBER_ID,
		name: "Quản lý Mẫu",
		role: "manager",
		storeIds: null,
	},
];

interface DemoAnnouncement {
	readonly id: string;
	readonly storeIds: readonly string[] | null;
	readonly title: string;
	readonly body: string;
	readonly pinnedUntil: string | null;
	readonly publishedBy: string;
	readonly publishedAt: string;
	readonly recipients: readonly string[];
	readonly reads: Map<string, string>;
}

export interface DemoTeamClient extends TeamClient {
	scopeStores(storeIds: readonly string[]): void;
	announcementIds(): readonly string[];
	readOf(id: string): string | null;
}

export function demoId(kind: string, n: number): string {
	return `00000000-0000-4000-8000-${kind}${String(n).padStart(12 - kind.length, "0")}`;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function refuse(code: string, status = 400): never {
	throw new RestError(status, code);
}

function meets(
	left: readonly string[] | null,
	right: readonly string[] | null,
): boolean {
	if (left === null || right === null) return true;
	return left.some((id) => right.includes(id));
}

export function createDemoTeamClient(options: {
	readonly settings: TeamDemoSettings;
	readonly role: MemberRole;
	readonly clock?: () => Date;
}): DemoTeamClient {
	const clock = options.clock ?? (() => new Date());
	const manager = canManage(options.role);
	const me = SAMPLE_MEMBER_ID;
	let stores: readonly string[] | null = null;
	let sequence = 100;
	const next = (kind: string) => {
		sequence += 1;
		return demoId(kind, sequence);
	};
	const ago = (ms: number) => new Date(clock().getTime() - ms).toISOString();
	const ahead = (ms: number) => new Date(clock().getTime() + ms).toISOString();
	const pause = () =>
		options.settings.delayMs > 0
			? wait(options.settings.delayMs)
			: Promise.resolve();
	const recipientsOf = (
		storeIds: readonly string[] | null,
		author: string,
	): string[] => [
		...PEOPLE.filter(
			(person) => person.userId !== author && meets(person.storeIds, storeIds),
		).map((person) => person.userId),
		...(author === me ? [] : [me]),
	];
	const announcements: DemoAnnouncement[] = [
		{
			id: demoId("e", 1),
			storeIds: null,
			title: DEMO_TITLES.pinned,
			body: `Từ thứ Hai, ca sáng vệ sinh máy pha trước 7 giờ.\nHướng dẫn chi tiết của hãng có tại ${DEMO_LINK_TEXT}, xem trên máy tính ở quầy.\nCa tối kiểm tra lại vòi đánh sữa trước khi đóng cửa.`,
			pinnedUntil: ahead(3 * DAY),
			publishedBy: SAMPLE_OTHER_MEMBER_ID,
			publishedAt: ago(26 * 60 * MINUTE),
			recipients: recipientsOf(null, SAMPLE_OTHER_MEMBER_ID),
			reads: new Map([
				[PEOPLE[0]?.userId ?? "", ago(25 * 60 * MINUTE)],
				[PEOPLE[2]?.userId ?? "", ago(20 * 60 * MINUTE)],
			]),
		},
		{
			id: demoId("e", 2),
			storeIds: [DEMO_STORE_1],
			title: DEMO_TITLES.unread,
			body: "Cuối tháng kiểm kê nguyên liệu sau giờ đóng cửa.\nMỗi ca ghi số lượng còn lại vào sổ kho.",
			pinnedUntil: null,
			publishedBy: SAMPLE_OTHER_MEMBER_ID,
			publishedAt: ago(3 * 60 * MINUTE),
			recipients: recipientsOf([DEMO_STORE_1], SAMPLE_OTHER_MEMBER_ID),
			reads: new Map([[PEOPLE[1]?.userId ?? "", ago(2 * 60 * MINUTE)]]),
		},
		{
			id: demoId("e", 3),
			storeIds: null,
			title: DEMO_TITLES.read,
			body: "Từ tuần sau Cửa hàng Mẫu 2 mở cửa lúc 6 giờ 30.",
			pinnedUntil: null,
			publishedBy: SAMPLE_OTHER_MEMBER_ID,
			publishedAt: ago(2 * DAY),
			recipients: recipientsOf(null, SAMPLE_OTHER_MEMBER_ID),
			reads: new Map([
				[me, ago(2 * DAY - 30 * MINUTE)],
				[PEOPLE[2]?.userId ?? "", ago(2 * DAY - 60 * MINUTE)],
			]),
		},
	];
	if (manager) {
		announcements.push({
			id: demoId("e", 4),
			storeIds: [DEMO_STORE_1],
			title: DEMO_TITLES.own,
			body: "Cả ca sáng họp nhanh 15 phút tại Cửa hàng Mẫu 1.",
			pinnedUntil: null,
			publishedBy: me,
			publishedAt: ago(5 * 60 * MINUTE),
			recipients: recipientsOf([DEMO_STORE_1], me),
			reads: new Map([[PEOPLE[0]?.userId ?? "", ago(4 * 60 * MINUTE)]]),
		});
	}
	const mine: OwnRequest[] = [
		{
			id: demoId("f", 1),
			storeId: DEMO_STORE_1,
			kindKey: "mua_hang",
			kindLabel: "Mua hàng cho cửa hàng",
			details: "Mua thêm 2 hộp ống hút giấy.",
			status: "approved",
			requestedAt: ago(DAY + 3 * 60 * MINUTE),
			decidedAt: ago(DAY + 60 * MINUTE),
			refusalReason: null,
		},
		{
			id: demoId("f", 2),
			storeId: DEMO_STORE_1,
			kindKey: "chenh_lech_tien",
			kindLabel: "Giải trình chênh lệch tiền",
			details: "Ca tối thiếu 20.000 ₫ do thối nhầm cho khách.",
			status: "refused",
			requestedAt: ago(2 * DAY),
			decidedAt: ago(2 * DAY - 2 * 60 * MINUTE),
			refusalReason: "Cần ghi rõ giờ và số hóa đơn.",
		},
	];
	const queue: PendingRequest[] = manager
		? [
				{
					id: demoId("f", 11),
					storeId: DEMO_STORE_1,
					kindKey: "mua_hang",
					kindLabel: "Mua hàng cho cửa hàng",
					details: "Mua 5 kg đá viên vì máy làm đá hỏng.",
					requesterName: "Nhân viên Mẫu An",
					requestedAt: ago(30 * MINUTE),
				},
				{
					id: demoId("f", 12),
					storeId: DEMO_STORE_2,
					kindKey: "ngoai_le_checklist",
					kindLabel: "Ngoại lệ checklist",
					details: "Bỏ qua mục lau kính ngoài trời vì mưa to.",
					requesterName: "Nhân viên Mẫu Chi",
					requestedAt: ago(2 * 60 * MINUTE),
				},
				{
					id: demoId("f", 13),
					storeId: DEMO_STORE_1,
					kindKey: "khac",
					kindLabel: "Khác",
					details: "Xin đổi ca chiều thứ Sáu với bạn Bình.",
					requesterName: "Nhân viên Mẫu Bình",
					requestedAt: ago(5 * 60 * MINUTE),
				},
			]
		: [];
	const unlinked = options.settings.notify === "unlinked";
	let consent: NotificationConsent = unlinked
		? { state: "none", grantedAt: null, revokedAt: null }
		: { state: "active", grantedAt: ago(10 * DAY), revokedAt: null };
	let destinations: Destination[] = unlinked
		? []
		: [
				{
					id: demoId("g", 1),
					kind: "zalo_bot",
					label: "Zalo Bot",
					hint: "…3f7a",
					status: "active",
					paused: false,
					mutedRules: [],
					linkedAt: ago(10 * DAY),
					disabledReason: null,
					linkStage: null,
					linkExpiresAt: null,
				},
			];
	const linkStarts: number[] = [];
	const shownDestination = (destination: Destination): Destination =>
		destination.linkExpiresAt !== null &&
		Date.parse(destination.linkExpiresAt) <= clock().getTime()
			? { ...destination, linkStage: null, linkExpiresAt: null }
			: { ...destination };
	const settingsNow = (): NotificationSettings => {
		const rules = demoRules(options.role);
		const muted = catalogueOrder(
			destinations.flatMap((destination) => destination.mutedRules),
		).filter((key) => !rules.some((rule) => rule.key === key));
		return {
			consent: { ...consent },
			destinations: destinations.map(shownDestination),
			rules: [...rules, ...muted.map((key) => ({ key, category: null }))],
			notice: {
				version: NOTICE_VERSION,
				text: demoNoticeText(DEMO_TENANT_NAME),
			},
			botName: DEMO_BOT_NAME,
		};
	};
	const replaceDestination = (changed: Destination) => {
		destinations = destinations.map((destination) =>
			destination.id === changed.id ? changed : destination,
		);
	};
	const startLink = (noticeVersion: string): LinkCode => {
		if (noticeVersion !== NOTICE_VERSION) refuse(REFUSAL.invalid);
		if (options.role === "publisher") refuse(REFUSAL.notAllowed, 403);
		if (
			destinations.some(
				(destination) =>
					destination.kind === "zalo_bot" &&
					(destination.status === "active" || destination.status === "failing"),
			)
		)
			refuse(REFUSAL.duplicate, 409);
		const now = clock().getTime();
		const recent = linkStarts.filter((at) => at > now - 60 * MINUTE);
		if (recent.length >= LINKS_PER_HOUR) refuse(REFUSAL.state);
		const earlier = destinations.find(
			(destination) => destination.kind === "zalo_bot",
		);
		if (earlier?.disabledReason === "owner_request")
			refuse(REFUSAL.notAllowed, 403);
		const code =
			DEMO_LINK_CODES[linkStarts.length % DEMO_LINK_CODES.length] ??
			DEMO_LINK_CODES[0];
		linkStarts.push(now);
		const expiresAt = new Date(now + LINK_LIFETIME_MS).toISOString();
		const pending: Destination = {
			id: earlier?.id ?? next("g"),
			kind: "zalo_bot",
			label: "Zalo Bot",
			hint: null,
			status: "pending",
			paused: false,
			mutedRules: earlier?.mutedRules ?? [],
			linkedAt: null,
			disabledReason: null,
			linkStage: "code",
			linkExpiresAt: expiresAt,
		};
		if (earlier === undefined) destinations = [...destinations, pending];
		else replaceDestination(pending);
		return {
			channelId: pending.id,
			noticeVersion: NOTICE_VERSION,
			code,
			expiresAt,
			botName: DEMO_BOT_NAME,
		};
	};
	const visible = (storeIds: readonly string[] | null) =>
		meets(storeIds, stores);
	const viewOf = (entry: DemoAnnouncement): Announcement => {
		const pinned =
			entry.pinnedUntil !== null &&
			Date.parse(entry.pinnedUntil) > clock().getTime();
		return {
			id: entry.id,
			storeIds: entry.storeIds,
			title: entry.title,
			body: entry.body,
			pinned,
			pinnedUntil: entry.pinnedUntil,
			publishedBy: entry.publishedBy,
			publishedAt: entry.publishedAt,
			recipient: entry.recipients.includes(me),
			readAt: entry.reads.get(me) ?? null,
		};
	};
	const find = (id: string) => {
		const entry = announcements.find((candidate) => candidate.id === id);
		if (entry === undefined || !visible(entry.storeIds))
			refuse(REFUSAL.notAllowed, 403);
		return entry;
	};
	const self: DemoPerson = {
		userId: me,
		name: DEMO_MEMBER_NAME,
		role: options.role === "owner" ? "owner" : manager ? "manager" : "staff",
		storeIds: null,
	};
	const scopedRecipients = (entry: DemoAnnouncement) =>
		entry.recipients
			.map((userId) =>
				userId === me
					? self
					: PEOPLE.find((person) => person.userId === userId),
			)
			.filter(
				(person): person is DemoPerson =>
					person !== undefined && meets(person.storeIds, stores),
			);
	const managerOnly = () => {
		if (!manager) refuse(REFUSAL.notAllowed, 403);
	};
	return {
		scopeStores(storeIds) {
			stores = [...storeIds];
		},
		announcementIds() {
			return announcements.map((entry) => entry.id);
		},
		readOf(id) {
			return (
				announcements.find((entry) => entry.id === id)?.reads.get(me) ?? null
			);
		},
		async feed(storeId) {
			await pause();
			return announcements
				.filter(
					(entry) =>
						visible(entry.storeIds) &&
						(storeId === null ||
							entry.storeIds === null ||
							entry.storeIds.includes(storeId)),
				)
				.map(viewOf)
				.sort((a, b) =>
					a.pinned === b.pinned
						? b.publishedAt.localeCompare(a.publishedAt)
						: a.pinned
							? -1
							: 1,
				);
		},
		async markRead(id) {
			await pause();
			const entry = find(id);
			const readAt = entry.reads.get(me) ?? clock().toISOString();
			entry.reads.set(me, readAt);
			return { id, readAt };
		},
		async publish(_tenantId, draft) {
			await pause();
			managerOnly();
			const title = draft.title.trim();
			const body = draft.body.trim();
			if (
				title === "" ||
				title.length > MAX_TITLE_LENGTH ||
				body === "" ||
				body.length > MAX_BODY_LENGTH ||
				draft.storeIds.length === 0
			)
				refuse(REFUSAL.invalid);
			if (stores !== null && draft.storeIds.some((id) => !stores?.includes(id)))
				refuse(REFUSAL.notAllowed, 403);
			const entry: DemoAnnouncement = {
				id: next("e"),
				storeIds: [...draft.storeIds],
				title,
				body,
				pinnedUntil: draft.pinnedUntil,
				publishedBy: me,
				publishedAt: clock().toISOString(),
				recipients: recipientsOf(draft.storeIds, me),
				reads: new Map(),
			};
			announcements.push(entry);
			return { id: entry.id, recipients: entry.recipients.length };
		},
		async readRate(id) {
			await pause();
			managerOnly();
			const entry = find(id);
			const people = scopedRecipients(entry);
			const readers = people.filter((person) => entry.reads.has(person.userId));
			const early = readers.filter(
				(person) =>
					Date.parse(entry.reads.get(person.userId) ?? "") <=
					Date.parse(entry.publishedAt) + DAY,
			);
			return {
				recipients: people.length,
				readers: readers.length,
				readersWithin24h: early.length,
				rate:
					people.length === 0
						? null
						: Math.round((readers.length / people.length) * 10_000) / 10_000,
			};
		},
		async readers(id) {
			await pause();
			managerOnly();
			const entry = find(id);
			return scopedRecipients(entry)
				.map((person) => ({
					userId: person.userId,
					name: person.name,
					role: person.role,
					member: true,
					readAt: entry.reads.get(person.userId) ?? null,
				}))
				.sort((a, b) => Number(a.readAt !== null) - Number(b.readAt !== null));
		},
		async kinds() {
			await pause();
			return [...DEMO_KINDS];
		},
		async submit(input) {
			await pause();
			const kind = DEMO_KINDS.find(
				(candidate) => candidate.key === input.kindKey,
			);
			if (kind === undefined) refuse(REFUSAL.invalid);
			if (stores !== null && !stores.includes(input.storeId))
				refuse(REFUSAL.notAllowed, 403);
			const details = input.details.trim();
			if (details === "" || details.length > MAX_DETAILS_LENGTH)
				refuse(REFUSAL.check);
			const request: OwnRequest = {
				id: next("f"),
				storeId: input.storeId,
				kindKey: kind.key,
				kindLabel: kind.label,
				details,
				status: "pending",
				requestedAt: clock().toISOString(),
				decidedAt: null,
				refusalReason: null,
			};
			mine.unshift(request);
			return { id: request.id, status: "pending" };
		},
		async mine() {
			await pause();
			return mine.filter((request) => visible([request.storeId]));
		},
		async queue() {
			await pause();
			return queue.filter((request) => visible([request.storeId]));
		},
		async decide(id, input) {
			await pause();
			managerOnly();
			const index = queue.findIndex((request) => request.id === id);
			if (index < 0) refuse(REFUSAL.state);
			if (input.decision === "refused") {
				const reason = input.reason.trim();
				if (reason === "" || reason.length > MAX_REFUSAL_LENGTH)
					refuse(REFUSAL.invalid);
			}
			queue.splice(index, 1);
			return { id, status: input.decision };
		},
		async notificationSettings() {
			await pause();
			return settingsNow();
		},
		async startBotLink(_tenantId, noticeVersion) {
			await pause();
			return startLink(noticeVersion);
		},
		async setMutedRules(channelId, rules) {
			await pause();
			const destination = destinations.find(
				(candidate) => candidate.id === channelId,
			);
			if (destination === undefined) return refuse(REFUSAL.notAllowed, 403);
			if (rules.some((key) => !(RULE_KEYS as readonly string[]).includes(key)))
				refuse(REFUSAL.invalid);
			const muted = catalogueOrder(rules);
			replaceDestination({ ...destination, mutedRules: muted });
			return muted;
		},
		async stopNotifications() {
			await pause();
			const cancelled = destinations.filter(
				(destination) =>
					destination.status === "active" || destination.status === "failing",
			).length;
			if (consent.state === "active")
				consent = {
					...consent,
					state: "withdrawn",
					revokedAt: clock().toISOString(),
				};
			destinations = destinations
				.filter((destination) => destination.status !== "pending")
				.map((destination) =>
					destination.status === "disabled"
						? destination
						: {
								...destination,
								status: "disabled",
								disabledReason: "consent_withdrawn",
							},
				);
			return cancelled;
		},
		async followTarget() {
			await pause();
			return DEMO_OA_ID;
		},
	};
}
