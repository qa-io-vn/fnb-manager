import {
	type AnalyticsSourceKind,
	asOfDate,
	type IsoDate,
	isValidIsoDate,
	type ThemeRow,
} from "@fnb/reports";
import { DataPackError } from "./errors.js";
import {
	type DataPackRequest,
	FOCUS_MAX_LENGTH,
	HORIZONS,
	type Horizon,
	MAX_PACK_STORES,
	OWNER_NOTE_MAX_LENGTH,
	PACK_LANGUAGES,
	type PackLanguage,
	type ResolvedPackRequest,
} from "./request.js";
import { normalizeRequestText } from "./request-text.js";
import { LIVE_STORE_ID_PATTERN, SAMPLE_STORE_ID_PATTERN } from "./schema.js";

export type StoreProfileRow = ThemeRow<"store_profiles">;

export interface CheckedPackRequest {
	readonly storeIds: readonly string[];
	readonly asOf: IsoDate | null;
	readonly horizon: Horizon;
	readonly language: PackLanguage;
	readonly focus: string | null;
	readonly ownerNote: string | null;
	readonly sample: boolean;
}

export interface PackRequestResolution {
	readonly request: ResolvedPackRequest;
	readonly country: string;
	readonly profiles: readonly StoreProfileRow[];
}

function labelNumber(label: string): number {
	return Number(label.slice(1));
}

function checkStoreIds(storeIds: readonly string[], sample: boolean): void {
	const pattern = sample ? SAMPLE_STORE_ID_PATTERN : LIVE_STORE_ID_PATTERN;
	if (
		!Array.isArray(storeIds) ||
		storeIds.length < 1 ||
		storeIds.length > MAX_PACK_STORES
	) {
		throw new DataPackError(
			"pack_stores_invalid",
			`a pack covers 1 to ${MAX_PACK_STORES} stores`,
		);
	}
	if (new Set(storeIds).size !== storeIds.length) {
		throw new DataPackError("pack_stores_invalid", "a store is asked twice");
	}
	if (!storeIds.every((id) => typeof id === "string" && pattern.test(id))) {
		throw new DataPackError(
			"pack_stores_invalid",
			sample
				? "a sample pack names its stores MOCK-S<n>"
				: "a live pack names its stores by UUID",
		);
	}
}

export function checkPackRequest(
	request: DataPackRequest,
	sourceKind: AnalyticsSourceKind,
): CheckedPackRequest {
	if (request.sample !== (sourceKind === "demo")) {
		throw new DataPackError(
			"pack_invalid",
			"a sample pack is built from the demo source only, and the demo source builds sample packs only",
		);
	}
	checkStoreIds(request.storeIds, request.sample);
	if (!HORIZONS.includes(request.horizon)) {
		throw new DataPackError(
			"pack_invalid",
			`${String(request.horizon)} is not a horizon`,
		);
	}
	if (!PACK_LANGUAGES.includes(request.language)) {
		throw new DataPackError(
			"pack_invalid",
			`${String(request.language)} is not a pack language`,
		);
	}
	if (
		request.asOf !== null &&
		(typeof request.asOf !== "string" || !isValidIsoDate(request.asOf))
	) {
		throw new DataPackError(
			"pack_invalid",
			`${String(request.asOf)} is not a date`,
		);
	}
	return {
		storeIds: [...request.storeIds],
		asOf: request.asOf,
		horizon: request.horizon,
		language: request.language,
		focus: normalizeRequestText(request.focus, "focus", FOCUS_MAX_LENGTH),
		ownerNote: normalizeRequestText(
			request.ownerNote,
			"owner note",
			OWNER_NOTE_MAX_LENGTH,
		),
		sample: request.sample,
	};
}

export function resolvePackRequest(
	checked: CheckedPackRequest,
	profileRows: readonly StoreProfileRow[],
	now: Date,
): PackRequestResolution {
	const byId = new Map(profileRows.map((row) => [row.store_id, row]));
	const profiles = checked.storeIds.map((id) => byId.get(id));
	if (profiles.some((row) => row === undefined)) {
		throw new DataPackError(
			"pack_stores_invalid",
			"a store of the request is not visible to this session",
		);
	}
	const visible = (profiles as StoreProfileRow[]).sort(
		(left, right) => labelNumber(left.label) - labelNumber(right.label),
	);
	const [first] = visible;
	if (
		first === undefined ||
		visible.some(
			(row) =>
				row.tenant_id !== first.tenant_id ||
				row.currency_code !== first.currency_code ||
				row.country_code !== first.country_code,
		)
	) {
		throw new DataPackError(
			"pack_stores_invalid",
			"the stores of a pack belong to one tenant",
		);
	}
	if (new Set(visible.map((row) => row.label)).size !== visible.length) {
		throw new DataPackError("pack_stores_invalid", "two stores share a label");
	}
	const complete = asOfDate(
		visible.map((row) => ({
			timeZone: row.timezone,
			businessDayStartMinutes: row.business_day_start_minutes,
		})),
		now,
	);
	const asOf = checked.asOf ?? complete;
	if (asOf > complete) {
		throw new DataPackError(
			"pack_as_of_not_complete",
			`${asOf} is after the last complete business day ${complete}`,
		);
	}
	return {
		request: {
			stores: visible.map((row) => ({ id: row.store_id, label: row.label })),
			asOf,
			horizon: checked.horizon,
			language: checked.language,
			focus: checked.focus,
			ownerNote: checked.ownerNote,
			sample: checked.sample,
			currency: first.currency_code,
		},
		country: first.country_code,
		profiles: visible,
	};
}
