import { z } from "zod";

export const VOUCHER_CALLBACK_PAYLOAD_VERSION =
	"ipos-crm-callback.fields-2024-06-10.semantics-assumed.1";
export const MAX_CALLBACK_LINES = 300;
export const MAX_LINE_QUANTITY = 10_000;
export const MAX_UNIT_PRICE = 100_000_000;
export const MAX_BILL_AMOUNT = 1_000_000_000;
export const AMOUNT_TOLERANCE = 1;

export interface VoucherCallbackLine {
	readonly item: string;
	readonly quantity: number;
	readonly amount: number;
}

export interface VoucherCallbackRequest {
	readonly payloadVersion: string;
	readonly storeRef: string;
	readonly brandRef: string | null;
	readonly programmeRef: string | null;
	readonly code: string;
	readonly saleRef: string;
	readonly memberPhone: string | null;
	readonly memberAttached: boolean;
	readonly lines: readonly VoucherCallbackLine[];
	readonly billAmount: number;
}

export type VoucherCallbackRefusal = "malformed" | "amount_out_of_range";

export type VoucherCallbackParseResult =
	| {
			readonly ok: true;
			readonly request: VoucherCallbackRequest;
			readonly echo: Readonly<Record<string, unknown>>;
	  }
	| {
			readonly ok: false;
			readonly reason: VoucherCallbackRefusal;
			readonly fields: readonly string[];
			readonly echo: Readonly<Record<string, unknown>> | null;
	  };

export interface VoucherCallbackReply {
	readonly discountAmount: number;
	readonly description: string;
	readonly accepted: boolean;
}

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;
const PHONE = /^(?:\+?84|0)[1-9]\d{8,9}$/;

const reference = z.union([
	z
		.string()
		.transform((value) => value.trim())
		.pipe(
			z
				.string()
				.min(1)
				.max(100)
				.regex(/^[^\p{Cc}]+$/u),
		),
	z
		.number()
		.int()
		.nonnegative()
		.transform((value) => String(value)),
]);

const optionalReference = z
	.union([reference, z.literal(""), z.null()])
	.optional()
	.transform((value) => (value === undefined || value === "" ? null : value));

const quantity = z.union([
	z.number(),
	z
		.string()
		.regex(NUMERIC_TEXT)
		.transform((value) => Number(value)),
]);

const optionalAmount = z
	.union([quantity, z.null()])
	.optional()
	.transform((value) => (value === undefined ? null : value));

const looseText = z
	.union([z.string(), z.number(), z.null()])
	.optional()
	.transform((value) => (value === undefined ? null : value));

export const voucherCallbackLineSchema = z.looseObject({
	Item_Id: reference,
	Item_Type_Id: looseText,
	Description: looseText,
	Quantity: quantity,
	Price_Sale: optionalAmount,
	Amount: quantity,
	Discount: optionalAmount,
	Pr_Key: looseText,
	Detail_State: looseText,
	Package_Id: looseText,
});

export const voucherCallbackPayloadSchema = z.looseObject({
	Pos_Parent: optionalReference,
	Pos_Id: reference,
	Coupon_Code: z
		.string()
		.transform((value) => value.trim())
		.pipe(
			z
				.string()
				.min(1)
				.max(64)
				.regex(/^[^\s\p{Cc}]+$/u),
		),
	Membership_Id: optionalReference,
	Sale_Tran_Id: reference,
	Created_At: looseText,
	Code: looseText,
	Date_Start: looseText,
	Date_End: looseText,
	Voucher_Order_Line: z
		.array(voucherCallbackLineSchema)
		.max(MAX_CALLBACK_LINES),
});

type ParsedLine = z.infer<typeof voucherCallbackLineSchema>;

function fieldPaths(error: z.ZodError): string[] {
	const paths = error.issues.map((issue) =>
		issue.path
			.map((part) => (typeof part === "number" ? "[]" : String(part)))
			.join(".")
			.replace(/\.\[\]/g, "[]"),
	);
	return [...new Set(paths.filter((path) => path !== ""))].sort();
}

function lineInRange(line: ParsedLine): boolean {
	const discount = line.Discount ?? 0;
	if (
		!Number.isFinite(line.Quantity) ||
		!Number.isFinite(line.Amount) ||
		!Number.isFinite(discount) ||
		line.Quantity <= 0 ||
		line.Quantity > MAX_LINE_QUANTITY ||
		line.Amount < 0 ||
		discount < 0 ||
		discount > line.Amount + AMOUNT_TOLERANCE
	) {
		return false;
	}
	if (line.Price_Sale !== null) {
		if (
			!Number.isFinite(line.Price_Sale) ||
			line.Price_Sale < 0 ||
			line.Price_Sale > MAX_UNIT_PRICE ||
			line.Amount > line.Price_Sale * line.Quantity + AMOUNT_TOLERANCE
		) {
			return false;
		}
	}
	return true;
}

function netAmount(line: ParsedLine): number {
	return Math.max(0, Math.round(line.Amount - (line.Discount ?? 0)));
}

function memberPhone(memberRef: string | null): string | null {
	if (memberRef === null) {
		return null;
	}
	const compact = memberRef.replace(/[\s().-]/g, "");
	return PHONE.test(compact) ? compact : null;
}

function asRecord(body: unknown): Readonly<Record<string, unknown>> | null {
	return body !== null && typeof body === "object" && !Array.isArray(body)
		? (body as Record<string, unknown>)
		: null;
}

export function parseVoucherCallback(
	body: unknown,
): VoucherCallbackParseResult {
	const echo = asRecord(body);
	const parsed = voucherCallbackPayloadSchema.safeParse(body);
	if (!parsed.success) {
		return {
			ok: false,
			reason: "malformed",
			fields: fieldPaths(parsed.error),
			echo,
		};
	}
	const payload = parsed.data;
	const outOfRange = payload.Voucher_Order_Line.flatMap((line, index) =>
		lineInRange(line) ? [] : [`Voucher_Order_Line[${index}]`],
	);
	const lines = payload.Voucher_Order_Line.map((line) => ({
		item: line.Item_Id,
		quantity: line.Quantity,
		amount: netAmount(line),
	}));
	const billAmount = lines.reduce((total, line) => total + line.amount, 0);
	if (outOfRange.length > 0 || billAmount > MAX_BILL_AMOUNT) {
		return {
			ok: false,
			reason: "amount_out_of_range",
			fields: outOfRange.length > 0 ? outOfRange : ["Voucher_Order_Line"],
			echo,
		};
	}
	return {
		ok: true,
		echo: echo ?? {},
		request: {
			payloadVersion: VOUCHER_CALLBACK_PAYLOAD_VERSION,
			storeRef: payload.Pos_Id,
			brandRef: payload.Pos_Parent,
			programmeRef: null,
			code: payload.Coupon_Code,
			saleRef: payload.Sale_Tran_Id,
			memberPhone: memberPhone(payload.Membership_Id),
			memberAttached: payload.Membership_Id !== null,
			lines,
			billAmount,
		},
	};
}

export function voucherCallbackResponse(
	echo: Readonly<Record<string, unknown>> | null,
	reply: VoucherCallbackReply,
): Record<string, unknown> {
	return {
		...(echo ?? {}),
		Discount_Amount: Math.max(0, Math.floor(reply.discountAmount)),
		Discount_Description: reply.description,
	};
}
