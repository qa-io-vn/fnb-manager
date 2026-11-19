import { hex } from "../proof.js";

export const OA_MENU_ACTIONS = [
	"join",
	"points",
	"vouchers",
	"open_app",
] as const;
export type OaMenuAction = (typeof OA_MENU_ACTIONS)[number];

export const OA_BUTTON_TARGETS = ["mini_app", "query"] as const;
export type OaButtonTarget = (typeof OA_BUTTON_TARGETS)[number];

export const OA_MENU_MAX_BUTTONS = 5;
export const OA_BUTTON_LABEL_MAX_LENGTH = 30;
export const OA_LINK_SOURCE = "oa";
export const ZALO_MINI_APP_LINK_BASE = "https://zalo.me/s/";

export const OA_KEYWORDS: Readonly<Record<OaMenuAction, string>> = {
	join: "#join",
	points: "#points",
	vouchers: "#vouchers",
	open_app: "#app",
};

export const MINI_APP_PATHS: Readonly<Record<OaMenuAction, string>> = {
	join: "tham-gia",
	points: "the-thanh-vien",
	vouchers: "vi-voucher",
	open_app: "",
};

const MINI_APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL_PATTERN = /\p{Cc}/u;
const LINK_PATTERN = /(https?:\/\/|www\.|zalo\.me)/i;
const PHONE_SEPARATORS = /[\s.()+-]/g;
const PHONE_LIKE_PATTERN = /[0-9]{8,}/;

export interface OaMenuButton {
	readonly action: OaMenuAction;
	readonly label: string;
	readonly target: OaButtonTarget;
}

export type ZaloButton =
	| {
			readonly title: string;
			readonly type: "oa.open.url";
			readonly payload: { readonly url: string };
	  }
	| {
			readonly title: string;
			readonly type: "oa.query.hide";
			readonly payload: string;
	  };

export class OaConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OaConfigError";
	}
}

export function oaTextValid(value: unknown, maxLength: number): boolean {
	if (typeof value !== "string") {
		return false;
	}
	const length = [...value].length;
	return (
		length >= 1 &&
		length <= maxLength &&
		value === value.trim() &&
		!CONTROL_PATTERN.test(value.replaceAll("\n", "")) &&
		!LINK_PATTERN.test(value) &&
		!PHONE_LIKE_PATTERN.test(value.replace(PHONE_SEPARATORS, ""))
	);
}

export function oaLabelValid(value: unknown): boolean {
	return (
		oaTextValid(value, OA_BUTTON_LABEL_MAX_LENGTH) &&
		typeof value === "string" &&
		!CONTROL_PATTERN.test(value)
	);
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isAction(value: unknown): value is OaMenuAction {
	return OA_MENU_ACTIONS.some((action) => action === value);
}

function isTarget(value: unknown): value is OaButtonTarget {
	return OA_BUTTON_TARGETS.some((target) => target === value);
}

export function parseMenuButtons(value: unknown): OaMenuButton[] {
	if (!Array.isArray(value)) {
		throw new OaConfigError("the menu buttons are a list");
	}
	if (value.length < 1 || value.length > OA_MENU_MAX_BUTTONS) {
		throw new OaConfigError(
			`the menu holds 1 to ${OA_MENU_MAX_BUTTONS} buttons`,
		);
	}
	const seen = new Set<OaMenuAction>();
	return value.map((entry, index) => {
		const record = recordOf(entry);
		const position = `button ${index + 1}`;
		if (record === null) {
			throw new OaConfigError(`${position} is not an object`);
		}
		const extra = Object.keys(record).filter(
			(key) => key !== "action" && key !== "label" && key !== "target",
		);
		if (extra.length > 0) {
			throw new OaConfigError(
				`${position} has fields other than action, label and target`,
			);
		}
		const { action, label, target } = record;
		if (!isAction(action)) {
			throw new OaConfigError(
				`${position}: action is one of ${OA_MENU_ACTIONS.join(", ")}`,
			);
		}
		if (seen.has(action)) {
			throw new OaConfigError(`${position}: ${action} appears twice`);
		}
		seen.add(action);
		if (!isTarget(target)) {
			throw new OaConfigError(`${position}: target is mini_app or query`);
		}
		if (target === "query" && action !== "join") {
			throw new OaConfigError(
				`${position}: only the join button may be an OA query; ${action} opens the Mini App`,
			);
		}
		if (!oaLabelValid(label) || typeof label !== "string") {
			throw new OaConfigError(
				`${position}: the label is 1 to ${OA_BUTTON_LABEL_MAX_LENGTH} characters on one line, without a link or a phone number`,
			);
		}
		return { action, label, target };
	});
}

export function miniAppDeepLink(
	miniAppId: string,
	action: OaMenuAction,
): string {
	if (!MINI_APP_ID_PATTERN.test(miniAppId)) {
		throw new OaConfigError("a Mini App id is 1 to 64 letters, digits, - or _");
	}
	return `${ZALO_MINI_APP_LINK_BASE}${miniAppId}/${MINI_APP_PATHS[action]}?src=${OA_LINK_SOURCE}`;
}

export function zaloButton(
	button: OaMenuButton,
	miniAppId: string | null,
): ZaloButton | null {
	if (button.target === "query") {
		return {
			title: button.label,
			type: "oa.query.hide",
			payload: OA_KEYWORDS[button.action],
		};
	}
	if (miniAppId === null) {
		return null;
	}
	return {
		title: button.label,
		type: "oa.open.url",
		payload: { url: miniAppDeepLink(miniAppId, button.action) },
	};
}

export function zaloButtons(
	buttons: readonly OaMenuButton[],
	miniAppId: string | null,
): ZaloButton[] {
	return buttons
		.map((button) => zaloButton(button, miniAppId))
		.filter((button): button is ZaloButton => button !== null);
}

export function needsMiniApp(buttons: readonly OaMenuButton[]): boolean {
	return buttons.some((button) => button.target === "mini_app");
}

export function keywordAction(text: unknown): OaMenuAction | null {
	if (typeof text !== "string") {
		return null;
	}
	const keyword = text.trim().toLowerCase();
	return (
		OA_MENU_ACTIONS.find((action) => OA_KEYWORDS[action] === keyword) ?? null
	);
}

export function parseZaloButtons(value: unknown): ZaloButton[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const buttons: ZaloButton[] = [];
	for (const entry of value) {
		const record = recordOf(entry);
		const title = record?.title;
		if (record === null || typeof title !== "string") {
			return null;
		}
		if (record.type === "oa.query.hide" && typeof record.payload === "string") {
			buttons.push({ title, type: "oa.query.hide", payload: record.payload });
			continue;
		}
		const url = recordOf(record.payload)?.url;
		if (record.type === "oa.open.url" && typeof url === "string") {
			buttons.push({ title, type: "oa.open.url", payload: { url } });
			continue;
		}
		return null;
	}
	return buttons;
}

export function buttonTarget(button: ZaloButton): string {
	return button.type === "oa.open.url"
		? button.payload.url
		: `keyword ${button.payload}`;
}

export async function menuDigest(
	buttons: readonly ZaloButton[],
): Promise<string> {
	return hex(
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(JSON.stringify(buttons)),
		),
	);
}

