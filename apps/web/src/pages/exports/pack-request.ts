import {
	type DataPackRequest,
	DEFAULT_HORIZON,
	FOCUS_MAX_LENGTH,
	HORIZONS,
	type Horizon,
	MAX_PACK_STORES,
	OWNER_NOTE_MAX_LENGTH,
	PACK_LANGUAGES,
	type PackErrorCode,
	type PackLanguage,
} from "@fnb/datapack";
import { isValidIsoDate } from "@fnb/reports";

export interface PackFormValues {
	readonly asOf: string;
	readonly horizon: Horizon;
	readonly language: PackLanguage;
	readonly focus: string;
	readonly ownerNote: string;
}

export const PACK_FAILURES = [
	"pack_text_contact_details",
	"pack_text_too_long",
	"pack_as_of_not_complete",
	"pack_stores_invalid",
	"pack_data_changed",
	"pack_not_aggregate",
	"pack_over_budget",
] as const satisfies readonly PackErrorCode[];

export type PackFailure = (typeof PACK_FAILURES)[number] | "failed";

export const TEXT_LIMITS = {
	focus: FOCUS_MAX_LENGTH,
	ownerNote: OWNER_NOTE_MAX_LENGTH,
} as const;

export type PackTextField = keyof typeof TEXT_LIMITS;

const WHITESPACE_RUN = /\s+/gu;
const ERROR_CODE = /^[a-z][a-z0-9_]*$/;

function isHorizon(value: string | null): value is Horizon {
	return HORIZONS.includes(value as Horizon);
}

function isPackLanguage(value: string | null): value is PackLanguage {
	return PACK_LANGUAGES.includes(value as PackLanguage);
}

export function packDefaults(
	params: URLSearchParams,
	defaults: {
		readonly language: PackLanguage;
		readonly asOf: string;
		readonly ownerNote: string;
	},
): PackFormValues {
	const asOf = params.get("asOf");
	const horizon = params.get("horizon");
	const lang = params.get("lang");
	return {
		asOf: asOf !== null && isValidIsoDate(asOf) ? asOf : defaults.asOf,
		horizon: isHorizon(horizon) ? horizon : DEFAULT_HORIZON,
		language: isPackLanguage(lang) ? lang : defaults.language,
		focus: params.get("focus") ?? "",
		ownerNote: defaults.ownerNote,
	};
}

export function requestTextLength(text: string): number {
	return [...text.normalize("NFC").replace(WHITESPACE_RUN, " ").trim()].length;
}

export function textTooLong(
	values: PackFormValues,
	field: PackTextField,
): boolean {
	return requestTextLength(values[field]) > TEXT_LIMITS[field];
}

export function storeCountValid(count: number): boolean {
	return count >= 1 && count <= MAX_PACK_STORES;
}

function textOrNull(text: string): string | null {
	return text.trim() === "" ? null : text;
}

export function packRequestOf(
	values: PackFormValues,
	storeIds: readonly string[],
	sample: boolean,
): DataPackRequest {
	return {
		storeIds: [...storeIds],
		asOf: values.asOf === "" ? null : values.asOf,
		horizon: values.horizon,
		language: values.language,
		focus: textOrNull(values.focus),
		ownerNote: textOrNull(values.ownerNote),
		sample,
	};
}

function rawCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error
		? (error as { code: unknown }).code
		: null;
}

export function failureOf(error: unknown): PackFailure {
	const code = rawCode(error);
	return PACK_FAILURES.find((failure) => failure === code) ?? "failed";
}

export function errorCodeOf(error: unknown): string | null {
	const code = rawCode(error);
	return typeof code === "string" && ERROR_CODE.test(code) ? code : null;
}
