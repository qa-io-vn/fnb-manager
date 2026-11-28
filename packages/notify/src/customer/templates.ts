export const CUSTOMER_MESSAGE_KINDS = [
	"points_confirmed",
	"coupon_issued",
	"voucher_expiring",
	"expiry_reminder",
	"birthday",
	"win_back",
	"takeaway_ready",
] as const;

export type CustomerMessageKind = (typeof CUSTOMER_MESSAGE_KINDS)[number];

export const ZBS_TEMPLATE_PURPOSES = [
	"points_confirmation",
	"coupon_issued",
	"voucher",
	"expiry_reminder",
	"birthday",
	"win_back",
	"order_ready",
] as const;

export type ZbsTemplatePurpose = (typeof ZBS_TEMPLATE_PURPOSES)[number];

export type ZbsTemplateTag = "transaction" | "customer_care" | "promotion";

export const TEMPLATE_PARAMETER_NAMES = [
	"customer_name",
	"points",
	"stamps",
	"bill_no",
	"store_name",
	"reward_name",
	"voucher_code",
	"expires_at",
	"inactive_days",
	"order_no",
	"pickup_time",
] as const;

export type TemplateParameterName = (typeof TEMPLATE_PARAMETER_NAMES)[number];

export type TemplateParameterType = "name" | "number" | "text" | "code";

export interface TemplateParameter {
	readonly name: TemplateParameterName;
	readonly type: TemplateParameterType;
	readonly maxLength: number;
	readonly sample: string;
}

export interface ZbsTemplateDraft {
	readonly purpose: ZbsTemplatePurpose;
	readonly tag: ZbsTemplateTag;
	readonly layout: "text" | "voucher";
	readonly title: string;
	readonly body: string;
	readonly button: string;
	readonly parameters: readonly TemplateParameter[];
	readonly reviewerDecision: boolean;
}

const NAME: TemplateParameter = {
	name: "customer_name",
	type: "name",
	maxLength: 30,
	sample: "Nguyễn Văn An",
};
const POINTS: TemplateParameter = {
	name: "points",
	type: "number",
	maxLength: 10,
	sample: "6",
};
const STAMPS: TemplateParameter = {
	name: "stamps",
	type: "number",
	maxLength: 10,
	sample: "1",
};
const BILL: TemplateParameter = {
	name: "bill_no",
	type: "code",
	maxLength: 30,
	sample: "001234",
};
const STORE: TemplateParameter = {
	name: "store_name",
	type: "text",
	maxLength: 60,
	sample: "Cửa hàng 1",
};
const REWARD: TemplateParameter = {
	name: "reward_name",
	type: "text",
	maxLength: 60,
	sample: "Một ly nước miễn phí",
};
const CODE: TemplateParameter = {
	name: "voucher_code",
	type: "code",
	maxLength: 30,
	sample: "AB12CD34",
};
const EXPIRES: TemplateParameter = {
	name: "expires_at",
	type: "text",
	maxLength: 30,
	sample: "21:00 20/11/2026",
};
const ORDER_NO: TemplateParameter = {
	name: "order_no",
	type: "code",
	maxLength: 10,
	sample: "#007",
};
const PICKUP: TemplateParameter = {
	name: "pickup_time",
	type: "text",
	maxLength: 5,
	sample: "15:30",
};
const INACTIVE: TemplateParameter = {
	name: "inactive_days",
	type: "number",
	maxLength: 5,
	sample: "45",
};

export const ZBS_TEMPLATE_DRAFTS: Readonly<
	Record<ZbsTemplatePurpose, ZbsTemplateDraft>
> = {
	points_confirmation: {
		purpose: "points_confirmation",
		tag: "customer_care",
		layout: "text",
		title: "Xác nhận tích điểm",
		body: "Chào <customer_name>, hóa đơn <bill_no> tại <store_name> đã được ghi nhận. Bạn vừa nhận <points> điểm và <stamps> dấu. Mở ứng dụng thành viên để xem số dư và ưu đãi của bạn.",
		button: "Xem điểm",
		parameters: [NAME, BILL, STORE, POINTS, STAMPS],
		reviewerDecision: false,
	},
	coupon_issued: {
		purpose: "coupon_issued",
		tag: "customer_care",
		layout: "text",
		title: "Ưu đãi đã sẵn sàng",
		body: "Chào <customer_name>, bạn đã đổi thành công <reward_name>. Ưu đãi được giữ cho bạn đến <expires_at>. Mở ứng dụng thành viên và đưa mã cho thu ngân khi thanh toán.",
		button: "Xem ưu đãi",
		parameters: [NAME, REWARD, EXPIRES],
		reviewerDecision: false,
	},
	voucher: {
		purpose: "voucher",
		tag: "transaction",
		layout: "voucher",
		title: "Mã ưu đãi của bạn",
		body: "Chào <customer_name>, đây là mã <voucher_code> cho ưu đãi <reward_name>. Đưa mã cho thu ngân trước khi thanh toán. Mã dùng một lần và hết hạn lúc <expires_at>.",
		button: "Mở ví ưu đãi",
		parameters: [NAME, CODE, REWARD, EXPIRES],
		reviewerDecision: false,
	},
	expiry_reminder: {
		purpose: "expiry_reminder",
		tag: "customer_care",
		layout: "text",
		title: "Nhắc hạn điểm",
		body: "Chào <customer_name>, bạn có <points> điểm và <stamps> dấu sẽ hết hạn vào ngày <expires_at>. Mở ứng dụng thành viên để đổi ưu đãi trước khi hết hạn.",
		button: "Đổi ưu đãi",
		parameters: [NAME, POINTS, STAMPS, EXPIRES],
		reviewerDecision: false,
	},
	birthday: {
		purpose: "birthday",
		tag: "customer_care",
		layout: "text",
		title: "Chúc mừng sinh nhật",
		body: "Chào <customer_name>, chúc bạn một sinh nhật thật vui. Mở ứng dụng thành viên để xem món quà dành riêng cho bạn.",
		button: "Xem quà",
		parameters: [NAME],
		reviewerDecision: true,
	},
	win_back: {
		purpose: "win_back",
		tag: "customer_care",
		layout: "text",
		title: "Lâu rồi chưa gặp bạn",
		body: "Chào <customer_name>, đã <inactive_days> ngày bạn chưa ghé quán. Mở ứng dụng thành viên để xem ưu đãi đang chờ bạn.",
		button: "Xem ưu đãi",
		parameters: [NAME, INACTIVE],
		reviewerDecision: true,
	},
	order_ready: {
		purpose: "order_ready",
		tag: "transaction",
		layout: "text",
		title: "Món mang đi đã xong",
		body: "Chào <customer_name>, đơn <order_no> tại <store_name> đã xong, hẹn lấy lúc <pickup_time>. Mời bạn ra quầy nhận món.",
		button: "Xem đơn",
		parameters: [NAME, ORDER_NO, STORE, PICKUP],
		reviewerDecision: false,
	},
};

