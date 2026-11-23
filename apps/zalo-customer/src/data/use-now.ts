import { useEffect, useState } from "react";

/**
 * The current time, read again every `tickMs`. It lives on its own so the wallet screen and the voucher screens can
 * share it without one importing the other: a screen that imports another screen pulls it into its own script and
 * undoes the route-level code splitting (the first-load budget and the lazy-screens check catch that).
 */
export function useNow(tickMs = 1000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), tickMs);
		return () => clearInterval(timer);
	}, [tickMs]);
	return now;
}
