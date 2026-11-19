import type { ReportRange } from "@fnb/reports";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { StoreRow } from "../data/row-source";
import {
	operationsSearch,
	operationsToday,
	parseOperationsSearch,
} from "../operations/operations-route";
import { useReadyTenantScope } from "../state/tenant-scope";
import { customerHref } from "./route";

export interface AnomalyLocation {
	readonly range: ReportRange;
	readonly stores: readonly StoreRow[];
	readonly rangeClamped: boolean;
	readonly invalid: boolean;
	readonly goTo: (
		range: ReportRange,
		options?: { readonly replace?: boolean },
	) => void;
}

export function anomalyHref(range: ReportRange): string {
	return customerHref("bat-thuong", operationsSearch(range));
}

export function useAnomalyLocation(): AnomalyLocation {
	const scope = useReadyTenantScope();
	const [search, setSearch] = useSearchParams();
	const navigate = useNavigate();
	const stores = scope.selectedStores;
	const clockKey = stores
		.map((store) => `${store.timeZone}|${store.businessDayStartMinutes}`)
		.join(",");
	const today = useMemo(
		() =>
			operationsToday(
				clockKey === ""
					? []
					: clockKey.split(",").map((entry) => {
							const [timeZone = "UTC", minutes = "0"] = entry.split("|");
							return { timeZone, businessDayStartMinutes: Number(minutes) };
						}),
				new Date(),
			),
		[clockKey],
	);
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
	const handled = useRef<string | null>(null);
	useEffect(() => {
		if (handled.current === searchKey) return;
		handled.current = searchKey;
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
	const goTo = useCallback(
		(next: ReportRange, options?: { readonly replace?: boolean }) =>
			navigate(anomalyHref(next), { replace: options?.replace ?? false }),
		[navigate],
	);
	return {
		range: parsed.resolved.range,
		stores,
		rangeClamped: parsed.resolved.rangeClamped,
		invalid: parsed.resolved.invalid,
		goTo,
	};
}
