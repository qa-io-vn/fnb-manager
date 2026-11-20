import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type {
	AuditRefusal,
	AuditResult,
	BillAudit,
	BillDecision,
	BillQueue,
	DecideRefusal,
	QueuedBill,
} from "../loyalty/bills-contract";
import { useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import {
	type ReasonProblem,
	reasonProblem,
	shownPhone,
} from "../loyalty/model";
import { FailureAlert } from "../loyalty/parts";
import { LoyaltyFrame, type LoyaltyScreenProps } from "../loyalty/route";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import { Alert, BusyLabel, Card, Chip, Loading, Panel } from "../shift/parts";
import { dangerButton, primaryButton, secondaryButton } from "../ui";
import { ReasonField, RefusalAlert, useWhen } from "./parts";

type QueueLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly queue: BillQueue }
	| { readonly status: "failed"; readonly failure: Failure };

type Opened =
	| { readonly kind: "bill"; readonly id: string }
	| { readonly kind: "audit"; readonly id: string };

function Recorded({
	name,
	at,
}: {
	readonly name: string | null;
	readonly at: string;
}) {
	const { t } = useI18n();
	const when = useWhen();
	return (
		<p className="text-sm text-ink-muted">
			{name === null
				? t("billQueue.recordedAt", when(at))
				: t("billQueue.recordedBy", { ...when(at), name })}
		</p>
	);
}

function DecideForm({
	bill,
	onDone,
	onCancel,
}: {
	readonly bill: QueuedBill;
	readonly onDone: (message: string) => void;
	readonly onCancel: () => void;
}) {
	const { t } = useI18n();
	const { bills } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const [reason, setReason] = useState("");
	const [problem, setProblem] = useState<ReasonProblem | null>(null);
	const [refusal, setRefusal] = useState<DecideRefusal | "other" | null>(null);
	const busy = action.busy;
	const decide = async (decision: BillDecision) => {
		if (busy) return;
		const found = reasonProblem(reason);
		if (found !== null) {
			setProblem(found);
			return;
		}
		const result = await action.run(() =>
			bills.decide(bill.id, decision, reason.trim()),
		);
		if (!result.ok) return;
		if (result.value.state === "refused") {
			setRefusal(result.value.refusal ?? "other");
			return;
		}
		onDone(t(`billQueue.done.${result.value.state}`));
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		void decide("approved");
	};
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={submit}
			noValidate
			data-testid="bill-decide-form"
		>
			<ReasonField
				label={t("billQueue.reasonLabel")}
				value={reason}
				disabled={busy}
				testId="bill-decide-reason"
				problem={problem}
				onChange={(value) => {
					setReason(value);
					setProblem(null);
					setRefusal(null);
				}}
			/>
			{refusal === null ? null : (
				<RefusalAlert
					text={t(`billQueue.refusal.${refusal}`)}
					testId="bill-decide-refused"
					refusal={refusal}
				/>
			)}
			{action.failure === null ? null : (
				<FailureAlert failure={action.failure} />
			)}
			<button
				type="submit"
				className={primaryButton}
				data-action="primary"
				disabled={busy}
				aria-busy={busy}
			>
				<BusyLabel busy={busy} busyText={t("billQueue.busy")}>
					{t("billQueue.approve")}
				</BusyLabel>
			</button>
			<div className="grid grid-cols-2 gap-3">
				<button
					type="button"
					className={secondaryButton}
					disabled={busy}
					onClick={onCancel}
				>
					{t("bills.cancel")}
				</button>
				<button
					type="button"
					className={dangerButton}
					disabled={busy}
					onClick={() => void decide("rejected")}
				>
					{t("billQueue.reject")}
				</button>
			</div>
		</form>
	);
}