export type MenuChange =
	| {
			readonly kind: "same";
			readonly position: number;
			readonly button: ZaloButton;
	  }
	| {
			readonly kind: "added";
			readonly position: number;
			readonly button: ZaloButton;
	  }
	| {
			readonly kind: "removed";
			readonly position: number;
			readonly button: ZaloButton;
	  }
	| {
			readonly kind: "changed";
			readonly position: number;
			readonly before: ZaloButton;
			readonly button: ZaloButton;
	  };

function sameButton(left: ZaloButton, right: ZaloButton): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function menuDiff(
	applied: readonly ZaloButton[] | null,
	configured: readonly ZaloButton[],
): MenuChange[] {
	const before = applied ?? [];
	const length = Math.max(before.length, configured.length);
	const changes: MenuChange[] = [];
	for (let index = 0; index < length; index += 1) {
		const old = before[index];
		const next = configured[index];
		const position = index + 1;
		if (old === undefined && next !== undefined) {
			changes.push({ kind: "added", position, button: next });
		} else if (old !== undefined && next === undefined) {
			changes.push({ kind: "removed", position, button: old });
		} else if (old !== undefined && next !== undefined) {
			changes.push(
				sameButton(old, next)
					? { kind: "same", position, button: next }
					: { kind: "changed", position, before: old, button: next },
			);
		}
	}
	return changes;
}

export function menuChanged(changes: readonly MenuChange[]): boolean {
	return changes.some((change) => change.kind !== "same");
}

function describe(button: ZaloButton, ci: boolean): string {
	if (ci) {
		return button.type === "oa.open.url" ? "Mini App link" : "OA keyword";
	}
	return `"${button.title}" → ${buttonTarget(button)}`;
}

function changeLine(change: MenuChange, ci: boolean): string {
	const label = `  ${change.position}.`;
	switch (change.kind) {
		case "same":
			return `${label} unchanged ${describe(change.button, ci)}`;
		case "added":
			return `${label} + ${describe(change.button, ci)}`;
		case "removed":
			return `${label} - ${describe(change.button, ci)}`;
		case "changed":
			return `${label} ~ ${describe(change.before, ci)} becomes ${describe(change.button, ci)}`;
	}
}

export function diffLines(
	changes: readonly MenuChange[],
	ci: boolean,
): string[] {
	return changes.map((change) => changeLine(change, ci));
}

export interface OaMenuTexts {
	readonly welcomeEnabled: boolean;
	readonly welcomeText: string;
	readonly joinedText: string;
	readonly memberText: string;
	readonly formTitle: string;
	readonly formSubtitle: string;
	readonly formImageUrl: string | null;
}

