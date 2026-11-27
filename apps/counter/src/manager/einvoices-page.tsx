import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup, StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { clockOf, dayAndClock } from "../lib/time";
import {
	attentionCount,
	EINVOICE_FILTERS,
	type EInvoiceFilter,
	errorClassKey,
	type ManagerEInvoice,
	managerEInvoices,
	retryable,
	retryEInvoice,
} from "../orders/einvoice";
import { button, card, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";

// Quản lý → Hóa đơn điện tử (ADR-069; native-till.md 17.6): the store's e-invoices that failed (retrying or given up),
// those waiting, or all, newest attempt first, with the counts, the error class in words and the attempts; "Thử lại"
// queues a failed one again (manager_retry_einvoice: a fresh round, asking the provider first). Error classes only,
// never a buyer's data. Owners and managers of the store only: the database refuses staff.

/** The counts for the managers' badges (one small read, every minute). */
export function useEInvoiceCounts(enabled = true) {
	const { client } = useSession();
	const { store } = useStore();
	return useQuery({
		queryKey: ["einvoices", store.id, "counts"],
		queryFn: () => managerEInvoices(client, store.id, "failing", 1),
		refetchInterval: 60_000,
		retry: (count, error) =>
			!(error instanceof RpcError && error.forbidden) && count < 1,
		enabled,
	});
}

/** How many e-invoices need a manager (retrying or given up), for the badges where the other counts show. */
export function useEInvoiceAttention(enabled: boolean): number {
	return attentionCount(useEInvoiceCounts(enabled).data);
}

function stateTone(invoice: ManagerEInvoice) {
	if (invoice.state === "failed")
		return invoice.gave_up_at === null ? "warning" : "negative";
	if (invoice.state === "issued") return "positive";
	return "neutral";
}

function Row({
	invoice,
	busy,
	onRetry,
}: {
	readonly invoice: ManagerEInvoice;
	readonly busy: boolean;
	readonly onRetry: () => void;
}) {
	const { t } = useI18n();
	const order = invoice.display_no ?? "";
	return (
		<li
			className={`${card} flex flex-col gap-2 p-4 md:flex-row md:items-center`}
			data-testid="einvoice-row"
			data-state={invoice.state}
			data-invoice={invoice.id}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="flex flex-wrap items-center gap-2">
					<span className="font-extrabold">
						{t("einvoices.order", {
							order,
							date: invoice.business_date.split("-").reverse().join("/"),
						})}
					</span>
					<span className="text-sm text-ink-muted">
						{t(`einvoices.kind.${invoice.kind}`)}
					</span>
					<StatusPill tone={stateTone(invoice)} testId="einvoice-row-state">
						{invoice.state === "failed" && invoice.gave_up_at !== null
							? t("einvoices.state.gaveUp")
							: t(`einvoices.state.${invoice.state}`)}
					</StatusPill>
				</p>
				{invoice.last_error_class === null ? null : (
					<p className="text-sm" data-testid="einvoice-row-error">
						{t("einvoices.lastError", {
							error: t(errorClassKey(invoice.last_error_class)),
						})}{" "}
						· {t("einvoices.attempts", { count: invoice.attempts })}
					</p>
				)}
				<p className="text-sm text-ink-muted">
					{invoice.gave_up_at !== null
						? t("einvoices.gaveUpAt", { time: dayAndClock(invoice.gave_up_at) })
						: invoice.next_attempt_at !== null
							? t("einvoices.nextAttempt", {
									time: clockOf(invoice.next_attempt_at),
								})
							: t("einvoices.queuedAt", {
									time: dayAndClock(
										invoice.last_attempt_at ?? invoice.queued_at,
									),
								})}
					{invoice.request_status === null
						? null
						: ` · ${t("einvoices.request", {
								status: t(`einvoice.requestStatus.${invoice.request_status}`),
							})}`}
				</p>
			</div>
			{retryable(invoice) ? (
				<button
					type="button"
					className={`${button.secondary} md:w-auto`}
					disabled={busy}
					aria-busy={busy}
					aria-label={t("einvoices.retryLabel", { order })}
					onClick={onRetry}
					data-testid="einvoice-retry"
				>
					{t("einvoices.retry")}
				</button>
			) : null}
		</li>
	);
}

export function EInvoicesPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { show } = useToast();
	const queryClient = useQueryClient();
	const [filter, setFilter] = useState<EInvoiceFilter>("failing");
	const [retrying, setRetrying] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const list = useQuery({
		queryKey: ["einvoices", store.id, filter],
		queryFn: () => managerEInvoices(client, store.id, filter, 100),
		refetchInterval: 30_000,
	});
	const retry = (invoice: ManagerEInvoice) => {
		setRetrying(invoice.id);
		setMessage(null);
		retryEInvoice(client, invoice.id).then(
			(answer) => {
				setRetrying(null);
				if (answer.state === "queued")
					show(t("einvoices.retried", { order: invoice.display_no ?? "" }));
				else setMessage(t("einvoices.notFailed"));
				void queryClient.invalidateQueries({
					queryKey: ["einvoices", store.id],
				});
			},
			(error: unknown) => {
				setRetrying(null);
				setMessage(
					t(
						error instanceof RpcError && error.forbidden
							? "common.forbidden"
							: error instanceof RpcError && error.network
								? "common.network"
								: "common.failed",
					),
				);
			},
		);
	};
	const data = list.data;
	return (
		<div
			className="mx-auto flex max-w-5xl flex-col gap-4"
			data-testid="einvoices-page"
		>
			<PageTitle>{t("einvoices.title")}</PageTitle>
			{data === undefined ? (
				list.isError ? (
					<PlainNote tone="negative" testId="einvoices-failed">
						{t(
							list.error instanceof RpcError && list.error.forbidden
								? "manager.only"
								: "common.failed",
						)}
					</PlainNote>
				) : (
					<Loading label={t("app.loading")} />
				)
			) : (
				<>
					<dl
						className="grid grid-cols-2 gap-3 md:grid-cols-4"
						data-testid="einvoices-counts"
					>
						{(
							[
								["failing", data.failing],
								["gaveUp", data.gave_up],
								["pending", data.pending],
								["emailsFailing", data.emails_failing],
							] as const
						).map(([key, value]) => (
							<div key={key} className={`${card} flex flex-col gap-1 p-4`}>
								<dt className="text-sm font-bold text-ink-muted">
									{t(`einvoices.${key}`)}
								</dt>
								<dd
									className="text-[19px] font-bold"
									data-testid={`einvoices-count-${key}`}
								>
									{value}
								</dd>
							</div>
						))}
					</dl>
					<div className="-mx-4">
						<ChipGroup
							label={t("einvoices.filters")}
							chips={EINVOICE_FILTERS.map((key) => ({
								key,
								label: t(`einvoices.filter.${key}`),
							}))}
							selected={filter}
							onSelect={(key) => setFilter(key as EInvoiceFilter)}
							testId="einvoices-filter"
						/>
					</div>
					{message === null ? null : (
						<PlainNote tone="warning" testId="einvoices-message">
							{message}
						</PlainNote>
					)}
					{data.invoices.length === 0 ? (
						<PlainNote testId="einvoices-empty">
							{t(`einvoices.empty.${filter}`)}
						</PlainNote>
					) : (
						<ul className="flex flex-col gap-3" data-testid="einvoices-list">
							{data.invoices.map((invoice) => (
								<Row
									key={invoice.id}
									invoice={invoice}
									busy={retrying === invoice.id}
									onRetry={() => retry(invoice)}
								/>
							))}
						</ul>
					)}
					<p className="text-sm text-ink-muted">{t("einvoices.privacy")}</p>
				</>
			)}
		</div>
	);
}
