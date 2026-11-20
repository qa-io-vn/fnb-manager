import { asOfDate, type IsoDate, type StoreClock } from "@fnb/reports";
import { useCallback, useEffect, useMemo, useState } from "react";

function clockKey(stores: readonly StoreClock[]): string {
	return stores
		.map((store) => `${store.timeZone}|${store.businessDayStartMinutes}`)
		.join(",");
}

export function useAsOf(stores: readonly StoreClock[]): IsoDate {
	const key = clockKey(stores);
	const compute = useCallback(
		() =>
			asOfDate(
				key === ""
					? []
					: key.split(",").map((entry) => {
							const [timeZone = "UTC", minutes = "0"] = entry.split("|");
							return {
								timeZone,
								businessDayStartMinutes: Number(minutes),
							};
						}),
				new Date(),
			),
		[key],
	);
	// The day is worked out in the same render as the stores it depends on. Setting it in an effect gave the first
	// render with the stores the day of the empty list (UTC), and a second fetch when the stores' own day differed.
	const [refreshes, setRefreshes] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshes only forces a new reading of the clock
	const asOf = useMemo(compute, [compute, refreshes]);
	useEffect(() => {
		const refresh = () => {
			if (document.visibilityState === "visible") {
				setRefreshes((count) => count + 1);
			}
		};
		document.addEventListener("visibilitychange", refresh);
		return () => document.removeEventListener("visibilitychange", refresh);
	}, []);
	return asOf;
}
