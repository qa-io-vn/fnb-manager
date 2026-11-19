import {
	type DiscountCapRule,
	hasControlCharacter,
	type LegalBasis,
	promotionRules,
} from "@fnb/core";
import type { MessageKey } from "../../i18n";
import { type IsoDate, isIsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { formatIntegerText, readIntegerDraft } from "../forms/integer-field";
import { formatMoneyText, readMoneyDraft } from "../forms/money-field";
import { formatPercentText, readPercentDraft } from "../forms/percent-field";
import type { NumberDraft } from "../number-text";
import { decimalInRange, money, type ValidationIssue } from "../validation";
import type {
	RewardChange,
	RewardField,
	RewardKind,
	RewardRecord,
	RewardStatus,
} from "./source";

export const REWARD_NAME_MAX = 120;
export const REWARD_DESCRIPTION_MAX = 500;
export const REWARD_KEY_MAX = 64;
export const REWARD_ITEMS_MAX = 50;
export const EXCLUDED_ITEMS_MAX = 100;
export const REWARD_STORES_MAX = 50;
export const ITEM_ID_MAX = 100;
export const REWARD_AMOUNT_MAX = 100_000_000;

export const REWARD_LIMITS = {
	rewardPercent: { min: 0.01, max: 100, fractionDigits: 2 },
	costStamps: { min: 0, max: 100, fractionDigits: 0 },
	costPoints: { min: 0, max: 1_000_000, fractionDigits: 0 },
	validDays: { min: 1, max: 365, fractionDigits: 0 },
	holdHours: { min: 1, max: 168, fractionDigits: 0 },
	perMemberLimit: { min: 1, max: 100, fractionDigits: 0 },
} as const;

export const REWARD_DEFAULTS = {
	validDays: 30,
	holdHours: 24,
} as const;

const REWARD_KEY_SHAPE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const PRICE_KINDS: ReadonlySet<RewardKind> = new Set([
	"percent_off",
	"amount_off",
]);

export const REWARD_KIND_KEYS: Readonly<
	Record<RewardKind, { label: MessageKey; hint: MessageKey }>
> = {
	free_item: {
		label: "settings.rewards.kind.free_item",
		hint: "settings.rewards.kind.free_item.hint",
	},
	percent_off: {
		label: "settings.rewards.kind.percent_off",
		hint: "settings.rewards.kind.percent_off.hint",
	},
	amount_off: {
		label: "settings.rewards.kind.amount_off",
		hint: "settings.rewards.kind.amount_off.hint",
	},
	free_upgrade: {
		label: "settings.rewards.kind.free_upgrade",
		hint: "settings.rewards.kind.free_upgrade.hint",
	},
};

export const REWARD_STATUS_KEYS: Readonly<Record<RewardStatus, MessageKey>> = {
	draft: "settings.rewards.status.draft",
	approved: "settings.rewards.status.approved",
	active: "settings.rewards.status.active",
	retired: "settings.rewards.status.retired",
};

export interface RewardCap {
	readonly rate: number;
	readonly basis: LegalBasis;
}

const OPEN_END = "9999-12-31";

export function rewardCapOf(
	countryCode: string,
	from: IsoDate,
	to: IsoDate | null,
): RewardCap | null {
	const end = to ?? OPEN_END;
	const rules = promotionRules(countryCode).filter(
		(rule): rule is DiscountCapRule =>
			rule.id === "discount_cap" &&
			rule.validFrom <= end &&
			(rule.validTo ?? OPEN_END) >= from,
	);
	let chosen: DiscountCapRule | null = null;
	for (const rule of rules) {
		if (
			chosen === null ||
			rule.parameters.maxDiscountRate < chosen.parameters.maxDiscountRate ||
			(rule.parameters.maxDiscountRate === chosen.parameters.maxDiscountRate &&
				rule.validFrom > chosen.validFrom)
		) {
			chosen = rule;
		}
	}
	return chosen === null
		? null
		: { rate: chosen.parameters.maxDiscountRate, basis: chosen.legalBasis };
}

export interface RewardTexts {
	readonly programmeId: string;
	readonly name: string;
	readonly rewardKey: string;
	readonly description: string;
	readonly rewardKind: RewardKind;
	readonly rewardPercent: string;
	readonly rewardAmount: string;
	readonly rewardItems: readonly string[];
	readonly excludedItems: readonly string[];
	readonly costStamps: string;
	readonly costPoints: string;
	readonly minBillAmount: string;
	readonly validFrom: string;
	readonly validUntil: string;
	readonly validDays: string;
	readonly holdHours: string;
	readonly perMemberLimit: string;
	readonly allStores: boolean;
	readonly storeIds: readonly string[];
}

export type TextField = Exclude<
	keyof RewardTexts,
	"rewardItems" | "excludedItems" | "allStores" | "storeIds"
>;

export interface RewardFormat {
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly countryCode: string;
	readonly today: IsoDate;
}

export type RewardIssue =
	| { readonly kind: "value"; readonly issue: ValidationIssue }
	| { readonly kind: "rule"; readonly key: MessageKey }
	| {
			readonly kind: "cap";
			readonly key: MessageKey;
			readonly cap: RewardCap;
			readonly maxAmount: number | null;
	  };

export type RewardIssues = Readonly<Partial<Record<RewardField, RewardIssue>>>;

export interface RewardDraft {
	readonly issues: RewardIssues;
	readonly changed: readonly RewardField[];
	readonly change: RewardChange | null;
	readonly cap: RewardCap | null;
	readonly termsChanged: boolean;
}

export function slugOfName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "d")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, REWARD_KEY_MAX)
		.replace(/-+$/g, "");
}