export const KIND_TEMPLATE_PURPOSES: Readonly<
	Record<CustomerMessageKind, readonly ZbsTemplatePurpose[]>
> = {
	points_confirmed: ["points_confirmation"],
	coupon_issued: ["voucher", "coupon_issued"],
	voucher_expiring: ["voucher"],
	expiry_reminder: ["expiry_reminder"],
	birthday: ["birthday"],
	win_back: ["win_back"],
	takeaway_ready: ["order_ready"],
};

export const CONSULTATION_TEXTS: Readonly<
	Record<
		| "points_confirmed"
		| "coupon_issued"
		| "voucher_expiring"
		| "expiry_reminder"
		| "takeaway_ready",
		string
	>
> = {
	points_confirmed: ZBS_TEMPLATE_DRAFTS.points_confirmation.body,
	coupon_issued: ZBS_TEMPLATE_DRAFTS.voucher.body,
	voucher_expiring:
		"Chào <customer_name>, ưu đãi <reward_name> với mã <voucher_code> sẽ hết hạn lúc <expires_at>. Hãy dùng trước khi hết hạn nhé.",
	expiry_reminder: ZBS_TEMPLATE_DRAFTS.expiry_reminder.body,
	takeaway_ready: ZBS_TEMPLATE_DRAFTS.order_ready.body,
};

export const NAME_FALLBACK = "Quý khách";

const PLACEHOLDER = /<([a-z_]+)>/g;

export function placeholdersOf(text: string): string[] {
	return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

export function isCustomerMessageKind(
	value: string,
): value is CustomerMessageKind {
	return (CUSTOMER_MESSAGE_KINDS as readonly string[]).includes(value);
}

export function isZbsTemplatePurpose(
	value: string,
): value is ZbsTemplatePurpose {
	return (ZBS_TEMPLATE_PURPOSES as readonly string[]).includes(value);
}

export class TemplateParameterError extends Error {
	readonly parameter: string;

	constructor(parameter: string) {
		super(`the template parameter ${parameter} has no value`);
		this.name = "TemplateParameterError";
		this.parameter = parameter;
	}
}

export type ResolvedParameters = Readonly<Record<string, unknown>>;

function numberText(value: number): string {
	return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(
		value,
	);
}

function clip(text: string, maxLength: number): string {
	const characters = [...text.replace(/\s+/g, " ").trim()];
	return characters.length <= maxLength
		? characters.join("")
		: `${characters.slice(0, maxLength - 1).join("")}…`;
}

export function parameterValue(
	parameter: TemplateParameter,
	resolved: ResolvedParameters,
): string {
	const raw = resolved[parameter.name];
	if (parameter.type === "name") {
		return typeof raw === "string" && raw.trim() !== ""
			? clip(raw, parameter.maxLength)
			: NAME_FALLBACK;
	}
	if (parameter.type === "number") {
		const value =
			typeof raw === "number"
				? raw
				: typeof raw === "string" && /^-?\d+$/.test(raw)
					? Number(raw)
					: 0;
		return numberText(Math.max(0, Math.trunc(value)));
	}
	if (typeof raw !== "string" || raw.trim() === "") {
		throw new TemplateParameterError(parameter.name);
	}
	return clip(raw, parameter.maxLength);
}

export function templateData(
	purpose: ZbsTemplatePurpose,
	resolved: ResolvedParameters,
): Record<string, string> {
	const draft = ZBS_TEMPLATE_DRAFTS[purpose];
	return Object.fromEntries(
		draft.parameters.map((parameter) => [
			parameter.name,
			parameterValue(parameter, resolved),
		]),
	);
}

const PARAMETER_BY_NAME: ReadonlyMap<string, TemplateParameter> = new Map(
	Object.values(ZBS_TEMPLATE_DRAFTS)
		.flatMap((draft) => draft.parameters)
		.map((parameter) => [parameter.name, parameter]),
);

export function fillPlaceholders(
	text: string,
	resolved: ResolvedParameters,
): string {
	return text.replace(PLACEHOLDER, (_match, name: string) => {
		const parameter = PARAMETER_BY_NAME.get(name);
		if (parameter === undefined) {
			throw new TemplateParameterError(name);
		}
		return parameterValue(parameter, resolved);
	});
}

export function consultationText(
	kind: CustomerMessageKind,
	resolved: ResolvedParameters,
): string {
	if (kind === "birthday" || kind === "win_back") {
		throw new TemplateParameterError(kind);
	}
	return fillPlaceholders(CONSULTATION_TEXTS[kind], resolved);
}
