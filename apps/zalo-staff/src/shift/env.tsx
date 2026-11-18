import {
	isSessionFresh,
	type OpsClient,
	type StoredSession,
} from "@fnb/zalo-mini";
import { useI18n, useSession } from "@fnb/zalo-mini/react";
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
import { createHomeFormatters, type HomeFormatters } from "../home/format";
import { canManage, type Failure, failureOf } from "./model";
import type { ShiftContext, ShiftStore } from "./source";

export interface ShiftEnv {
	readonly ops: OpsClient;
	readonly context: ShiftContext;
	readonly store: ShiftStore;
	readonly memberId: string | null;
	readonly manager: boolean;
	readonly formatters: HomeFormatters;
	recover(error: unknown): Failure;
}

const ShiftEnvContext = createContext<ShiftEnv | null>(null);

export function useShiftEnv(): ShiftEnv {
	const env = useContext(ShiftEnvContext);
	if (env === null) throw new Error("useShiftEnv needs a ShiftEnvProvider");
	return env;
}

export function useRecover(
	session: StoredSession,
): (error: unknown) => Failure {
	const { retry, expire } = useSession();
	return useCallback(
		(error: unknown) => {
			const failure = failureOf(error);
			if (failure === "session") {
				if (isSessionFresh(session, Date.now())) expire();
				else retry();
			}
			return failure;
		},
		[session, retry, expire],
	);
}

export function useFormatters(context: ShiftContext): HomeFormatters {
	const { t, language } = useI18n();
	const million = t("home.money.million");
	const billion = t("home.money.billion");
	return useMemo(
		() =>
			createHomeFormatters({
				currencyCode: context.currencyCode,
				language,
				timeZone: context.timeZone,
				million,
				billion,
			}),
		[context.currencyCode, context.timeZone, language, million, billion],
	);
}

export function ShiftEnvProvider({
	ops,
	context,
	store,
	recover,
	children,
}: {
	readonly ops: OpsClient;
	readonly context: ShiftContext;
	readonly store: ShiftStore;
	readonly recover: (error: unknown) => Failure;
	readonly children: ReactNode;
}) {
	const formatters = useFormatters(context);
	const value = useMemo<ShiftEnv>(
		() => ({
			ops,
			context,
			store,
			memberId: ops.memberId,
			manager: canManage(context.role),
			formatters,
			recover,
		}),
		[ops, context, store, formatters, recover],
	);
	return (
		<ShiftEnvContext.Provider value={value}>
			{children}
		</ShiftEnvContext.Provider>
	);
}

export type ActionResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly failure: Failure };

export interface Action {
	readonly busy: boolean;
	readonly failure: Failure | null;
	run<T>(work: () => Promise<T>): Promise<ActionResult<T>>;
	clear(): void;
}

export function useAction(): Action {
	const { recover } = useShiftEnv();
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const run = useCallback(
		async <T,>(work: () => Promise<T>): Promise<ActionResult<T>> => {
			setBusy(true);
			setFailure(null);
			try {
				const value = await work();
				if (mounted.current) setBusy(false);
				return { ok: true, value };
			} catch (error) {
				const kind = recover(error);
				if (mounted.current) {
					setBusy(false);
					setFailure(kind);
				}
				return { ok: false, failure: kind };
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

export function failureKey(failure: Failure): string {
	switch (failure) {
		case "network":
			return "ops.error.network";
		case "not-allowed":
			return "ops.error.notAllowed";
		case "session":
			return "ops.error.session";
		default:
			return "ops.error.unknown";
	}
}
