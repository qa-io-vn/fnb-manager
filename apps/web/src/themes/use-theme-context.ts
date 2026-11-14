import type {
	IsoDate,
	ReportRange,
	ReportStore,
	ThemeContext,
	ThemeDefinition,
	ThemeSlug,
} from "@fnb/reports";
import { moveRangeToLimit } from "@fnb/reports";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { StoreRow } from "../data/row-source";
import { parseStoreParam, STORE_PARAM } from "../reports/report-route";
import { useAsOf } from "../reports/use-as-of";
import { usePreferences } from "../state/preferences";
import { selectedStoresOf, useReadyTenantScope } from "../state/tenant-scope";
import { canonicalParams, parseThemeSearch, themeHref } from "./theme-route";

const ALL_STORES = "*";
const NO_STORE_PARAM = "absent";

export interface ThemeLocation {
	readonly context: ThemeContext;
	readonly asOf: IsoDate;
	readonly rangeClamped: boolean;
	readonly todayClamped: boolean;
	readonly invalid: boolean;
	readonly hrefFor: (
		target: Pick<ThemeDefinition, "slug" | "maxRangeDays">,
		range?: ReportRange,
	) => string;
	readonly goTo: (
		range: ReportRange,
		options?: {
			readonly replace?: boolean;
			readonly params?: Readonly<Record<string, string>>;
		},
	) => void;
}

function storesKey(storeIds: readonly string[] | null): string {
	return storeIds === null ? ALL_STORES : storeIds.join(",");
}

function toReportStore(store: StoreRow): ReportStore {
	return {
		id: store.id,
		name: store.name,
		timeZone: store.timeZone,
		businessDayStartMinutes: store.businessDayStartMinutes,
	};
}

export function useThemeContext(definition: ThemeDefinition): ThemeLocation {
	const scope = useReadyTenantScope();
	const { preferences, update } = usePreferences();
	const [search, setSearch] = useSearchParams();
	const navigate = useNavigate();
	const allIds = useMemo(
		() => scope.stores.map((store) => store.id),
		[scope.stores],
	);
	const searchKey = search.toString();
	const hasStoreParam = search.has(STORE_PARAM);
	const urlStores = useMemo(
		() => parseStoreParam(new URLSearchParams(searchKey), allIds),
		[searchKey, allIds],
	);
	const preferenceIds = useMemo(
		() =>
			scope.allStoresSelected
				? null
				: scope.selectedStores.map((store) => store.id),
		[scope.allStoresSelected, scope.selectedStores],
	);
	const effectiveIds = hasStoreParam ? urlStores.storeIds : preferenceIds;
	const selected = useMemo(
		() => selectedStoresOf(scope.stores, effectiveIds),
		[scope.stores, effectiveIds],
	);
	const asOf = useAsOf(selected);
	const preferredPreset = preferences.themePreset;
	const parsed = useMemo(
		() =>
			parseThemeSearch(
				definition,
				new URLSearchParams(searchKey),
				asOf,
				allIds,
				preferredPreset,
			),
		[definition, searchKey, asOf, allIds, preferredPreset],
	);
	const urlKey = hasStoreParam ? storesKey(urlStores.storeIds) : NO_STORE_PARAM;
	const preferenceKey = storesKey(preferenceIds);
	const inSync = hasStoreParam
		? urlKey === preferenceKey
		: preferenceKey === ALL_STORES;
	const seenUrlKey = useRef<string | null>(null);
	const { selectStores } = scope;
	const range = parsed.resolved.range;
	const params = parsed.params;

	useEffect(() => {
		const urlChanged = seenUrlKey.current !== urlKey;
		if (inSync) seenUrlKey.current = urlKey;
		if (hasStoreParam && urlChanged && !inSync) {
			selectStores(
				urlStores.storeIds === null ? null : [...urlStores.storeIds],
			);
			if (parsed.normalised) setSearch(parsed.canonical, { replace: true });
			return;
		}
		if (!inSync) {
			const next = new URLSearchParams(parsed.canonical);
			next.delete(STORE_PARAM);
			if (preferenceIds !== null)
				next.set(STORE_PARAM, preferenceIds.join(","));
			setSearch(next, { replace: true });
			return;
		}
		if (parsed.normalised) setSearch(parsed.canonical, { replace: true });
	}, [
		hasStoreParam,
		inSync,
		parsed.canonical,
		parsed.normalised,
		preferenceIds,
		selectStores,
		setSearch,
		urlKey,
		urlStores.storeIds,
	]);

	useEffect(() => {
		if (range.preset === "custom" || range.preset === preferredPreset) return;
		update({ themePreset: range.preset });
	}, [range.preset, preferredPreset, update]);

	const context = useMemo<ThemeContext>(
		() => ({
			tenantId: scope.tenant.id,
			stores: selected.map(toReportStore),
			allStoresSelected: selected.length === scope.stores.length,
			range,
			sample: scope.source.kind === "demo",
			params,
			catchUpPending: null,
		}),
		[
			scope.tenant.id,
			scope.stores.length,
			scope.source.kind,
			selected,
			range,
			params,
		],
	);

	const linkStores =
		effectiveIds === null || effectiveIds.length === allIds.length
			? null
			: effectiveIds;
	const hrefFor = useCallback(
		(
			target: Pick<ThemeDefinition, "slug" | "maxRangeDays">,
			wanted: ReportRange = range,
		) =>
			themeHref(
				target.slug as ThemeSlug,
				moveRangeToLimit(wanted, target.maxRangeDays),
				linkStores,
			),
		[linkStores, range],
	);
	const goTo = useCallback(
		(
			next: ReportRange,
			options?: {
				readonly replace?: boolean;
				readonly params?: Readonly<Record<string, string>>;
			},
		) =>
			navigate(
				themeHref(
					definition.slug,
					next,
					linkStores,
					canonicalParams(definition, options?.params ?? params),
				),
				{ replace: options?.replace ?? false },
			),
		[navigate, definition, linkStores, params],
	);

	return {
		context,
		asOf,
		rangeClamped: parsed.resolved.rangeClamped,
		todayClamped: parsed.resolved.todayClamped,
		invalid: parsed.resolved.invalid,
		hrefFor,
		goTo,
	};
}
