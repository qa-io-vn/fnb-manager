import type {
	IsoDate,
	ReportContext,
	ReportKind,
	ReportPeriod,
	ReportStore,
} from "@fnb/reports";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { StoreRow } from "../data/row-source";
import { usePreferences } from "../state/preferences";
import { selectedStoresOf, useReadyTenantScope } from "../state/tenant-scope";
import {
	type ClampReason,
	parseReportSearch,
	parseStoreParam,
	reportHref,
	reportSearch,
	STORE_PARAM,
} from "./report-route";
import { useAsOf } from "./use-as-of";

const ALL_STORES = "*";
const NO_STORE_PARAM = "absent";

export interface ReportLocation {
	readonly context: ReportContext;
	readonly clampedFromFuture: boolean;
	readonly clampReason: ClampReason | null;
	readonly asOf: IsoDate;
	readonly urlStoreIds: readonly string[] | null;
	readonly hrefFor: (
		kind: ReportKind,
		period: Pick<ReportPeriod, "key">,
	) => string;
	readonly goTo: (
		period: Pick<ReportPeriod, "key">,
		options?: { readonly replace: boolean },
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

export function useReportContext(kind: ReportKind): ReportLocation {
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
	const parsed = useMemo(
		() => parseReportSearch(kind, new URLSearchParams(searchKey), asOf, allIds),
		[kind, searchKey, asOf, allIds],
	);
	const urlKey = hasStoreParam ? storesKey(urlStores.storeIds) : NO_STORE_PARAM;
	const preferenceKey = storesKey(preferenceIds);
	const inSync = hasStoreParam
		? urlKey === preferenceKey
		: preferenceKey === ALL_STORES;
	const seenUrlKey = useRef<string | null>(null);
	const { selectStores } = scope;

	useEffect(() => {
		const urlChanged = seenUrlKey.current !== urlKey;
		if (inSync) seenUrlKey.current = urlKey;
		if (hasStoreParam && urlChanged && !inSync) {
			selectStores(
				urlStores.storeIds === null ? null : [...urlStores.storeIds],
			);
			if (parsed.normalised) {
				setSearch(reportSearch(kind, parsed.period, urlStores.storeIds), {
					replace: true,
				});
			}
			return;
		}
		if (!inSync || parsed.normalised) {
			setSearch(
				reportSearch(
					kind,
					parsed.period,
					inSync ? urlStores.storeIds : preferenceIds,
				),
				{ replace: true },
			);
		}
	}, [
		hasStoreParam,
		inSync,
		kind,
		parsed.normalised,
		parsed.period,
		preferenceIds,
		selectStores,
		setSearch,
		urlKey,
		urlStores.storeIds,
	]);

	const [notStartedKey, setNotStartedKey] = useState<string | null>(null);
	const shownKey = parsed.period.key;
	useEffect(() => {
		if (parsed.clampReason === "notStarted") {
			setNotStartedKey(shownKey);
		} else if (parsed.clampReason === null) {
			setNotStartedKey((kept) => (kept === shownKey ? kept : null));
		}
	}, [parsed.clampReason, shownKey]);
	const clampReason =
		parsed.clampReason ??
		(notStartedKey === shownKey ? ("notStarted" as const) : null);

	const periodEnd = parsed.period.end;
	const storedPeriod = preferences.period;
	useEffect(() => {
		if (storedPeriod.kind === kind && storedPeriod.anchor === periodEnd) return;
		update({
			period: { kind, anchor: periodEnd, custom: storedPeriod.custom },
		});
	}, [kind, periodEnd, storedPeriod, update]);

	const context = useMemo<ReportContext>(
		() => ({
			tenantId: scope.tenant.id,
			stores: selected.map(toReportStore),
			allStoresSelected: selected.length === scope.stores.length,
			period: parsed.period,
			sample: scope.source.kind === "demo",
		}),
		[
			scope.tenant.id,
			scope.stores.length,
			scope.source.kind,
			selected,
			parsed.period,
		],
	);

	const linkStores =
		effectiveIds === null || effectiveIds.length === allIds.length
			? null
			: effectiveIds;
	const hrefFor = useCallback(
		(target: ReportKind, period: Pick<ReportPeriod, "key">) =>
			reportHref(target, period, linkStores),
		[linkStores],
	);
	const goTo = useCallback(
		(
			period: Pick<ReportPeriod, "key">,
			options?: { readonly replace: boolean },
		) =>
			navigate(hrefFor(kind, period), { replace: options?.replace ?? false }),
		[navigate, hrefFor, kind],
	);

	return {
		context,
		clampedFromFuture: parsed.clampedFromFuture,
		clampReason,
		asOf,
		urlStoreIds: linkStores,
		hrefFor,
		goTo,
	};
}
