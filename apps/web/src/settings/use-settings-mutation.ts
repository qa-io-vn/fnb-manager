import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { invalidateAnalytics } from "../data/invalidate-analytics";
import type { MessageKey } from "../i18n";
import { useReadyTenantScope } from "../state/tenant-scope";
import { invalidateSettings } from "./queries";
import { useSettingsSourceState } from "./settings-source-context";
import {
	type SettingsSource,
	type SettingsWriteCode,
	SettingsWriteError,
} from "./source";

export type SettingsWrite<Args> = (
	source: SettingsSource,
	tenantId: string,
	args: Args,
) => Promise<void>;

export function writeCodeOf(error: unknown): SettingsWriteCode {
	return error instanceof SettingsWriteError ? error.code : "network";
}

export const WRITE_ERROR_KEYS: Readonly<Record<SettingsWriteCode, MessageKey>> =
	{
		forbidden: "settings.error.forbidden",
		duplicate: "settings.error.duplicate",
		invalid: "settings.error.invalid",
		frozen: "settings.error.frozen",
		network: "settings.error.network",
	};

export function useSettingsMutation<Args>(write: SettingsWrite<Args>) {
	const queryClient = useQueryClient();
	const state = useSettingsSourceState();
	const { tenant } = useReadyTenantScope();
	const mutation = useMutation<void, unknown, Args>({
		mutationFn: async (args) => {
			if (state.status !== "ready") throw new SettingsWriteError("network");
			await write(state.source, tenant.id, args);
		},
		onSuccess: async () => {
			await Promise.all([
				invalidateSettings(queryClient, tenant.id),
				invalidateAnalytics(queryClient, tenant.id),
			]);
		},
	});
	const save = useCallback(
		(args: Args) =>
			mutation.mutateAsync(args).then(
				() => true,
				() => false,
			),
		[mutation],
	);
	return {
		save,
		saving: mutation.isPending,
		saved: mutation.isSuccess,
		errorCode: mutation.isError ? writeCodeOf(mutation.error) : null,
		errorConstraint:
			mutation.isError && mutation.error instanceof SettingsWriteError
				? mutation.error.constraint
				: null,
		reset: mutation.reset,
	};
}
