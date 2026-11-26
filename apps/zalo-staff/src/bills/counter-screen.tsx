import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import type {
	ClaimRefusal,
	CounterClaim,
	CounterCode,
} from "../loyalty/bills-contract";
import {
	BILL_TOTAL_MAX_CHARS,
	CLAIMS_POLL_MS,
	type FieldProblem,
	readBillTotal,
	refreshDelay,
} from "../loyalty/bills-model";
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
import {
	Alert,
	BusyLabel,
	Card,
	fieldClass,
	Hint,
	Loading,
	Panel,
	quietAction,
} from "../shift/parts";
import { dangerButton, primaryButton, secondaryButton } from "../ui";
import { claimRefusalKey, ReasonField, RefusalAlert, useWhen } from "./parts";
import { QrCode } from "./qr";

type CodeLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly code: CounterCode }
	| { readonly status: "failed"; readonly failure: Failure };

type ClaimsLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly claims: readonly CounterClaim[] }
	| { readonly status: "failed"; readonly failure: Failure };

/** the counter QR, asked again at its refresh time; the shown code stays until the new one arrives */
function useCounterCode() {
	const { bills, store, recover } = useLoyaltyEnv();
	const [load, setLoad] = useState<CodeLoad>({ status: "loading" });
	const [round, setRound] = useState(0);
	const reload = useCallback(() => setRound((value) => value + 1), []);
	useEffect(() => {
		let active = true;
		void round;
		bills.counterCode(store.id).then(
			(code) => {
				if (active) setLoad({ status: "ready", code });
			},
			(error: unknown) => {
				if (active) setLoad({ status: "failed", failure: recover(error) });
			},
		);
		return () => {
			active = false;
		};
	}, [bills, store.id, recover, round]);
	const refreshAt =
		load.status === "ready" && load.code.state === "ready"
			? load.code.refreshAt
			: null;
	useEffect(() => {
		if (refreshAt === null) return;
		const timer = setTimeout(reload, refreshDelay(refreshAt, new Date()));
		return () => clearTimeout(timer);
	}, [refreshAt, reload]);
	return { load, reload };
}

function useClaims(paused: boolean) {
	const { bills, store, recover } = useLoyaltyEnv();
	const [load, setLoad] = useState<ClaimsLoad>({ status: "loading" });
	const reload = useCallback(() => {
		let active = true;
		bills.counterClaims(store.id).then(
			(claims) => {
				if (active) setLoad({ status: "ready", claims });
			},
			(error: unknown) => {
				if (active) setLoad({ status: "failed", failure: recover(error) });
			},
		);
		return () => {
			active = false;
		};
	}, [bills, store.id, recover]);
	useEffect(() => reload(), [reload]);
	useEffect(() => {
		if (paused) return;
		const timer = setInterval(reload, CLAIMS_POLL_MS);
		return () => clearInterval(timer);
	}, [paused, reload]);
	return { load, reload };
}

/** keeps the phone screen on while the counter QR shows, where the browser allows it */
function useScreenAwake(): void {
	useEffect(() => {
		let lock: { release(): Promise<void> } | null = null;
		let active = true;
		const wake = (
			navigator as Navigator & {
				readonly wakeLock?: {
					request(kind: "screen"): Promise<{ release(): Promise<void> }>;
				};
			}
		).wakeLock;
		wake?.request("screen").then(
			(granted) => {
				if (active) lock = granted;
				else void granted.release().catch(() => undefined);
			},
			() => undefined,
		);
		return () => {
			active = false;
			void lock?.release().catch(() => undefined);
		};
	}, []);
}

function CounterQr({ load, onRetry }: { load: CodeLoad; onRetry: () => void }) {
	const { t } = useI18n();
	const when = useWhen();
	if (load.status === "loading")
		return <Loading label={t("counter.loading")} />;
	if (load.status === "failed")
		return (
			<div className="flex flex-col gap-2">
				<Alert testId="counter-failed">{t(failureKey(load.failure))}</Alert>
				<button type="button" className={secondaryButton} onClick={onRetry}>
					{t("ops.retry")}
				</button>
			</div>
		);
	const code = load.code;
	if (code.state === "refused")
		return (
			<RefusalAlert
				text={t(`counter.refusal.${code.refusal ?? "other"}`)}
				testId="counter-refused"
				refusal={code.refusal ?? "other"}
			/>
		);
	return (
		<Card testId="counter-code" state="ready">
			<QrCode
				payload={code.qrPayload}
				label={t("counter.qrLabel")}
				testId="counter-qr"
			/>
			<Hint testId="counter-refresh">
				{t("counter.refreshAt", { time: when(code.refreshAt).time })}
			</Hint>
		</Card>
	);
}