function AuditForm({
	audit,
	onDone,
	onCancel,
}: {
	readonly audit: BillAudit;
	readonly onDone: (message: string) => void;
	readonly onCancel: () => void;
}) {
	const { t } = useI18n();
	const { bills } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const [note, setNote] = useState("");
	const [problem, setProblem] = useState<ReasonProblem | null>(null);
	const [refusal, setRefusal] = useState<AuditRefusal | "other" | null>(null);
	const busy = action.busy;
	const close = async (result: AuditResult) => {
		if (busy) return;
		const found = reasonProblem(note);
		// a failed audit needs its note; a passed one may carry one, within the same length
		if (found === "long" || (found === "empty" && result === "failed")) {
			setProblem(found);
			return;
		}
		const trimmed = note.trim();
		const answer = await action.run(() =>
			bills.closeAudit(audit.id, result, trimmed === "" ? null : trimmed),
		);
		if (!answer.ok) return;
		if (answer.value.state === "refused") {
			setRefusal(answer.value.refusal ?? "other");
			return;
		}
		onDone(t(`billQueue.done.${answer.value.state}`));
	};
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				void close("passed");
			}}
			noValidate
			data-testid="audit-form"
		>
			<ReasonField
				label={t("billQueue.auditNote")}
				value={note}
				disabled={busy}
				testId="audit-note"
				problem={problem}
				onChange={(value) => {
					setNote(value);
					setProblem(null);
					setRefusal(null);
				}}
			/>
			{refusal === null ? null : (
				<RefusalAlert
					text={t(`billQueue.auditRefusal.${refusal}`)}
					testId="audit-refused"
					refusal={refusal}
				/>
			)}
			{action.failure === null ? null : (
				<FailureAlert failure={action.failure} />
			)}
			<button
				type="submit"
				className={primaryButton}
				data-action="primary"
				disabled={busy}
				aria-busy={busy}
			>
				<BusyLabel busy={busy} busyText={t("billQueue.busy")}>
					{t("billQueue.pass")}
				</BusyLabel>
			</button>
			<div className="grid grid-cols-2 gap-3">
				<button
					type="button"
					className={secondaryButton}
					disabled={busy}
					onClick={onCancel}
				>
					{t("bills.cancel")}
				</button>
				<button
					type="button"
					className={dangerButton}
					disabled={busy}
					onClick={() => void close("failed")}
				>
					{t("billQueue.fail")}
				</button>
			</div>
		</form>
	);
}

function QueuedCard({
	bill,
	primary,
	open,
	onOpen,
	onClose,
	onDone,
}: {
	readonly bill: QueuedBill;
	readonly primary: boolean;
	readonly open: boolean;
	readonly onOpen: () => void;
	readonly onClose: () => void;
	readonly onDone: (message: string) => void;
}) {
	const { t } = useI18n();
	const { formatters } = useLoyaltyEnv();
	const amount = (value: number | null, missing: string) =>
		value === null ? t(missing) : formatters.moneyExact(value);
	return (
		<li
			data-testid="queued-bill"
			data-bill-no={bill.billNo}
			data-reason={bill.queueReason}
		>
			<Card>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="font-mono text-base font-semibold text-ink">
						{bill.billNo}
					</p>
					<Chip
						tone={bill.queueReason === "disagreement" ? "negative" : "warning"}
					>
						{t(`billQueue.reason.${bill.queueReason}`)}
					</Chip>
				</div>
				<p
					className="text-base text-ink tabular-nums"
					data-testid="staff-total"
				>
					{t("billQueue.staffTotal", {
						amount: amount(bill.staffTotal, "billQueue.noTotal"),
					})}
				</p>
				<p
					className="text-base text-ink tabular-nums"
					data-testid="customer-total"
				>
					{t("billQueue.customerTotal", {
						amount: amount(bill.customerTotal, "billQueue.noTotal"),
					})}
				</p>
				<p className="text-sm text-ink-muted" data-testid="queued-member">
					{t("loyalty.member", { phone: shownPhone(bill.phoneMasked) })}
				</p>
				<Recorded name={bill.recordedByName} at={bill.createdAt} />
				<div className="flex flex-wrap gap-2">
					{bill.own ? (
						<Chip tone="accent" testId="queued-own">
							{t("billQueue.own")}
						</Chip>
					) : null}
					{bill.source === "counter_claim" ? (
						<Chip tone="accent">{t("bills.counterClaim")}</Chip>
					) : null}
				</div>
				{open ? (
					<DecideForm bill={bill} onDone={onDone} onCancel={onClose} />
				) : (
					<button
						type="button"
						className={primary ? primaryButton : secondaryButton}
						{...(primary ? { "data-action": "primary" } : {})}
						onClick={onOpen}
						aria-label={t("billQueue.decideFor", { billNo: bill.billNo })}
					>
						{t("billQueue.decide")}
					</button>
				)}
			</Card>
		</li>
	);
}

