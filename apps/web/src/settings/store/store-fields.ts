import {
	E_INVOICE_STATUSES,
	type EInvoiceStatus,
	POS_FEATURE_STATUSES,
	type PosFeatureStatus,
	TRAN_NO_RESET_PERIODS,
	type TranNoResetPeriod,
} from "@fnb/reports";
import type { Language, MessageKey } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import { formatIntegerText, readIntegerDraft } from "../forms/integer-field";
import {
	changedDays,
	draftOfOpeningHours,
	type OpeningHoursDraft,
	openingHoursOfDraft,
} from "../forms/opening-hours";
import {
	LEGAL_FORMS,
	type LegalForm,
	type StoreProfile,
	type StoreProfileChange,
	type StoreProfileFields,
	type TenantProfile,
	type TenantProfileChange,
} from "../source";
import {
	issueOf,
	openingDate,
	seatCount,
	storeCode,
	storeCodeValueOf,
	type ValidationIssue,
} from "../validation";

export const LEGAL_FORM_KEYS: Readonly<Record<LegalForm, MessageKey>> = {
	household_business: "settings.store.legalForm.household_business",
	micro_enterprise: "settings.store.legalForm.micro_enterprise",
	small_enterprise: "settings.store.legalForm.small_enterprise",
	enterprise: "settings.store.legalForm.enterprise",
	unknown: "settings.store.legalForm.unknown",
};

export const LANGUAGE_KEYS: Readonly<Record<Language, MessageKey>> = {
	vi: "shell.language.vi",
	en: "shell.language.en",
};

export const E_INVOICE_KEYS: Readonly<Record<EInvoiceStatus, MessageKey>> = {
	unknown: "settings.store.eInvoice.unknown",
	not_configured: "settings.store.eInvoice.not_configured",
	configured: "settings.store.eInvoice.configured",
	disabled: "settings.store.eInvoice.disabled",
};

export const RECEIPT_PERIOD_KEYS: Readonly<
	Record<TranNoResetPeriod, MessageKey>
> = {
	daily: "settings.store.receipts.daily",
	yearly: "settings.store.receipts.yearly",
	never: "settings.store.receipts.never",
	unknown: "settings.store.receipts.unknown",
};

export const MEMBER_FEATURE_KEYS: Readonly<
	Record<PosFeatureStatus, MessageKey>
> = {
	unknown: "settings.store.member.unknown",
	enabled: "settings.store.member.enabled",
	disabled: "settings.store.member.disabled",
};

export const LEGAL_FORM_OPTIONS = LEGAL_FORMS;
export const E_INVOICE_OPTIONS = E_INVOICE_STATUSES;
export const RECEIPT_PERIOD_OPTIONS = TRAN_NO_RESET_PERIODS;
export const MEMBER_FEATURE_OPTIONS = POS_FEATURE_STATUSES;

export type StoreField = keyof StoreProfileFields;

export const STORE_FIELDS: readonly StoreField[] = [
	"code",
	"openedOn",
	"seatCount",
	"openingHours",
	"eInvoiceStatus",
	"tranNoResetPeriod",
	"memberCaptureStatus",
];

export type TypedStoreField = "code" | "openedOn" | "seatCount";

export interface StoreDraft {
	readonly code: string;
	readonly openedOn: string;
	readonly seatCount: string;
	readonly openingHours: OpeningHoursDraft;
	readonly eInvoiceStatus: EInvoiceStatus;
	readonly tranNoResetPeriod: TranNoResetPeriod;
	readonly memberCaptureStatus: PosFeatureStatus;
}

export function storeDraftOf(
	profile: StoreProfile,
	locale: string,
): StoreDraft {
	return {
		code: profile.code ?? "",
		openedOn: profile.openedOn ?? "",
		seatCount:
			profile.seatCount === null
				? ""
				: formatIntegerText(profile.seatCount, locale),
		openingHours: draftOfOpeningHours(profile.openingHours),
		eInvoiceStatus: profile.eInvoiceStatus,
		tranNoResetPeriod: profile.tranNoResetPeriod,
		memberCaptureStatus: profile.memberCaptureStatus,
	};
}