type AnswerMode = "total" | "reject";

function ClaimAnswerForm({
	claim,
	mode,
	onDone,
	onCancel,
}: {
	readonly claim: CounterClaim;
	readonly mode: AnswerMode;
	readonly onDone: (message: string) => void;
	readonly onCancel: () => void;
}) {
	const { t } = useI18n();
	const { bills, formatters } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const totalId = useId();
	const [total, setTotal] = useState("");
	const [reason, setReason] = useState("");
	const [totalProblem, setTotalProblem] = useState<FieldProblem | null>(null);
	const [reasonIssue, setReasonIssue] = useState<ReasonProblem | null>(null);
	const [refusal, setRefusal] = useState<{
		readonly refusal: ClaimRefusal | null;
	} | null>(null);
	const busy = action.busy;
	const read = readBillTotal(total);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setRefusal(null);
		if (mode === "total") {
			if (!read.ok) {
				setTotalProblem(read.problem);
				return;
			}
		} else {
			const problem = reasonProblem(reason);
			if (problem !== null) {
				setReasonIssue(problem);
				return;
			}
		}
		const result = await action.run(() =>
			bills.answerClaim(
				mode === "total" && read.ok
					? { billId: claim.id, total: read.total }
					: { billId: claim.id, rejectReason: reason.trim() },
			),
		);
		if (!result.ok) return;
		const answer = result.value;
		if (answer.state === "refused") {
			setRefusal({ refusal: answer.refusal });
			return;
		}
		onDone(t(`counter.done.${answer.state}`));
	};

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => void submit(event)}
			noValidate
			data-testid="claim-form"
			data-mode={mode}
		>
			{mode === "total" ? (
				<div className="flex flex-col gap-1">
					<label htmlFor={totalId} className="text-sm text-ink-muted">
						{t("counter.blindLabel", { billNo: claim.billNo })}
					</label>
					<input
						id={totalId}
						data-testid="claim-total"
						value={total}
						disabled={busy}
						onChange={(event) => {
							setTotal(event.target.value);
							setTotalProblem(null);
							setRefusal(null);
						}}
						inputMode="numeric"
						autoComplete="off"
						maxLength={BILL_TOTAL_MAX_CHARS}
						aria-invalid={totalProblem !== null}
						className={`${fieldClass} text-xl tabular-nums`}
					/>
					{read.ok ? (
						<Hint testId="claim-total-read">
							{t("bills.totalRead", {
								amount: formatters.moneyExact(read.total),
							})}
						</Hint>
					) : null}
					<Hint testId="claim-blind">{t("counter.blindHint")}</Hint>
					{totalProblem === null ? null : (
						<p
							role="alert"
							data-testid="claim-total-problem"
							className="rounded-card-xl bg-negative-soft px-3 py-2 text-body text-negative"
						>
							{t(`bills.problem.total.${totalProblem}`)}
						</p>
					)}
				</div>
			) : (
				<ReasonField
					label={t("counter.rejectReason")}
					value={reason}
					disabled={busy}
					testId="claim-reason"
					problem={reasonIssue}
					onChange={(value) => {
						setReason(value);
						setReasonIssue(null);
						setRefusal(null);
					}}
				/>
			)}
			{refusal === null ? null : (
				<RefusalAlert
					text={t(claimRefusalKey(refusal.refusal))}
					testId="claim-refused"
					refusal={refusal.refusal ?? "other"}
				/>
			)}
			{action.failure === null ? null : (
				<FailureAlert failure={action.failure} />
			)}
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
					type="submit"
					className={mode === "total" ? primaryButton : dangerButton}
					{...(mode === "total" ? { "data-action": "primary" } : {})}
					disabled={busy}
					aria-busy={busy}
				>
					<BusyLabel busy={busy} busyText={t("counter.confirming")}>
						{t(mode === "total" ? "counter.confirm" : "counter.rejectConfirm")}
					</BusyLabel>
				</button>
			</div>
		</form>
	);
}

