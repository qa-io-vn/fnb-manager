import { useId, useState } from "react";
import { DataTable } from "../../components/report-card/data-table";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import type { LoyaltyAccess } from "../../loyalty/access";
import {
	candidatesInOrder,
	closedQueueItems,
	invoiceText,
	loyaltyCsvName,
	momentText,
	openQueueItems,
	PATH_KEYS,
	phoneText,
	QUEUE_REASON_KEYS,
	queueHistoryTable,
	REFUSAL_KEYS,
	RESOLUTION_REASON_MAX,
	type ResolutionIssue,
	resolutionIssue,
	type StoreName,
	storeName,
} from "../../loyalty/models";
import { useLoyaltyAction, useQueue } from "../../loyalty/queries";
import type {
	QueueItemRow,
	QueueOutcome,
	QueueResolution,
} from "../../loyalty/source";
import { controlClass, Field } from "../../settings/forms/field";
import { UNAVAILABLE_CLASS } from "../../settings/forms/save-bar";
import type { SettingsWriteCode } from "../../settings/source";
import { WRITE_ERROR_KEYS } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { CustomersLayout, Notice } from "./customers-layout";

const ISSUE_KEYS: Readonly<Record<ResolutionIssue, MessageKey>> = {
	choiceRequired: "loyalty.queue.error.choice",
	reasonRequired: "loyalty.queue.error.reason",
	reasonTooLong: "loyalty.queue.error.reasonLength",
};

function errorKeyOf(code: SettingsWriteCode): MessageKey {
	if (code === "forbidden") return "loyalty.queue.error.forbidden";
	if (code === "invalid") return "loyalty.queue.error.invalid";
	return WRITE_ERROR_KEYS[code];
}

function outcomeText(t: Translate, outcome: QueueOutcome): string {
	if (outcome.state === "dismissed") return t("loyalty.queue.done.dismissed");
	if (outcome.refusal !== null && outcome.entryId === null) {
		return t("loyalty.queue.done.refused", {
			reason: t(REFUSAL_KEYS[outcome.refusal]),
		});
	}
	return t("loyalty.queue.done.resolved");
}

function claimText(
	t: Translate,
	formatters: Formatters,
	timeZone: string,
	item: QueueItemRow,
): string {
	if (item.claim !== null) {
		return t("loyalty.queue.claim", {
			receipt: item.claim.receiptNo,
			amount: formatters.moneyExact(item.claim.amount),
			date: formatters.date(item.claim.businessDate),
		});
	}
	const recorded = momentText(
		formatters,
		timeZone,
		item.checkin?.recordedAt ?? null,
	);
	const amount = item.checkin?.amount ?? null;
	return amount === null
		? t("loyalty.queue.checkin", { time: recorded ?? "—" })
		: t("loyalty.queue.checkinAmount", {
				time: recorded ?? "—",
				amount: formatters.moneyExact(amount),
			});
}

function QueueItem({
	item,
	stores,
	canResolve,
	busy,
	onResolve,
}: {
	readonly item: QueueItemRow;
	readonly stores: readonly StoreName[];
	readonly canResolve: boolean;
	readonly busy: boolean;
	readonly onResolve: (resolution: QueueResolution) => void;
}) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const [choice, setChoice] = useState<string | null>(null);
	const [reason, setReason] = useState("");
	const [tried, setTried] = useState<"choose" | "dismiss" | null>(null);
	const issue =
		tried === null
			? null
			: resolutionIssue(choice, reason, tried === "dismiss");
	const heading = t("loyalty.queue.item", {
		store: storeName(t, stores, item.storeId),
		time: momentText(formatters, tenant.timeZone, item.createdAt) ?? "",
	});
	const submit = (dismiss: boolean) => {
		setTried(dismiss ? "dismiss" : "choose");
		if (busy || resolutionIssue(choice, reason, dismiss) !== null) return;
		onResolve({
			itemId: item.id,
			choice: dismiss ? null : choice,
			reason: reason.trim(),
		});
	};
	const candidates = candidatesInOrder(item);
	return (
		<li
			className="space-y-3 py-3"
			data-testid="loyalty-queue-item"
			data-path={item.matchedPath}
		>
			<h3 id={`${ids}-heading`} className="font-medium">
				{heading}
			</h3>
			<p className="text-sm text-ink-muted">
				{[
					t(PATH_KEYS[item.matchedPath]),
					t(QUEUE_REASON_KEYS[item.reason]),
					t("loyalty.queue.member", { phone: phoneText(t, item.phoneMasked) }),
				].join(" · ")}
			</p>
			<p className="text-sm" data-testid="loyalty-queue-claim">
				{claimText(t, formatters, tenant.timeZone, item)}
			</p>
			<fieldset
				className="min-w-0 space-y-2"
				aria-describedby={
					issue === "choiceRequired" ? `${ids}-issue` : undefined
				}
			>
				<legend className="text-sm font-medium">
					{t("loyalty.queue.candidates", {
						count: formatters.count(item.candidateIds.length),
					})}
				</legend>
				<ul className="space-y-1">
					{candidates.map((invoice) => {
						const label = t("loyalty.queue.candidate", {
							invoice:
								invoiceText(t, formatters, invoice) ?? invoice.externalId,
							time:
								momentText(formatters, tenant.timeZone, invoice.soldAt) ?? "",
							amount: formatters.moneyExact(invoice.netAmount),
						});
						return (
							<li key={invoice.id}>
								{canResolve ? (
									<label className="flex min-h-11 items-center gap-2 text-sm">
										<input
											type="radio"
											name={`${ids}-choice`}
											value={invoice.id}
											checked={choice === invoice.id}
											onChange={() => setChoice(invoice.id)}
											className="size-5"
											data-testid="loyalty-queue-candidate"
										/>
										<span>{label}</span>
									</label>
								) : (
									<span className="text-sm">{label}</span>
								)}
							</li>
						);
					})}
				</ul>
			</fieldset>
			{canResolve ? (
				<>
					<Field
						id={`${ids}-reason`}
						label={t("loyalty.queue.reason.label")}
						hint={t("loyalty.queue.reason.hint", {
							max: formatters.count(RESOLUTION_REASON_MAX),
						})}
						error={
							issue === "reasonRequired" || issue === "reasonTooLong"
								? t(ISSUE_KEYS[issue])
								: null
						}
					>
						{(control) => (
							<textarea
								{...control}
								rows={2}
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								className={cn(controlClass, "py-2")}
								data-testid="loyalty-queue-reason"
							/>
						)}
					</Field>
					{issue === "choiceRequired" ? (
						<p id={`${ids}-issue`} className="text-sm text-negative">
							{t(ISSUE_KEYS[issue])}
						</p>
					) : null}
					<div className="flex flex-wrap gap-2">
						<Button
							size="compact"
							aria-disabled={busy || undefined}
							onClick={() => submit(false)}
							className={UNAVAILABLE_CLASS}
							aria-label={t("loyalty.queue.chooseLabel", { item: heading })}
							data-testid="loyalty-queue-choose"
						>
							{t("loyalty.queue.choose")}
						</Button>
						<Button
							tone="secondary"
							size="compact"
							aria-disabled={busy || undefined}
							onClick={() => submit(true)}
							className={UNAVAILABLE_CLASS}
							aria-label={t("loyalty.queue.dismissLabel", { item: heading })}
							data-testid="loyalty-queue-dismiss"
						>
							{t("loyalty.queue.dismiss")}
						</Button>
					</div>
				</>
			) : null}
		</li>
	);
}

