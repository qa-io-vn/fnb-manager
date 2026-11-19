import type { LoyaltyClient, MemberCode } from "@fnb/zalo-mini/loyalty";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCustomerData } from "../data/customer-data";
import type { Failure } from "../data/source";

export const TICK_MS = 1000;
export const RETRY_MS = 5000;

export type CodeStatus = "fresh" | "refreshing" | "expired";

export function codeStatus(code: MemberCode, now: number): CodeStatus {
	if (now >= code.expiresAt) return "expired";
	return now >= code.refreshAt ? "refreshing" : "fresh";
}

export function secondsUntil(at: number, now: number): number {
	return Math.max(0, Math.ceil((at - now) / 1000));
}

export interface MemberCodeState {
	readonly code: MemberCode | null;
	readonly loading: boolean;
	readonly failure: Failure | null;
	readonly now: number;
	retry(): void;
}

export function useMemberCode(
	store: string | null,
	clock: () => number = Date.now,
): MemberCodeState {
	const { client, recover } = useCustomerData();
	const [code, setCode] = useState<MemberCode | null>(null);
	const [loading, setLoading] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const [now, setNow] = useState(clock);
	const generation = useRef(0);

	const fetchCode = useCallback(
		(active: LoyaltyClient, forStore: string) => {
			generation.current += 1;
			const current = generation.current;
			setLoading(true);
			active.memberCode(forStore).then(
				(next) => {
					if (generation.current !== current) return;
					setCode(next);
					setFailure(null);
					setLoading(false);
					setNow(clock());
				},
				(error: unknown) => {
					if (generation.current !== current) return;
					setFailure(recover(error));
					setLoading(false);
					setNow(clock());
				},
			);
		},
		[recover, clock],
	);

	useEffect(() => {
		setCode(null);
		setFailure(null);
		if (client === null || store === null) return;
		fetchCode(client, store);
		return () => {
			generation.current += 1;
		};
	}, [client, store, fetchCode]);

	useEffect(() => {
		const timer = setInterval(() => setNow(clock()), TICK_MS);
		return () => clearInterval(timer);
	}, [clock]);

	useEffect(() => {
		if (client === null || store === null || code === null || loading) return;
		const due = failure === null ? code.refreshAt : clock() + RETRY_MS;
		const timer = setTimeout(
			() => fetchCode(client, store),
			Math.max(0, due - clock()),
		);
		return () => clearTimeout(timer);
	}, [client, store, code, loading, failure, fetchCode, clock]);

	const retry = useCallback(() => {
		if (client !== null && store !== null) fetchCode(client, store);
	}, [client, store, fetchCode]);

	return { code, loading, failure, now, retry };
}