function integerText(value: number | null, format: RewardFormat): string {
	return value === null
		? ""
		: formatIntegerText(value, format.formatters.locale);
}

export function rewardTextsOf(
	record: RewardRecord | null,
	format: RewardFormat,
	programmeId: string,
): RewardTexts {
	const { formatters } = format;
	return {
		programmeId: record?.programmeId ?? programmeId,
		name: record?.name ?? "",
		rewardKey: record?.rewardKey ?? "",
		description: record?.description ?? "",
		rewardKind: record?.rewardKind ?? "free_item",
		rewardPercent:
			record?.rewardPercent == null
				? ""
				: formatPercentText(
						record.rewardPercent,
						formatters.locale,
						REWARD_LIMITS.rewardPercent,
					),
		rewardAmount:
			record?.rewardAmount == null
				? ""
				: formatMoneyText(record.rewardAmount, formatters),
		rewardItems: record?.rewardItemExternalIds ?? [],
		excludedItems: record?.excludedItemExternalIds ?? [],
		costStamps: integerText(record?.costStamps ?? 0, format),
		costPoints: integerText(record?.costPoints ?? 0, format),
		minBillAmount: formatMoneyText(record?.minBillAmount ?? 0, formatters),
		validFrom: record?.validFrom ?? "",
		validUntil: record?.validUntil ?? "",
		validDays: integerText(
			record?.validDays ?? REWARD_DEFAULTS.validDays,
			format,
		),
		holdHours: integerText(
			record?.holdHours ?? REWARD_DEFAULTS.holdHours,
			format,
		),
		perMemberLimit: integerText(record?.perMemberLimit ?? null, format),
		allStores: record === null || record.storeIds === null,
		storeIds: record?.storeIds ?? [],
	};
}

function value(issue: ValidationIssue): RewardIssue {
	return { kind: "value", issue };
}

function rule(key: MessageKey): RewardIssue {
	return { kind: "rule", key };
}

function plainTextIssue(
	text: string,
	max: number,
	required: boolean,
	allowNewlines = false,
): RewardIssue | null {
	const trimmed = text.trim();
	if (trimmed === "") return required ? value({ key: "required" }) : null;
	if ([...trimmed].length > max) return value({ key: "textLength", max });
	const checked = allowNewlines ? trimmed.replace(/\r?\n/g, "") : trimmed;
	if (hasControlCharacter(checked)) {
		return rule("settings.rewards.error.plainText");
	}
	return null;
}

function keyIssue(text: string): RewardIssue | null {
	if (text === "") return value({ key: "required" });
	return REWARD_KEY_SHAPE.test(text)
		? null
		: rule("settings.rewards.error.keyShape");
}

function dateIssue(text: string): RewardIssue | null {
	if (text === "") return null;
	return isIsoDate(text) ? null : value({ key: "date" });
}

function readInteger(
	text: string,
	format: RewardFormat,
	limit: { min: number; max: number; fractionDigits: number },
	required = true,
): NumberDraft {
	return readIntegerDraft(
		text,
		format.formatters.locale,
		decimalInRange(limit),
		{
			required,
		},
	);
}

function readMoney(
	text: string,
	format: RewardFormat,
	min: number,
	max: number,
	required = true,
): NumberDraft {
	return readMoneyDraft(text, format.formatters, format.currencyCode, {
		schema: money(format.formatters.moneyFractionDigits, { min, max }),
		required,
	});
}

function itemsIssue(
	items: readonly string[],
	max: number,
	required: boolean,
): RewardIssue | null {
	if (items.length === 0) {
		return required ? rule("settings.rewards.error.itemsRequired") : null;
	}
	if (items.length > max) return rule("settings.rewards.error.tooManyItems");
	if (
		items.some(
			(item) =>
				item.trim() === "" ||
				[...item].length > ITEM_ID_MAX ||
				hasControlCharacter(item),
		)
	) {
		return rule("settings.rewards.error.itemId");
	}
	return null;
}