function QueueBody({ access }: { readonly access: LoyaltyAccess }) {
	const t = useT();
	const ids = useId();
	const { tenant, stores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const queue = useQueue(access.canResolve);
	const action = useLoyaltyAction<QueueResolution, QueueOutcome>(
		(source, args) => source.resolveQueueItem(args),
	);
	if (!access.canResolve) {
		return (
			<Notice testId="loyalty-queue-denied">{t("loyalty.queue.denied")}</Notice>
		);
	}
	if (queue.status === "error") {
		return (
			<div
				role="alert"
				className="space-y-2"
				data-testid="loyalty-queue-failed"
			>
				<p className="text-sm">{t("report.card.error")}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => void queue.refetch()}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	}
	if (queue.data === undefined) {
		return (
			<p role="status" className="text-sm text-ink-muted">
				{t("app.loading")}
			</p>
		);
	}
	const open = openQueueItems(queue.data);
	const closed = closedQueueItems(queue.data);
	const status = action.running
		? { tone: "text-ink-muted", text: t("settings.saving") }
		: action.errorCode !== null
			? { tone: "text-negative", text: t(errorKeyOf(action.errorCode)) }
			: action.result !== null
				? { tone: "text-positive", text: outcomeText(t, action.result) }
				: null;
	return (
		<div className="space-y-4">
			<section
				aria-labelledby={`${ids}-open`}
				className="space-y-2 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="loyalty-queue-open"
			>
				<h2 id={`${ids}-open`} className="text-base font-semibold">
					{t("loyalty.queue.open", { count: formatters.count(open.length) })}
				</h2>
				<p className="text-sm text-ink-muted">{t("loyalty.queue.intro")}</p>
				<div className="flex flex-wrap items-center gap-2">
					<p
						role="status"
						className={cn("text-sm", status?.tone ?? null)}
						data-testid="loyalty-queue-status"
					>
						{status?.text ?? ""}
					</p>
					{action.canRetry ? (
						<Button
							tone="secondary"
							size="compact"
							onClick={() => void action.retry()}
							data-testid="loyalty-queue-retry"
						>
							{t("app.retry")}
						</Button>
					) : null}
				</div>
				{open.length === 0 ? (
					<p className="text-sm" data-testid="loyalty-queue-none">
						{t("loyalty.queue.none")}
					</p>
				) : (
					<ul className="divide-y divide-line">
						{open.map((item) => (
							<QueueItem
								key={item.id}
								item={item}
								stores={stores}
								canResolve={access.canResolve}
								busy={action.running}
								onResolve={(resolution) => void action.run(resolution)}
							/>
						))}
					</ul>
				)}
			</section>
			<section
				aria-labelledby={`${ids}-history`}
				className="min-w-0 space-y-2 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="loyalty-queue-history"
			>
				<h2 id={`${ids}-history`} className="text-base font-semibold">
					{t("loyalty.queue.history.title")}
				</h2>
				<DataTable
					table={queueHistoryTable(closed, {
						t,
						formatters,
						timeZone: tenant.timeZone,
						stores,
					})}
					formatters={formatters}
					fileName={loyaltyCsvName("khach-hang", "doi-soat")}
				/>
			</section>
		</div>
	);
}

export function QueuePage() {
	return (
		<CustomersLayout page="doi-soat">
			{({ access }) => <QueueBody access={access} />}
		</CustomersLayout>
	);
}