function ClaimRow({
	claim,
	primary,
	open,
	onOpen,
	onClose,
	onDone,
}: {
	readonly claim: CounterClaim;
	readonly primary: boolean;
	readonly open: AnswerMode | null;
	readonly onOpen: (mode: AnswerMode) => void;
	readonly onClose: () => void;
	readonly onDone: (message: string) => void;
}) {
	const { t } = useI18n();
	const when = useWhen();
	return (
		<li data-testid="counter-claim" data-bill-no={claim.billNo}>
			<Card>
				<p className="font-mono text-body font-semibold text-ink">
					{claim.billNo}
				</p>
				<p className="text-body text-ink" data-testid="claim-member">
					{claim.displayName === null
						? t("loyalty.member", { phone: shownPhone(claim.phoneMasked) })
						: t("counter.memberNamed", {
								name: claim.displayName,
								phone: shownPhone(claim.phoneMasked),
							})}
				</p>
				<p className="text-sm text-ink-muted">
					{t("counter.claimLine", {
						time: when(claim.createdAt).time,
						expires: when(claim.expiresAt).time,
					})}
				</p>
				{open === null ? (
					<div className="grid grid-cols-2 gap-3">
						<button
							type="button"
							className={secondaryButton}
							onClick={() => onOpen("reject")}
							aria-label={t("counter.rejectFor", { billNo: claim.billNo })}
						>
							{t("counter.reject")}
						</button>
						<button
							type="button"
							className={primary ? primaryButton : secondaryButton}
							{...(primary ? { "data-action": "primary" } : {})}
							onClick={() => onOpen("total")}
							aria-label={t("counter.answerFor", { billNo: claim.billNo })}
						>
							{t("counter.answer")}
						</button>
					</div>
				) : (
					<ClaimAnswerForm
						claim={claim}
						mode={open}
						onDone={onDone}
						onCancel={onClose}
					/>
				)}
			</Card>
		</li>
	);
}

export function CounterScreen(_: LoyaltyScreenProps) {
	const { t } = useI18n();
	const [open, setOpen] = useState<{
		readonly id: string;
		readonly mode: AnswerMode;
	} | null>(null);
	const [modal, setModal] = useState<string | null>(null);
	const code = useCounterCode();
	const claims = useClaims(open !== null);
	useScreenAwake();
	const available =
		code.load.status === "ready" && code.load.code.state === "ready";
	return (
		<LoyaltyFrame title={t("counter.title")} testId="counter">
			<p className="text-body text-ink">{t("counter.intro")}</p>
			<CounterQr load={code.load} onRetry={code.reload} />
			{available ? (
				<Panel
					title={t("counter.claims")}
					testId="counter-claims"
					aside={
						<button
							type="button"
							className={quietAction}
							onClick={claims.reload}
						>
							{t("counter.refresh")}
						</button>
					}
				>
					{claims.load.status === "loading" ? (
						<Loading label={t("counter.claimsLoading")} />
					) : claims.load.status === "failed" ? (
						<Alert testId="counter-claims-failed">
							{t("counter.claimsFailed")}
						</Alert>
					) : claims.load.claims.length === 0 ? (
						<p className="text-body text-ink-muted" data-testid="claims-empty">
							{t("counter.claimsEmpty")}
						</p>
					) : (
						<ul className="flex flex-col gap-3">
							{claims.load.claims.map((claim, index) => (
								<ClaimRow
									key={claim.id}
									claim={claim}
									primary={open === null && index === 0}
									open={open?.id === claim.id ? open.mode : null}
									onOpen={(mode) => setOpen({ id: claim.id, mode })}
									onClose={() => setOpen(null)}
									onDone={(message) => {
										setOpen(null);
										setModal(message);
										claims.reload();
									}}
								/>
							))}
						</ul>
					)}
				</Panel>
			) : null}
			{modal === null ? null : (
				<ResultModal message={modal} onDone={() => setModal(null)} />
			)}
		</LoyaltyFrame>
	);
}