const TEXT_FIELDS: readonly TextField[] = [
	"programmeId",
	"name",
	"rewardKey",
	"description",
	"rewardKind",
	"rewardPercent",
	"rewardAmount",
	"costStamps",
	"costPoints",
	"minBillAmount",
	"validFrom",
	"validUntil",
	"validDays",
	"holdHours",
	"perMemberLimit",
];

const NON_TERMS: ReadonlySet<RewardField> = new Set([
	"name",
	"description",
	"storeIds",
]);

function sameList(left: readonly string[], right: readonly string[]): boolean {
	return (
		left.length === right.length &&
		left.every((entry, index) => entry === right[index])
	);
}

function changedFields(saved: RewardTexts, texts: RewardTexts): RewardField[] {
	const changed: RewardField[] = TEXT_FIELDS.filter(
		(field) => saved[field] !== texts[field],
	);
	if (!sameList(saved.rewardItems, texts.rewardItems)) {
		changed.push("rewardItemExternalIds");
	}
	if (!sameList(saved.excludedItems, texts.excludedItems)) {
		changed.push("excludedItemExternalIds");
	}
	if (
		saved.allStores !== texts.allStores ||
		(!texts.allStores &&
			!sameList([...saved.storeIds].sort(), [...texts.storeIds].sort()))
	) {
		changed.push("storeIds");
	}
	return changed;
}

export function readRewardDraft(
	saved: RewardRecord | null,
	savedTexts: RewardTexts,
	texts: RewardTexts,
	format: RewardFormat,
): RewardDraft {
	const issues: Partial<Record<RewardField, RewardIssue>> = {};
	const note = (field: RewardField, issue: RewardIssue | null) => {
		if (issue !== null && issues[field] === undefined) issues[field] = issue;
	};
	note(
		"programmeId",
		texts.programmeId === ""
			? rule("settings.rewards.error.programmeRequired")
			: null,
	);
	note("name", plainTextIssue(texts.name, REWARD_NAME_MAX, true));
	note("rewardKey", keyIssue(texts.rewardKey));
	note(
		"description",
		plainTextIssue(texts.description, REWARD_DESCRIPTION_MAX, false, true),
	);
	const kind = texts.rewardKind;
	const percent =
		kind === "percent_off"
			? readPercentDraft(texts.rewardPercent, format.formatters.locale, {
					limit: REWARD_LIMITS.rewardPercent,
				})
			: { value: null, issue: null };
	note("rewardPercent", percent.issue === null ? null : value(percent.issue));
	const amount =
		kind === "amount_off"
			? readMoney(texts.rewardAmount, format, 1, REWARD_AMOUNT_MAX)
			: { value: null, issue: null };
	note("rewardAmount", amount.issue === null ? null : value(amount.issue));
	const minBill = readMoney(
		texts.minBillAmount,
		format,
		0,
		REWARD_AMOUNT_MAX * 10,
	);
	note("minBillAmount", minBill.issue === null ? null : value(minBill.issue));
	const stamps = readInteger(
		texts.costStamps,
		format,
		REWARD_LIMITS.costStamps,
	);
	note("costStamps", stamps.issue === null ? null : value(stamps.issue));
	const points = readInteger(
		texts.costPoints,
		format,
		REWARD_LIMITS.costPoints,
	);
	note("costPoints", points.issue === null ? null : value(points.issue));
	if (
		stamps.value !== null &&
		points.value !== null &&
		stamps.value === 0 &&
		points.value === 0
	) {
		note("costStamps", rule("settings.rewards.error.costRequired"));
	}
	note("validFrom", dateIssue(texts.validFrom));
	note("validUntil", dateIssue(texts.validUntil));
	if (
		isIsoDate(texts.validFrom) &&
		isIsoDate(texts.validUntil) &&
		texts.validUntil < texts.validFrom
	) {
		note("validUntil", rule("settings.rewards.error.untilBeforeFrom"));
	}
	const validDays = readInteger(
		texts.validDays,
		format,
		REWARD_LIMITS.validDays,
	);
	note("validDays", validDays.issue === null ? null : value(validDays.issue));
	const holdHours = readInteger(
		texts.holdHours,
		format,
		REWARD_LIMITS.holdHours,
	);
	note("holdHours", holdHours.issue === null ? null : value(holdHours.issue));
	const limit = readInteger(
		texts.perMemberLimit,
		format,
		REWARD_LIMITS.perMemberLimit,
		false,
	);
	note("perMemberLimit", limit.issue === null ? null : value(limit.issue));
	note(
		"rewardItemExternalIds",
		itemsIssue(texts.rewardItems, REWARD_ITEMS_MAX, kind === "free_item"),
	);
	note(
		"excludedItemExternalIds",
		itemsIssue(texts.excludedItems, EXCLUDED_ITEMS_MAX, false),
	);
	if (texts.rewardItems.some((item) => texts.excludedItems.includes(item))) {
		note("excludedItemExternalIds", rule("settings.rewards.error.itemOverlap"));
	}
	if (!texts.allStores) {
		if (texts.storeIds.length === 0) {
			note("storeIds", rule("settings.rewards.error.storesRequired"));
		} else if (texts.storeIds.length > REWARD_STORES_MAX) {
			note("storeIds", rule("settings.rewards.error.tooManyStores"));
		}
	}
	const from = isIsoDate(texts.validFrom) ? texts.validFrom : format.today;
	const until = isIsoDate(texts.validUntil) ? texts.validUntil : null;
	const cap = PRICE_KINDS.has(kind)
		? rewardCapOf(format.countryCode, from, until)
		: null;
	if (cap !== null && kind === "percent_off" && percent.value !== null) {
		if (percent.value > cap.rate * 100) {
			note("rewardPercent", {
				kind: "cap",
				key: "settings.rewards.error.cap",
				cap,
				maxAmount: null,
			});
		}
	}
	if (cap !== null && kind === "amount_off") {
		if (minBill.value !== null && minBill.value <= 0) {
			note("minBillAmount", rule("settings.rewards.error.minBillRequired"));
		} else if (
			minBill.value !== null &&
			amount.value !== null &&
			amount.value > cap.rate * minBill.value
		) {
			note("rewardAmount", {
				kind: "cap",
				key: "settings.rewards.error.amountCap",
				cap,
				maxAmount: cap.rate * minBill.value,
			});
		}
	}
	const changed = changedFields(savedTexts, texts);
	const termsChanged = changed.some((field) => !NON_TERMS.has(field));
	const valid = Object.keys(issues).length === 0;
	const description = texts.description.trim();
	return {
		issues,
		changed,
		cap,
		termsChanged,
		change: !valid
			? null
			: {
					id: saved?.id ?? null,
					programmeId: texts.programmeId,
					rewardKey: texts.rewardKey,
					name: texts.name.trim(),
					description: description === "" ? null : description,
					rewardKind: kind,
					rewardPercent: kind === "percent_off" ? percent.value : null,
					rewardAmount: kind === "amount_off" ? amount.value : null,
					rewardItemExternalIds:
						texts.rewardItems.length === 0
							? null
							: texts.rewardItems.map((item) => item.trim()),
					excludedItemExternalIds: texts.excludedItems.map((item) =>
						item.trim(),
					),
					costStamps: stamps.value ?? 0,
					costPoints: points.value ?? 0,
					minBillAmount: minBill.value ?? 0,
					validFrom: texts.validFrom === "" ? null : texts.validFrom,
					validUntil: texts.validUntil === "" ? null : texts.validUntil,
					validDays: validDays.value ?? REWARD_DEFAULTS.validDays,
					holdHours: holdHours.value ?? REWARD_DEFAULTS.holdHours,
					perMemberLimit: limit.value,
					storeIds: texts.allStores ? null : [...texts.storeIds],
				},
	};
}

