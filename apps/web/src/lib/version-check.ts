import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 60_000;

export function buildIdOf(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const buildId = (body as { buildId?: unknown }).buildId;
	return typeof buildId === "string" && buildId !== "" ? buildId : null;
}

export async function fetchPublishedBuildId(): Promise<string | null> {
	try {
		const response = await fetch(
			`${import.meta.env.BASE_URL}version.json?at=${Date.now()}`,
			{ cache: "no-store" },
		);
		if (!response.ok) return null;
		return buildIdOf(await response.json());
	} catch {
		return null;
	}
}

export function useNewVersionAvailable(currentBuildId: string): boolean {
	const [available, setAvailable] = useState(false);

	useEffect(() => {
		let lastCheckedAt = 0;
		let disposed = false;
		const check = async () => {
			if (Date.now() - lastCheckedAt < CHECK_INTERVAL_MS) return;
			lastCheckedAt = Date.now();
			const published = await fetchPublishedBuildId();
			if (!disposed && published !== null && published !== currentBuildId) {
				setAvailable(true);
			}
		};
		const onVisible = () => {
			if (document.visibilityState === "visible") void check();
		};
		window.addEventListener("focus", onVisible);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			disposed = true;
			window.removeEventListener("focus", onVisible);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [currentBuildId]);

	return available;
}
