import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { invalidateAnalytics } from "../data/invalidate-analytics";
import type { MessageKey } from "../i18n";
import { useReadyTenantScope } from "../state/tenant-scope";
import { useCatchUpRunner } from "./catch-up/catch-up-context";
import type { ManualSettingsSource } from "./manual/source";
import { invalidateSettings } from "./queries";
import { useSettingsSourceState } from "./settings-source-context";
import {
	type SettingsSource,
	type SettingsWriteCode,
	SettingsWriteError,
	writeCodeOf,
} from "./source";

export type SettingsWrite<Args> = (
	source: SettingsSource,
	tenantId: string,
	args: Args,
	manual: ManualSettingsSource,
) => Promise<unknown>;

export const WRITE_ERROR_KEYS: Readonly<Record<SettingsWriteCode, MessageKey>> =
	{
		forbidden: "settings.error.forbidden",
		duplicate: "settings.error.duplicate",
		invalid: "settings.error.invalid",
		frozen: "settings.error.frozen",
		network: "settings.error.network",
	};

export const CONSTRAINT_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
	stores_code_unique_in_tenant: "settings.store.code.duplicate",
	stores_opening_hours_valid: "settings.store.hours.invalid",
};

export function writeErrorKey(
	code: SettingsWriteCode,
	constraint: string | null,
	touchedOpeningHours = false,
): MessageKey {
	if (code === "forbidden" && touchedOpeningHours) {
		return "settings.store.hours.ownerOnly";
	}
	if (code === "frozen") return "settings.legal.frozen";
	if (
		(code === "duplicate" || code === "invalid") &&
		constraint !== null &&
		Object.hasOwn(CONSTRAINT_MESSAGE_KEYS, constraint)
	) {
		return CONSTRAINT_MESSAGE_KEYS[constraint] as MessageKey;
	}
	return WRITE_ERROR_KEYS[code];
}

export interface SettingsMutationOptions<Args> {
	readonly touchesMappings?: boolean;
	readonly touchesOpeningHours?: (args: Args) => boolean;
}

export function useSettingsMutation<Args>(
	write: SettingsWrite<Args>,
	{
		touchesMappings = false,
		touchesOpeningHours,
	}: SettingsMutationOptions<Args> = {},
) {
	const queryClient = useQueryClient();
	const state = useSettingsSourceState();
	const { tenant } = useReadyTenantScope();
	const { start: startCatchUp } = useCatchUpRunner();
	const lastArgs = useRef<{ readonly args: Args } | null>(null);
	const mutation = useMutation<void, unknown, Args>({
		mutationFn: async (args) => {
			lastArgs.current = { args };
			if (state.status !== "ready") throw new SettingsWriteError("network");
			await write(state.source, tenant.id, args, state.manual);
		},
		onSuccess: async () => {
			await Promise.all([
				invalidateSettings(queryClient, tenant.id),
				invalidateAnalytics(queryClient, tenant.id),
			]);
			if (touchesMappings && state.status === "ready") {
				startCatchUp(state.source);
			}
		},
		onError: async () => {
			if (!touchesMappings) return;
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
	const errorCode = mutation.isError ? writeCodeOf(mutation.error) : null;
	const errorConstraint =
		mutation.isError && mutation.error instanceof SettingsWriteError
			? mutation.error.constraint
			: null;
	const failedArgs = mutation.isError ? mutation.variables : undefined;
	const retry = useCallback(() => {
		const last = lastArgs.current;
		return last === null ? Promise.resolve(false) : save(last.args);
	}, [save]);
	return {
		save,
		saving: mutation.isPending,
		saved: mutation.isSuccess,
		errorCode,
		errorConstraint,
		errorKey:
			errorCode === null
				? null
				: writeErrorKey(
						errorCode,
						errorConstraint,
						failedArgs !== undefined &&
							touchesOpeningHours?.(failedArgs) === true,
					),
		canRetry: errorCode === "network",
		retry,
		reset: mutation.reset,
	};
}
