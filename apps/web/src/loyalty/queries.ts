import type { IsoDate } from "@fnb/reports";
import {
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useSettingsSourceState } from "../settings/settings-source-context";
import {
	type SettingsWriteCode,
	SettingsWriteError,
	writeCodeOf,
} from "../settings/source";
import { useReadyTenantScope } from "../state/tenant-scope";
import type {
	CustomerSource,
	MemberCursor,
	MemberPage,
	MemberRow,
} from "./source";

export const LOYALTY_QUERY_ROOT = "loyalty";
export const MEMBER_PAGE_SIZE = 100;

export type LoyaltyRead =
	| "members"
	| "member"
	| "ledger"
	| "queue"
	| "anomalies"
	| "requests"
	| "due";

export function loyaltyQueryKey(
	tenantId: string,
	read: LoyaltyRead,
	...parts: readonly (string | number)[]
) {
	return [LOYALTY_QUERY_ROOT, tenantId, read, ...parts] as const;
}

export async function invalidateLoyalty(
	queryClient: QueryClient,
	tenantId: string,
): Promise<void> {
	await queryClient.invalidateQueries({
		predicate: (query) =>
			query.queryKey[0] === LOYALTY_QUERY_ROOT &&
			query.queryKey[1] === tenantId,
	});
}

export type CustomerSourceState =
	| { readonly status: "loading" }
	| { readonly status: "failed" }
	| { readonly status: "unavailable" }
	| { readonly status: "ready"; readonly source: CustomerSource };

export function useCustomerSource(): CustomerSourceState {
	const state = useSettingsSourceState();
	if (state.status === "loading") return { status: "loading" };
	if (state.status === "failed") return { status: "failed" };
	const customers = state.customers;
	return customers === undefined || customers === null
		? { status: "unavailable" }
		: { status: "ready", source: customers };
}

export function useCustomerRead<T>(
	read: LoyaltyRead,
	parts: readonly (string | number)[],
	load: (source: CustomerSource, tenantId: string) => Promise<T>,
	enabled = true,
) {
	const state = useCustomerSource();
	const { tenant } = useReadyTenantScope();
	const source = state.status === "ready" ? state.source : null;
	return useQuery({
		queryKey: loyaltyQueryKey(tenant.id, read, ...parts),
		queryFn: () => {
			if (source === null) throw new Error("customer source not ready");
			return load(source, tenant.id);
		},
		enabled: source !== null && enabled,
	});
}

function storesPart(storeIds: readonly string[]): string {
	return [...storeIds].sort().join(",");
}

/**
 * The stores whose ledger rows make a member's balance: every store of the
 * tenant in the caller's scope (the members list is tenant-wide).
 */
function useScopeStoreIds(): readonly string[] {
	const { stores } = useReadyTenantScope();
	return stores.map((store) => store.id);
}

export function useMemberPages(enabled = true) {
	const state = useCustomerSource();
	const { tenant } = useReadyTenantScope();
	const storeIds = useScopeStoreIds();
	const source = state.status === "ready" ? state.source : null;
	return useInfiniteQuery({
		queryKey: loyaltyQueryKey(
			tenant.id,
			"members",
			storesPart(storeIds),
			MEMBER_PAGE_SIZE,
		),
		initialPageParam: null as MemberCursor | null,
		queryFn: async ({ pageParam }): Promise<MemberPage> => {
			if (source === null) throw new Error("customer source not ready");
			return source.members(storeIds, pageParam, MEMBER_PAGE_SIZE);
		},
		getNextPageParam: (last) => last.next,
		enabled: source !== null && enabled,
	});
}

export function useMember(membershipId: string) {
	const storeIds = useScopeStoreIds();
	return useCustomerRead(
		"member",
		[membershipId, storesPart(storeIds)],
		(source) => source.member(storeIds, membershipId),
	);
}

export function useMemberLedger(membershipId: string) {
	return useCustomerRead("ledger", [membershipId], (source) =>
		source.ledger([membershipId]),
	);
}

export function useQueue(enabled: boolean) {
	return useCustomerRead(
		"queue",
		[],
		(source, tenantId) => source.queue(tenantId),
		enabled,
	);
}

export function useAnomalies(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
	enabled = true,
) {
	return useCustomerRead(
		"anomalies",
		[storesPart(storeIds), from, to],
		(source) => source.anomalies(storeIds, from, to),
		enabled,
	);
}

export function useMemberLookup() {
	const state = useCustomerSource();
	const { tenant } = useReadyTenantScope();
	return useMutation<MemberRow[], unknown, string>({
		mutationFn: async (phone) => {
			if (state.status !== "ready") throw new SettingsWriteError("network");
			return state.source.lookup(tenant.id, phone);
		},
	});
}

export interface LoyaltyAction<Args, Result> {
	readonly run: (args: Args) => Promise<Result | null>;
	readonly running: boolean;
	readonly result: Result | null;
	readonly errorCode: SettingsWriteCode | null;
	readonly canRetry: boolean;
	readonly retry: () => Promise<Result | null>;
	readonly reset: () => void;
}

export function useLoyaltyAction<Args, Result>(
	perform: (source: CustomerSource, args: Args) => Promise<Result>,
): LoyaltyAction<Args, Result> {
	const queryClient = useQueryClient();
	const state = useCustomerSource();
	const { tenant } = useReadyTenantScope();
	const lastArgs = useRef<{ readonly args: Args } | null>(null);
	const mutation = useMutation<Result, unknown, Args>({
		mutationFn: async (args) => {
			lastArgs.current = { args };
			if (state.status !== "ready") throw new SettingsWriteError("network");
			return perform(state.source, args);
		},
		onSettled: async () => {
			await invalidateLoyalty(queryClient, tenant.id);
		},
	});
	const run = useCallback(
		(args: Args) =>
			mutation.mutateAsync(args).then(
				(result) => result,
				() => null,
			),
		[mutation],
	);
	const errorCode = mutation.isError ? writeCodeOf(mutation.error) : null;
	const retry = useCallback(() => {
		const last = lastArgs.current;
		return last === null ? Promise.resolve(null) : run(last.args);
	}, [run]);
	return {
		run,
		running: mutation.isPending,
		result: mutation.isSuccess ? mutation.data : null,
		errorCode,
		canRetry: errorCode === "network",
		retry,
		reset: mutation.reset,
	};
}