export interface OaMenuConfig extends OaMenuTexts {
	readonly buttons: readonly OaMenuButton[];
}

export const OA_MESSAGE_TEXT_MAX_LENGTH = 2000;
export const OA_FORM_TITLE_MAX_LENGTH = 100;
export const OA_FORM_SUBTITLE_MAX_LENGTH = 500;
const IMAGE_URL_PATTERN = /^https:\/\/[^\s]{1,500}$/;

export const DEFAULT_OA_MENU: OaMenuConfig = {
	buttons: [
		{ action: "join", label: "Tham gia thành viên", target: "query" },
		{ action: "points", label: "Điểm của tôi", target: "mini_app" },
		{ action: "vouchers", label: "Voucher của tôi", target: "mini_app" },
		{ action: "open_app", label: "Mở ứng dụng thành viên", target: "mini_app" },
	],
	welcomeEnabled: true,
	welcomeText:
		"Cảm ơn bạn đã quan tâm. Bấm Tham gia thành viên để tích dấu mỗi lần mua hàng; điểm và voucher nằm trong ứng dụng thành viên.",
	joinedText:
		"Bạn đã là thành viên, dấu được tích khi bạn đọc số điện thoại lúc thanh toán. Quán không gửi tin khuyến mãi khi bạn chưa đồng ý; muốn nhận thì bật trong mục Tài khoản của ứng dụng thành viên.",
	memberText:
		"Bạn đã là thành viên. Mở ứng dụng thành viên để xem điểm và voucher.",
	formTitle: "Tham gia chương trình thành viên",
	formSubtitle:
		"Chia sẻ tên và số điện thoại để quán tích dấu cho bạn khi mua hàng, theo chính sách bảo mật của quán. Việc chia sẻ không phải là đồng ý nhận tin khuyến mãi.",
	formImageUrl: null,
};

function textField(
	record: Readonly<Record<string, unknown>>,
	name: string,
	maxLength: number,
	fallback: string,
): string {
	const value = record[name];
	if (value === undefined) {
		return fallback;
	}
	if (!oaTextValid(value, maxLength) || typeof value !== "string") {
		throw new OaConfigError(
			`${name} is 1 to ${maxLength} characters without a link or a phone number`,
		);
	}
	return value;
}

const CONFIG_FIELDS = [
	"buttons",
	"welcome_enabled",
	"welcome_text",
	"joined_text",
	"member_text",
	"form_title",
	"form_subtitle",
	"form_image_url",
] as const;

export function parseMenuConfig(value: unknown): OaMenuConfig {
	const record = recordOf(value);
	if (record === null) {
		throw new OaConfigError("the OA menu file is a JSON object");
	}
	const extra = Object.keys(record).filter(
		(key) => !CONFIG_FIELDS.some((field) => field === key),
	);
	if (extra.length > 0) {
		throw new OaConfigError(
			`the OA menu file has unknown fields: ${extra.join(", ")}`,
		);
	}
	const buttons =
		record.buttons === undefined
			? DEFAULT_OA_MENU.buttons
			: parseMenuButtons(record.buttons);
	const welcomeEnabled =
		record.welcome_enabled ?? DEFAULT_OA_MENU.welcomeEnabled;
	if (typeof welcomeEnabled !== "boolean") {
		throw new OaConfigError("welcome_enabled is true or false");
	}
	const imageUrl = record.form_image_url ?? DEFAULT_OA_MENU.formImageUrl;
	if (
		imageUrl !== null &&
		(typeof imageUrl !== "string" || !IMAGE_URL_PATTERN.test(imageUrl))
	) {
		throw new OaConfigError("form_image_url is an https address of an image");
	}
	if (
		imageUrl === null &&
		buttons.some(
			(button) => button.action === "join" && button.target === "query",
		)
	) {
		throw new OaConfigError(
			"a join button of target query sends Zalo's form, which needs form_image_url",
		);
	}
	return {
		buttons,
		welcomeEnabled,
		welcomeText: textField(
			record,
			"welcome_text",
			OA_MESSAGE_TEXT_MAX_LENGTH,
			DEFAULT_OA_MENU.welcomeText,
		),
		joinedText: textField(
			record,
			"joined_text",
			OA_MESSAGE_TEXT_MAX_LENGTH,
			DEFAULT_OA_MENU.joinedText,
		),
		memberText: textField(
			record,
			"member_text",
			OA_MESSAGE_TEXT_MAX_LENGTH,
			DEFAULT_OA_MENU.memberText,
		),
		formTitle: textField(
			record,
			"form_title",
			OA_FORM_TITLE_MAX_LENGTH,
			DEFAULT_OA_MENU.formTitle,
		),
		formSubtitle: textField(
			record,
			"form_subtitle",
			OA_FORM_SUBTITLE_MAX_LENGTH,
			DEFAULT_OA_MENU.formSubtitle,
		),
		formImageUrl: imageUrl,
	};
}
