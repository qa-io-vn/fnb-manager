/**
 * Keeps the counter's screen on where the browser has the Screen Wake Lock API (Chrome on Android, Safari since 16.4):
 * asked after the first tap (a browser may refuse it before one) and again whenever the page comes back into view,
 * because the lock is dropped when the page is hidden. Without the API nothing happens: the tablet's own setting
 * decides.
 */
interface WakeLockSentinelLike {
	readonly released: boolean;
	release(): Promise<void>;
}

interface WakeLockLike {
	request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export function keepScreenOn(
	target: { readonly wakeLock?: WakeLockLike } = navigator as unknown as {
		wakeLock?: WakeLockLike;
	},
	page: Pick<Document, "addEventListener" | "visibilityState"> = document,
): () => void {
	const api = target.wakeLock;
	if (api === undefined) return () => undefined;
	let lock: WakeLockSentinelLike | null = null;
	const ask = () => {
		if (page.visibilityState !== "visible" || (lock !== null && !lock.released))
			return;
		api
			.request("screen")
			.then((sentinel) => {
				lock = sentinel;
			})
			.catch(() => undefined);
	};
	page.addEventListener("visibilitychange", ask);
	page.addEventListener("pointerdown", ask, { once: false, passive: true });
	ask();
	return () => {
		void lock?.release();
	};
}
