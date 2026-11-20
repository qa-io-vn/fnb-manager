import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "../../components/ui/button";
import { type MessageKey, useT } from "../../i18n";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { SettingsWriteError } from "../source";
import { invalidateNotify } from "./queries";
import type { NotifySource } from "./source";
import { writeErrorKey } from "./words";

export function NotifySection({
	id,
	titleKey,
	children,
	testId,
}: {
	id: string;
	titleKey: MessageKey;
	children: ReactNode;
	testId: string;
}) {
	const t = useT();
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid={testId}
		>
			<h3 id={`${id}-heading`} className="text-lg font-semibold">
				{t(titleKey)}
			</h3>
			{children}
		</section>
	);
}

export function LoadState({
	failed,
	onRetry,
	testId,
}: {
	failed: boolean;
	onRetry: () => void;
	testId: string;
}) {
	const t = useT();
	if (!failed) {
		return (
			<p className="text-sm text-ink-muted" aria-busy="true">
				…
			</p>
		);
	}
	return (
		<div role="alert" className="space-y-2 text-sm" data-testid={testId}>
			<p>{t("settings.notify.loadFailed")}</p>
			<Button tone="secondary" size="compact" onClick={onRetry}>
				{t("settings.notify.retry")}
			</Button>
		</div>
	);
}

export function Note({
	children,
	testId,
	tone = "neutral",
}: {
	children: ReactNode;
	testId?: string;
	tone?: "neutral" | "warning";
}) {
	return (
		<p
			role="note"
			className={
				tone === "warning"
					? "rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm"
					: "rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
			}
			data-testid={testId}
		>
			{children}
		</p>
	);
}

export interface NotifyAction<A extends unknown[], R> {
	readonly run: (...args: A) => Promise<R | undefined>;
	readonly pending: boolean;
	readonly errorKey: MessageKey | null;
	readonly reset: () => void;
}

export function useNotifyAction<A extends unknown[], R>(
	source: NotifySource | null,
	action: (source: NotifySource, tenantId: string, ...args: A) => Promise<R>,
): NotifyAction<A, R> {
	const { tenant } = useReadyTenantScope();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);
	const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
	const run = useCallback(
		async (...args: A): Promise<R | undefined> => {
			if (source === null) return undefined;
			setPending(true);
			setErrorKey(null);
			try {
				const result = await action(source, tenant.id, ...args);
				await invalidateNotify(queryClient, source.kind, tenant.id);
				return result;
			} catch (error) {
				setErrorKey(
					error instanceof SettingsWriteError
						? writeErrorKey(error.code, error.constraint)
						: "settings.notify.error.network",
				);
				return undefined;
			} finally {
				setPending(false);
			}
		},
		[source, action, tenant.id, queryClient],
	);
	const reset = useCallback(() => setErrorKey(null), []);
	return { run, pending, errorKey, reset };
}

export function ErrorLine({
	errorKey,
	testId,
}: {
	errorKey: MessageKey | null;
	testId?: string;
}) {
	const t = useT();
	if (errorKey === null) return null;
	return (
		<p role="alert" className="text-sm text-negative" data-testid={testId}>
			{t(errorKey)}
		</p>
	);
}
