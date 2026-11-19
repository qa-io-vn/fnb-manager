import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import {
	type SettingsWriteCode,
	SettingsWriteError,
	writeCodeOf,
} from "../settings/source";
import { useReadyTenantScope } from "../state/tenant-scope";
import { invalidateOperations, useOperationsSource } from "./queries";
import type { OperationsSource } from "./source";

export interface OperationsAction<Args> {
	readonly run: (args: Args) => Promise<boolean>;
	readonly running: boolean;
	readonly done: boolean;
	readonly errorCode: SettingsWriteCode | null;
	readonly canRetry: boolean;
	readonly retry: () => Promise<boolean>;
	readonly reset: () => void;
}

export function useOperationsAction<Args>(
	perform: (source: OperationsSource, args: Args) => Promise<unknown>,
): OperationsAction<Args> {
	const queryClient = useQueryClient();
	const state = useOperationsSource();
	const { tenant } = useReadyTenantScope();
	const lastArgs = useRef<{ readonly args: Args } | null>(null);
	const mutation = useMutation<void, unknown, Args>({
		mutationFn: async (args) => {
			lastArgs.current = { args };
			if (state.status !== "ready") throw new SettingsWriteError("network");
			await perform(state.source, args);
		},
		onSettled: async () => {
			await invalidateOperations(queryClient, tenant.id);
		},
	});
	const run = useCallback(
		(args: Args) =>
			mutation.mutateAsync(args).then(
				() => true,
				() => false,
			),
		[mutation],
	);
	const errorCode = mutation.isError ? writeCodeOf(mutation.error) : null;
	const retry = useCallback(() => {
		const last = lastArgs.current;
		return last === null ? Promise.resolve(false) : run(last.args);
	}, [run]);
	return {
		run,
		running: mutation.isPending,
		done: mutation.isSuccess,
		errorCode,
		canRetry: errorCode === "network",
		retry,
		reset: mutation.reset,
	};
}
