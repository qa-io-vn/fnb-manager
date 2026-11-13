import { asOfDate, type IsoDate, type StoreClock } from "@fnb/reports";
import { useCallback, useEffect, useState } from "react";

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
	const [asOf, setAsOf] = useState(compute);
	useEffect(() => {
		setAsOf(compute());
		const refresh = () => {
			if (document.visibilityState === "visible") setAsOf(compute());
		};
		document.addEventListener("visibilitychange", refresh);
		return () => document.removeEventListener("visibilitychange", refresh);
	}, [compute]);
	return asOf;
}