export type RewardAction = "approve" | "activate" | "deactivate" | "retire";

export const ACTION_TARGETS: Readonly<Record<RewardAction, RewardStatus>> = {
	approve: "approved",
	activate: "active",
	deactivate: "approved",
	retire: "retired",
};

export interface RewardRole {
	readonly canWrite: boolean;
	readonly canApprove: boolean;
}

export function actionsOf(
	status: RewardStatus,
	role: RewardRole,
): RewardAction[] {
	if (!role.canWrite || status === "retired") return [];
	const actions: RewardAction[] = [];
	if (status === "draft" && role.canApprove) actions.push("approve");
	if (status === "approved") actions.push("activate");
	if (status === "active") actions.push("deactivate");
	actions.push("retire");
	return actions;
}

export type ApprovalState =
	| "awaitingOwner"
	| "approvedByYou"
	| "approvedByOwner"
	| "approvedBySystem"
	| "approvedUnknown"
	| "retired";

export function approvalStateOf(record: RewardRecord): ApprovalState {
	if (record.status === "retired") return "retired";
	if (record.status === "draft" || record.approval === null) {
		return "awaitingOwner";
	}
	switch (record.approval.by.kind) {
		case "you":
			return "approvedByYou";
		case "owner":
			return "approvedByOwner";
		case "system":
			return "approvedBySystem";
		default:
			return "approvedUnknown";
	}
}

export function sendsBackToDraft(
	record: RewardRecord | null,
	termsChanged: boolean,
	role: RewardRole,
): boolean {
	return (
		record !== null &&
		termsChanged &&
		!role.canApprove &&
		(record.status === "approved" || record.status === "active")
	);
}
