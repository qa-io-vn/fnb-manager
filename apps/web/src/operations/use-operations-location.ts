import type { IsoDate, ReportRange } from "@fnb/reports";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { StoreRow } from "../data/row-source";
import { useReadyTenantScope } from "../state/tenant-scope";
import {
	type OperationsFilters,
	type OperationsPage,
	operationsHref,
	operationsToday,
	parseOperationsSearch,
} from "./operations-route";

export interface OperationsLocation {
	readonly page: OperationsPage;
	readonly range: ReportRange;
	readonly stores: readonly StoreRow[];
	readonly filters: OperationsFilters;
	readonly rangeClamped: boolean;
	readonly todayClamped: boolean;
	readonly invalid: boolean;
	readonly hrefFor: (page: OperationsPage) => string;
	readonly goTo: (
		range: ReportRange,
		options?: { readonly replace?: boolean },
	) => void;
	readonly updateFilters: (change: OperationsFilters) => void;
}

function clockKey(stores: readonly StoreRow[]): string {
	return stores
		.map((store) => `${store.timeZone}|${store.businessDayStartMinutes}`)
		.join(",");
}

function useOperationsToday(stores: readonly StoreRow[]): IsoDate {
	const key = clockKey(stores);
	const compute = useCallback(
		() =>
			operationsToday(
				key === ""
					? []
					: key.split(",").map((entry) => {
							const [timeZone = "UTC", minutes = "0"] = entry.split("|");
							return { timeZone, businessDayStartMinutes: Number(minutes) };
						}),
				new Date(),
			),
		[key],
	);
	const [today, setToday] = useState(compute);
	useEffect(() => {
		setToday(compute());
		const refresh = () => {
			if (document.visibilityState === "visible") setToday(compute());
		};
		document.addEventListener("visibilitychange", refresh);
		return () => document.removeEventListener("visibilitychange", refresh);
	}, [compute]);
	return today;
}

export function useOperationsLocation(
	page: OperationsPage,
): OperationsLocation {
	const scope = useReadyTenantScope();
	const [search, setSearch] = useSearchParams();
	const navigate = useNavigate();
	const stores = scope.selectedStores;
	const today = useOperationsToday(stores);
	const searchKey = search.toString();
	const allIds = useMemo(
		() => scope.stores.map((store) => store.id),
		[scope.stores],
	);
	const parsed = useMemo(
		() => parseOperationsSearch(new URLSearchParams(searchKey), today, allIds),
		[searchKey, today, allIds],
	);
	const { selectStores } = scope;
	const linkedStores = parsed.storeIds;
	const handledSearch = useRef<string | null>(null);
	useEffect(() => {
		if (handledSearch.current === searchKey) return;
		handledSearch.current = searchKey;
		if (linkedStores !== null) selectStores([...linkedStores]);
		if (parsed.normalised) setSearch(parsed.canonical, { replace: true });
	}, [
		searchKey,
		linkedStores,
		parsed.normalised,
		parsed.canonical,
		selectStores,
		setSearch,
	]);
	const range = parsed.resolved.range;
	const filters = parsed.filters;
	const goTo = useCallback(
		(next: ReportRange, options?: { readonly replace?: boolean }) =>
			navigate(operationsHref(page, next, filters), {
				replace: options?.replace ?? false,
			}),
		[navigate, page, filters],
	);
	const latestFilters = useRef({ searchKey, filters });
	if (latestFilters.current.searchKey !== searchKey) {
		latestFilters.current = { searchKey, filters };
	}
	const updateFilters = useCallback(
		(change: OperationsFilters) => {
			const next = Object.fromEntries(
				Object.entries({ ...latestFilters.current.filters, ...change }).filter(
					([, value]) => value !== undefined && value !== "",
				),
			) as OperationsFilters;
			latestFilters.current = { ...latestFilters.current, filters: next };
			navigate(operationsHref(page, range, next), { replace: true });
		},
		[navigate, page, range],
	);
	const hrefFor = useCallback(
		(target: OperationsPage) => operationsHref(target, range),
		[range],
	);
	return {
		page,
		range,
		stores,
		filters,
		rangeClamped: parsed.resolved.rangeClamped,
		todayClamped: parsed.resolved.todayClamped,
		invalid: parsed.resolved.invalid,
		hrefFor,
		goTo,
		updateFilters,
	};
}
