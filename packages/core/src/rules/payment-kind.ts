import type { PaymentKind } from "../schemas/enums.js";

export interface PaymentKindRule {
	kind: PaymentKind;
	pattern: RegExp;
}

export interface PaymentKindOptions {
	overrides?: Readonly<Record<string, PaymentKind>>;
	rules?: readonly PaymentKindRule[];
}

const NOT_ALPHANUMERIC_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_ALPHANUMERIC_AFTER = "(?![\\p{L}\\p{N}])";

function words(...terms: string[]): RegExp {
	const alternatives = terms
		.map((term) => `${NOT_ALPHANUMERIC_BEFORE}${term}${NOT_ALPHANUMERIC_AFTER}`)
		.join("|");
	return new RegExp(alternatives, "iu");
}

function anywhere(...terms: string[]): RegExp {
	return new RegExp(terms.join("|"), "iu");
}

export const DEFAULT_PAYMENT_KIND_RULES: readonly PaymentKindRule[] = [
	{ kind: "cash", pattern: anywhere("tiền mặt", "tien mat", "tiền măt") },
	{ kind: "cash", pattern: words("cash", "cod") },
	{
		kind: "ewallet",
		pattern: anywhere(
			"momo",
			"zalopay",
			"zalo pay",
			"vnpay",
			"vn pay",
			"shopeepay",
			"shopee pay",
			"viettel ?money",
			"e-?wallet",
			"ví điện tử",
		),
	},
	{
		kind: "bank_transfer",
		pattern: anywhere(
			"transfer",
			"chuyển khoản",
			"chuyen khoan",
			"bank",
			"ngân hàng",
		),
	},
	{ kind: "bank_transfer", pattern: words("ck") },
	{
		kind: "card",
		pattern: anywhere("visa", "master", "mastercard", "jcb", "amex", "napas"),
	},
	{ kind: "card", pattern: words("card", "thẻ", "atm", "pos") },
	{ kind: "voucher", pattern: anywhere("voucher", "gift ?card", "phiếu") },
];

function normalise(name: string): string {
	return name.normalize("NFC").trim().toLocaleLowerCase("vi");
}

export function classifyPaymentKind(
	name: string,
	options: PaymentKindOptions = {},
): PaymentKind {
	const normalised = normalise(name);
	for (const [override, kind] of Object.entries(options.overrides ?? {})) {
		if (normalise(override) === normalised) {
			return kind;
		}
	}
	const rules = options.rules ?? DEFAULT_PAYMENT_KIND_RULES;
	const matched = rules.find((rule) => rule.pattern.test(normalised));
	return matched?.kind ?? "other";
}
