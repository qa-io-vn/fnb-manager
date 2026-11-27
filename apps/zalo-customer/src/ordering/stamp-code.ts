import type { OrderingClient, StampCode } from "@fnb/zalo-mini/ordering";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCustomerData } from "../data/customer-data";
import { useOnline } from "../data/offline";
import type { Failure } from "../data/source";

// C20 Mã thành viên (missing-screens README 5.9; native-till.md 16.5): the stamp card's member code of the Zalo
// account, a QR and an 8-digit number valid 10 minutes, asked again at its refresh time while online. Offline, the code
// already on the screen keeps showing until it expires, and then it says so (the number expires with the QR). The code
// lives in memory only, beside the session's client: never in storage, an address, a log or an analytics event.

export type CodePhase = "fresh" | "refreshing" | "expired";

/** fresh before its refresh time, refreshing from it, expired from its expiry (each boundary belongs to the next). */
export function codePhase(
	code: Pick<StampCode, "refreshAt" | "expiresAt">,
	now: number,
): CodePhase {
	if (now >= Date.parse(code.expiresAt)) return "expired";
	return now >= Date.parse(code.refreshAt) ? "refreshing" : "fresh";
}

/** The time left until an instant as "mm:ss" (never below 00:00), for "Mã làm mới sau 09:48". */
export function countdown(at: string, now: number): string {
	const seconds = Math.max(0, Math.ceil((Date.parse(at) - now) / 1000));
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whole minutes left until an instant, rounded up, never below 0 ("còn 7 phút"). */
export function minutesUntil(at: string, now: number): number {
	return Math.max(0, Math.ceil((Date.parse(at) - now) / 60_000));
}

/** How long to wait before asking again after a failed refresh. */
export const RETRY_MS = 5_000;

// the code shown last for a session's client, so coming back to the screen within its 10 minutes shows it again
// (offline too) instead of revoking it with a new one; a new session is a new client and finds nothing
const shown = new WeakMap<OrderingClient, StampCode>();

/** Forgets the code of a session (sign-out, deletion). */
export function forgetStampCode(client: OrderingClient | null): void {
	if (client !== null) shown.delete(client);
}

export type StampCodeState =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly code: StampCode }
	| {
			readonly status: "refused";
			readonly refusal: string;
			readonly retryAt: string | null;
	  }
	| { readonly status: "failed"; readonly failure: Failure };

export interface StampCodeValue {
	readonly state: StampCodeState;
	readonly now: number;
	readonly online: boolean;
	/** a refresh is on its way */
	readonly busy: boolean;
	/** the last refresh failed: the code on the screen is the one kept */
	readonly kept: boolean;
	refresh(): void;
}

export function useStampCode(
	client: OrderingClient | null,
	clock: () => number = Date.now,
): StampCodeValue {
	const { recover } = useCustomerData();
	const online = useOnline();
	const [state, setState] = useState<StampCodeState>(() => {
		const known = client === null ? undefined : shown.get(client);
		return known !== undefined && codePhase(known, clock()) !== "expired"
			? { status: "ready", code: known }
			: { status: "loading" };
	});
	const [busy, setBusy] = useState(false);
	const [kept, setKept] = useState(false);
	// a refusal (rate_limited, stamps_off) is not asked again by itself: the customer presses "Làm mới mã"
	const [stopped, setStopped] = useState(false);
	const [now, setNow] = useState(clock);
	const generation = useRef(0);

	const fetchCode = useCallback(() => {
		if (client === null) return;
		generation.current += 1;
		const current = generation.current;
		setBusy(true);
		client.stampCode().then(
			(answer) => {
				if (generation.current !== current) return;
				setBusy(false);
				setNow(clock());
				if (answer.state === "issued") {
					shown.set(client, answer.code);
					setKept(false);
					setStopped(false);
					setState({ status: "ready", code: answer.code });
				} else {
					setStopped(true);
					setState((previous) =>
						previous.status === "ready" &&
						codePhase(previous.code, clock()) !== "expired"
							? previous
							: {
									status: "refused",
									refusal: answer.refusal,
									retryAt: answer.retryAt,
								},
					);
					setKept(true);
				}
			},
			(error: unknown) => {
				if (generation.current !== current) return;
				const failure = recover(error);
				setBusy(false);
				setNow(clock());
				setKept(true);
				setState((previous) =>
					previous.status === "ready"
						? previous
						: { status: "failed", failure },
				);
			},
		);
	}, [client, recover, clock]);

	// the first code, unless one shown before is still good
	const started = useRef(false);
	useEffect(() => {
		if (started.current || client === null) return;
		started.current = true;
		if (state.status === "loading") fetchCode();
	}, [client, state.status, fetchCode]);

	useEffect(() => {
		const timer = setInterval(() => setNow(clock()), 1000);
		return () => {
			clearInterval(timer);
			generation.current += 1;
		};
	}, [clock]);

	// refresh at the code's refresh time while online; after a failure, again every few seconds
	const code = state.status === "ready" ? state.code : null;
	useEffect(() => {
		if (code === null || !online || busy || stopped) return;
		const due = kept ? clock() + RETRY_MS : Date.parse(code.refreshAt);
		const timer = setTimeout(fetchCode, Math.max(0, due - clock()));
		return () => clearTimeout(timer);
	}, [code, online, busy, kept, stopped, fetchCode, clock]);

	return { state, now, online, busy, kept, refresh: fetchCode };
}