interface TypedReading<Value> {
	readonly value: Value;
	readonly issue: ValidationIssue | null;
}

function readCode(text: string): TypedReading<string | null> {
	return { value: storeCodeValueOf(text), issue: issueOf(storeCode, text) };
}

function readOpenedOn(
	text: string,
	today: IsoDate,
): TypedReading<IsoDate | null> {
	if (text === "") return { value: null, issue: null };
	return { value: text, issue: issueOf(openingDate(today), text, "date") };
}

function readSeats(text: string, locale: string): TypedReading<number | null> {
	return readIntegerDraft(text, locale, seatCount, { required: false });
}

export interface StoreDraftReading {
	readonly changes: StoreProfileChange | null;
	readonly changed: readonly StoreField[];
	readonly issues: Readonly<Partial<Record<TypedStoreField, ValidationIssue>>>;
	readonly hoursInvalid: boolean;
}

export function readStoreDraft(
	profile: StoreProfile,
	saved: StoreDraft,
	draft: StoreDraft,
	locale: string,
	today: IsoDate,
): StoreDraftReading {
	const typed: Record<TypedStoreField, TypedReading<unknown>> = {
		code: readCode(draft.code),
		openedOn: readOpenedOn(draft.openedOn, today),
		seatCount: readSeats(draft.seatCount, locale),
	};
	const savedTyped: Record<TypedStoreField, unknown> = {
		code: storeCodeValueOf(saved.code),
		openedOn: profile.openedOn,
		seatCount: profile.seatCount,
	};
	const changes: Record<string, unknown> = {};
	const changed: StoreField[] = [];
	const issues: Partial<Record<TypedStoreField, ValidationIssue>> = {};
	let blocked = false;
	for (const field of ["code", "openedOn", "seatCount"] as const) {
		const reading = typed[field];
		const isChanged =
			reading.issue === null
				? reading.value !== savedTyped[field]
				: draft[field].trim() !== saved[field].trim();
		if (!isChanged) continue;
		changed.push(field);
		if (reading.issue === null) {
			changes[field] = reading.value;
			continue;
		}
		issues[field] = reading.issue;
		blocked = true;
	}
	let hoursInvalid = false;
	if (changedDays(saved.openingHours, draft.openingHours).length > 0) {
		changed.push("openingHours");
		const hours = openingHoursOfDraft(draft.openingHours);
		if (hours.ok) changes.openingHours = hours.hours;
		else {
			hoursInvalid = true;
			blocked = true;
		}
	}
	for (const field of [
		"eInvoiceStatus",
		"tranNoResetPeriod",
		"memberCaptureStatus",
	] as const) {
		if (draft[field] === profile[field]) continue;
		changed.push(field);
		changes[field] = draft[field];
	}
	const order = (field: StoreField) => STORE_FIELDS.indexOf(field);
	changed.sort((left, right) => order(left) - order(right));
	return {
		changes: blocked ? null : (changes as StoreProfileChange),
		changed,
		issues,
		hoursInvalid,
	};
}

export function touchesOpeningHours(args: {
	readonly change: StoreProfileChange;
}): boolean {
	return args.change.openingHours !== undefined;
}

export interface TenantDraft {
	readonly legalForm: LegalForm;
	readonly defaultLanguage: Language;
}

export function tenantDraftOf(profile: TenantProfile): TenantDraft {
	return {
		legalForm: profile.legalForm,
		defaultLanguage: profile.defaultLanguage,
	};
}

export function tenantChangeOf(
	profile: TenantProfile,
	draft: TenantDraft,
): TenantProfileChange {
	return {
		...(draft.legalForm === profile.legalForm
			? {}
			: { legalForm: draft.legalForm }),
		...(draft.defaultLanguage === profile.defaultLanguage
			? {}
			: { defaultLanguage: draft.defaultLanguage }),
	};
}

const MINUTES_PER_HOUR = 60;

export function businessDayStartText(minutes: number): string {
	const hours = Math.floor(minutes / MINUTES_PER_HOUR);
	const rest = minutes % MINUTES_PER_HOUR;
	return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