function AuditCard({
	audit,
	primary,
	open,
	onOpen,
	onClose,
	onDone,
}: {
	readonly audit: BillAudit;
	readonly primary: boolean;
	readonly open: boolean;
	readonly onOpen: () => void;
	readonly onClose: () => void;
	readonly onDone: (message: string) => void;
}) {
	const { t } = useI18n();
	const { formatters } = useLoyaltyEnv();
	return (
		<li data-testid="bill-audit" data-bill-no={audit.billNo}>
			<Card>
				<p className="font-mono text-base font-semibold text-ink">
					{audit.billNo}
				</p>
				<p className="text-base text-ink tabular-nums">
					{t("billQueue.auditTotal", {
						amount: formatters.moneyExact(audit.total),
					})}
				</p>
				<p className="text-sm text-ink-muted">
					{t("billQueue.level", { level: audit.evidenceLevel })}
				</p>
				<p className="text-sm text-ink-muted" data-testid="audit-member">
					{t("loyalty.member", { phone: shownPhone(audit.phoneMasked) })}
				</p>
				<Recorded name={audit.recordedByName} at={audit.openedAt} />
				{open ? (
					<AuditForm audit={audit} onDone={onDone} onCancel={onClose} />
				) : (
					<button
						type="button"
						className={primary ? primaryButton : secondaryButton}
						{...(primary ? { "data-action": "primary" } : {})}
						onClick={onOpen}
						aria-label={t("billQueue.checkFor", { billNo: audit.billNo })}
					>
						{t("billQueue.check")}
					</button>
				)}
			</Card>
		</li>
	);
}

export function BillQueueScreen(_: LoyaltyScreenProps) {
	const { t } = useI18n();
	const { bills, store, manager, recover, home } = useLoyaltyEnv();
	const [load, setLoad] = useState<QueueLoad>({ status: "loading" });
	const [opened, setOpened] = useState<Opened | null>(null);
	const [modal, setModal] = useState<string | null>(null);
	const reload = useCallback(() => {
		let active = true;
		setLoad((current) =>
			current.status === "ready" ? current : { status: "loading" },
		);
		bills.queue(store.id).then(
			(queue) => {
				if (active) setLoad({ status: "ready", queue });
			},
			(error: unknown) => {
				if (active) setLoad({ status: "failed", failure: recover(error) });
			},
		);
		return () => {
			active = false;
		};
	}, [bills, store.id, recover]);
	useEffect(() => {
		if (manager) return reload();
	}, [manager, reload]);

	if (!manager) {
		return (
			<LoyaltyFrame title={t("billQueue.title")} testId="bill-queue">
				<div data-testid="bill-queue-refused" className="flex flex-col gap-3">
					<p className="text-base text-ink">{t("billQueue.managersOnly")}</p>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={home}
					>
						{t("loyalty.backHome")}
					</button>
				</div>
			</LoyaltyFrame>
		);
	}

	const done = (message: string) => {
		setOpened(null);
		setModal(message);
		reload();
	};
	const isOpen = (kind: Opened["kind"], id: string) =>
		opened?.kind === kind && opened.id === id;

	return (
		<LoyaltyFrame title={t("billQueue.title")} testId="bill-queue">
			<div
				data-testid="bill-queue-body"
				data-status={load.status}
				className="contents"
			>
				{load.status === "loading" ? (
					<Loading label={t("billQueue.loading")} />
				) : load.status === "failed" ? (
					<div className="flex flex-col gap-2">
						<Alert testId="bill-queue-failed">
							{t(failureKey(load.failure))}
						</Alert>
						<button
							type="button"
							className={primaryButton}
							data-action="primary"
							onClick={reload}
						>
							{t("ops.retry")}
						</button>
					</div>
				) : (
					<>
						<Panel title={t("billQueue.bills")} testId="queued-bills">
							{load.queue.bills.length === 0 ? (
								<p className="text-base text-ink-muted">
									{t("billQueue.billsEmpty")}
								</p>
							) : (
								<ul className="flex flex-col gap-3">
									{load.queue.bills.map((bill, index) => (
										<QueuedCard
											key={bill.id}
											bill={bill}
											primary={opened === null && index === 0}
											open={isOpen("bill", bill.id)}
											onOpen={() => setOpened({ kind: "bill", id: bill.id })}
											onClose={() => setOpened(null)}
											onDone={done}
										/>
									))}
								</ul>
							)}
						</Panel>
						<Panel title={t("billQueue.audits")} testId="bill-audits">
							{load.queue.audits.length === 0 ? (
								<p className="text-base text-ink-muted">
									{t("billQueue.auditsEmpty")}
								</p>
							) : (
								<ul className="flex flex-col gap-3">
									{load.queue.audits.map((audit, index) => (
										<AuditCard
											key={audit.id}
											audit={audit}
											primary={
												opened === null &&
												load.queue.bills.length === 0 &&
												index === 0
											}
											open={isOpen("audit", audit.id)}
											onOpen={() => setOpened({ kind: "audit", id: audit.id })}
											onClose={() => setOpened(null)}
											onDone={done}
										/>
									))}
								</ul>
							)}
						</Panel>
					</>
				)}
			</div>
			{modal === null ? null : (
				<ResultModal message={modal} onDone={() => setModal(null)} />
			)}
		</LoyaltyFrame>
	);
}
