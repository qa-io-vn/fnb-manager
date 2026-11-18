import { RestError } from "@fnb/zalo-mini";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeData, HomeQuery, HomeSource } from "./source";

export const HOME_REFRESH_MS = 5 * 60_000;
export const HOME_STALE_MS = 60_000;

export type HomeLoad =
	| { readonly status: "loading" }
	| {
			readonly status: "ready";
			readonly data: HomeData;
			readonly refreshFailed: boolean;
	  }
	| { readonly status: "failed"; readonly httpStatus: number | null };

export interface HomeDataValue {
	readonly load: HomeLoad;
	reload(): void;
}

export function useHomeData(
	source: HomeSource,
	query: HomeQuery,
): HomeDataValue {
	const [load, setLoad] = useState<HomeLoad>({ status: "loading" });
	const generation = useRef(0);
	const loadedAt = useRef(0);

	const reload = useCallback(() => {
		generation.current += 1;
		const current = generation.current;
		setLoad((previous) =>
			previous.status === "failed" ? { status: "loading" } : previous,
		);
		source.load(query, new Date()).then(
			(data) => {
				if (generation.current !== current) return;
				loadedAt.current = Date.now();
				setLoad({ status: "ready", data, refreshFailed: false });
			},
			(error: unknown) => {
				if (generation.current !== current) return;
				setLoad((previous) =>
					previous.status === "ready"
						? { ...previous, refreshFailed: true }
						: {
								status: "failed",
								httpStatus: error instanceof RestError ? error.status : null,
							},
				);
			},
		);
	}, [source, query]);

	useEffect(() => {
		reload();
		const timer = setInterval(reload, HOME_REFRESH_MS);
		const onVisible = () => {
			if (
				document.visibilityState === "visible" &&
				Date.now() - loadedAt.current > HOME_STALE_MS
			) {
				reload();
			}
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			generation.current += 1;
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [reload]);

	return { load, reload };
}
