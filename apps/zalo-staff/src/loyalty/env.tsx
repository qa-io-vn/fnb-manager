import type { MemberRole } from "@fnb/zalo-mini";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { HomeFormatters } from "../home/format";
import type { ActionResult } from "../shift/env";
import type { Failure } from "../shift/model";
import type { ShiftContext, ShiftStore } from "../shift/source";
import type { LoyaltyClient } from "./contract";

export const LOYALTY_PATHS = {
	checkIn: "/ghi-nhan-khach",
	redeem: "/kiem-tra-uu-dai",
	lookup: "/tra-cuu-thanh-vien",
	queue: "/hang-cho-thanh-vien",
	requests: "/yeu-cau-cua-toi",
} as const;

export type LoyaltyPath = (typeof LOYALTY_PATHS)[keyof typeof LOYALTY_PATHS];

export interface LoyaltyOpen {
	readonly storeId: string | null;
	readonly membershipId: string | null;
}

export const NO_OPEN: LoyaltyOpen = { storeId: null, membershipId: null };

export function readLoyaltyOpen(state: unknown): LoyaltyOpen {
	if (typeof state !== "object" || state === null) return NO_OPEN;
	const open = (state as { readonly loyalty?: unknown }).loyalty;
	if (typeof open !== "object" || open === null) return NO_OPEN;
	const value = open as Readonly<Record<string, unknown>>;
	return {
		storeId: typeof value.storeId === "string" ? value.storeId : null,
		membershipId:
			typeof value.membershipId === "string" ? value.membershipId : null,
	};
}

export interface LoyaltyEnv {
	readonly client: LoyaltyClient;
	readonly context: ShiftContext;
	readonly store: ShiftStore;
	readonly role: MemberRole;
	readonly manager: boolean;
	readonly formatters: HomeFormatters;
	readonly sampleBadge: boolean;
	recover(error: unknown): Failure;
	selectStore(id: string): void;
	open(path: LoyaltyPath, membershipId?: string): void;
	home(): void;
}

const LoyaltyEnvContext = createContext<LoyaltyEnv | null>(null);

export function LoyaltyEnvProvider({
	value,
	children,
}: {
	readonly value: LoyaltyEnv;
	readonly children: ReactNode;
}) {
	return (
		<LoyaltyEnvContext.Provider value={value}>
			{children}
		</LoyaltyEnvContext.Provider>
	);
}

export function useLoyaltyEnv(): LoyaltyEnv {
	const env = useContext(LoyaltyEnvContext);
	if (env === null) throw new Error("useLoyaltyEnv needs a LoyaltyEnvProvider");
	return env;
}

export interface LoyaltyAction {
	readonly busy: boolean;
	readonly failure: Failure | null;
	run<T>(work: () => Promise<T>): Promise<ActionResult<T>>;
	clear(): void;
}

export function useLoyaltyAction(): LoyaltyAction {
	const { recover } = useLoyaltyEnv();
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const mounted = useRef(true);
	const running = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const run = useCallback(
		async <T,>(work: () => Promise<T>): Promise<ActionResult<T>> => {
			if (running.current) return { ok: false, failure: "duplicate" };
			running.current = true;
			setBusy(true);
			setFailure(null);
			try {
				const value = await work();
				return { ok: true, value };
			} catch (error) {
				const kind = recover(error);
				if (mounted.current) setFailure(kind);
				return { ok: false, failure: kind };
			} finally {
				running.current = false;
				if (mounted.current) setBusy(false);
			}
		},
		[recover],
	);
	const clear = useCallback(() => setFailure(null), []);
	return useMemo(
		() => ({ busy, failure, run, clear }),
		[busy, failure, run, clear],
	);
}
