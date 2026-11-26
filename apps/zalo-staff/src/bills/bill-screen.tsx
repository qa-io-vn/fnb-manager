import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type {
	BillRefusal,
	RecentBill,
	RecentBills,
	ReverseRefusal,
	SubmitAnswer,
} from "../loyalty/bills-contract";
import { MAX_BILL_NO_LENGTH } from "../loyalty/bills-contract";
import {
	BILL_TOTAL_MAX_CHARS,
	type BillDraft,
	type BillField,
	type BillProblem,
	billInput,
	canReverse,
	codeDigits,
	EMPTY_DRAFT,
	readBillTotal,
} from "../loyalty/bills-model";
import { MEMBER_CODE_LENGTH } from "../loyalty/contract";
import { LOYALTY_PATHS, useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import {
	type ReasonProblem,
	readScannedMember,
	reasonProblem,
	shownPhone,
} from "../loyalty/model";
import {
	FailureAlert,
	ScanButton,
	ScanNotice,
	useScanner,
} from "../loyalty/parts";
import { LoyaltyFrame, type LoyaltyScreenProps } from "../loyalty/route";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import {
	Alert,
	BusyLabel,
	Card,
	Chip,
	fieldClass,
	Hint,
	Loading,
	Panel,
} from "../shift/parts";
import { dangerButton, primaryButton, secondaryButton } from "../ui";
import {
	BillStateChip,
	billRefusalKey,
	ReasonField,
	RefusalAlert,
	useWhen,
} from "./parts";

type Recorded = Extract<SubmitAnswer, { outcome: "recorded" }>;

type RecentLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly recent: RecentBills }
	| { readonly status: "failed"; readonly failure: Failure };

function useRecentBills() {
	const { bills, store, recover } = useLoyaltyEnv();
	const [load, setLoad] = useState<RecentLoad>({ status: "loading" });
	const reload = useCallback(() => {
		let active = true;
		setLoad((current) =>
			current.status === "ready" ? current : { status: "loading" },
		);
		bills.recent(store.id).then(
			(recent) => {
				if (active) setLoad({ status: "ready", recent });
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
	return { load, reload };
}

function lockedText(
	t: (key: string, params?: Record<string, string | number>) => string,
	retryAt: string | null,
	time: (iso: string) => string,
): string {
	return retryAt === null
		? t("bills.refusal.lockedNoTime")
		: t("bills.refusal.locked", { time: time(retryAt) });
}

function BillResult({
	answer,
	onAgain,
}: {
	readonly answer: Recorded;
	readonly onAgain: () => void;
}) {
	const { t } = useI18n();
	const when = useWhen();
	const member = answer.member;
	return (
		<div
			className="flex flex-col gap-4"
			data-testid="bill-result"
			data-state={answer.state}
		>
			<Card testId="bill-result-card" state={answer.state}>
				<div className="flex items-center justify-between gap-2">
					<p className="text-lg font-semibold text-ink">
						{t(`bills.result.${answer.state}`)}
					</p>
					<BillStateChip state={answer.state} testId="bill-result-state" />
				</div>
				<p className="text-body text-ink" data-testid="bill-member">
					{t("loyalty.member", { phone: shownPhone(member.phoneMasked) })}
				</p>
				<p className="text-body text-ink tabular-nums" data-testid="bill-earn">
					{t("bills.result.earn", {
						stamps: answer.stampsEarned,
						points: answer.pointsEarned,
					})}
				</p>
				{answer.state === "awaiting_customer" && answer.confirmBy !== null ? (
					<p
						className="text-body font-semibold text-ink"
						data-testid="bill-confirm-by"
					>
						{t("bills.result.confirmBy", when(answer.confirmBy))}
					</p>
				) : null}
				<Hint>{t(`bills.result.${answer.state}Body`)}</Hint>
			</Card>
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				onClick={onAgain}
			>
				{t("bills.again")}
			</button>
		</div>
	);
}

const FIELD_ORDER: readonly BillField[] = ["code", "billNo", "total"];

function BillForm({
	onRecorded,
}: {
	readonly onRecorded: (answer: Recorded) => void;
}) {
	const { t } = useI18n();
	const { bills, store, formatters } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const scanner = useScanner("member");
	const when = useWhen();
	const codeId = useId();
	const billNoId = useId();
	const totalId = useId();
	const codeRef = useRef<HTMLInputElement>(null);
	const billNoRef = useRef<HTMLInputElement>(null);
	const totalRef = useRef<HTMLInputElement>(null);
	const [draft, setDraft] = useState<BillDraft>(EMPTY_DRAFT);
	const [problems, setProblems] = useState<readonly BillProblem[]>([]);
	const [refusal, setRefusal] = useState<{
		readonly refusal: BillRefusal | null;
		readonly retryAt: string | null;
	} | null>(null);
	const busy = action.busy;
	const refs = { code: codeRef, billNo: billNoRef, total: totalRef };

	const change = (patch: Partial<BillDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		setProblems([]);
		setRefusal(null);
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const check = billInput(store.id, draft);
		if (!check.ok) {
			setRefusal(null);
			action.clear();
			setProblems(check.problems);
			const first = FIELD_ORDER.find((field) =>
				check.problems.some((problem) => problem.field === field),
			);
			if (first !== undefined) refs[first].current?.focus();
			return;
		}
		setProblems([]);
		setRefusal(null);
		const result = await action.run(() => bills.submit(check.input));
		if (!result.ok) return;
		if (result.value.outcome === "refused") {
			setRefusal({
				refusal: result.value.refusal,
				retryAt: result.value.retryAt,
			});
			return;
		}
		setDraft(EMPTY_DRAFT);
		scanner.reset();
		onRecorded(result.value);
	};

	const scan = async () => {
		setProblems([]);
		setRefusal(null);
		action.clear();
		const result = await scanner.scan();
		if (result === null) return;
		if (result.kind === "refused") {
			codeRef.current?.focus();
			return;
		}
		if (result.kind !== "content") return;
		const scanned = readScannedMember(result.content);
		if (!scanned.ok) {
			scanner.unreadable();
			return;
		}
		setDraft((current) => ({
			...current,
			code: scanned.code,
			payload: scanned.payload,
		}));
		billNoRef.current?.focus();
	};

	const problemOf = (field: BillField) =>
		problems.find((problem) => problem.field === field) ?? null;
	const total = readBillTotal(draft.total);
	const refusalText =
		refusal === null
			? null
			: refusal.refusal === "locked"
				? lockedText(t, refusal.retryAt, (iso) => when(iso).time)
				: t(billRefusalKey(refusal.refusal));

	const fieldProblem = (field: BillField) => {
		const problem = problemOf(field);
		return problem === null ? null : (
			<p
				id={`${field}-problem`}
				role="alert"
				data-testid={`bill-problem-${field}`}
				className="rounded-card-xl bg-negative-soft px-3 py-2 text-body text-negative"
			>
				{t(`bills.problem.${field}.${problem.problem}`)}
			</p>
		);
	};

	return (
		<>
			<p className="text-body text-ink">{t("bills.intro")}</p>
			<ScanButton
				state={scanner.state}
				disabled={busy}
				label={t("bills.scan")}
				onScan={() => void scan()}
			/>
			<ScanNotice
				state={scanner.state}
				refusedKey="bills.scanRefused"
				unreadableKey="bills.scanUnreadable"
			/>
			<form
				className="flex flex-col gap-3"
				onSubmit={(event) => void submit(event)}
				noValidate
			>
				<div className="flex flex-col gap-1">
					<label htmlFor={codeId} className="text-sm text-ink-muted">
						{t("bills.code")}
					</label>
					<input
						ref={codeRef}
						id={codeId}
						data-testid="bill-code"
						value={draft.code}
						disabled={busy}
						onChange={(event) =>
							change({ code: codeDigits(event.target.value), payload: null })
						}
						inputMode="numeric"
						pattern="[0-9]*"
						autoComplete="off"
						maxLength={MEMBER_CODE_LENGTH}
						aria-invalid={problemOf("code") !== null}
						className={`${fieldClass} text-xl tracking-wider tabular-nums`}
					/>
					{draft.payload === null ? null : (
						<Hint testId="bill-scanned">{t("bills.scanned")}</Hint>
					)}
					{fieldProblem("code")}
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor={billNoId} className="text-sm text-ink-muted">
						{t("bills.billNo")}
					</label>
					<input
						ref={billNoRef}
						id={billNoId}
						data-testid="bill-no"
						value={draft.billNo}
						disabled={busy}
						onChange={(event) => change({ billNo: event.target.value })}
						autoCapitalize="characters"
						autoCorrect="off"
						spellCheck={false}
						autoComplete="off"
						maxLength={MAX_BILL_NO_LENGTH}
						aria-invalid={problemOf("billNo") !== null}
						className={`${fieldClass} font-mono text-lg`}
					/>
					<Hint>{t("bills.billNoHint")}</Hint>
					{fieldProblem("billNo")}
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor={totalId} className="text-sm text-ink-muted">
						{t("bills.total")}
					</label>
					<input
						ref={totalRef}
						id={totalId}
						data-testid="bill-total"
						value={draft.total}
						disabled={busy}
						onChange={(event) => change({ total: event.target.value })}
						inputMode="numeric"
						autoComplete="off"
						maxLength={BILL_TOTAL_MAX_CHARS}
						aria-invalid={problemOf("total") !== null}
						className={`${fieldClass} text-xl tabular-nums`}
					/>
					{total.ok ? (
						<Hint testId="bill-total-read">
							{t("bills.totalRead", {
								amount: formatters.moneyExact(total.total),
							})}
						</Hint>
					) : (
						<Hint>{t("bills.totalHint")}</Hint>
					)}
					{fieldProblem("total")}
				</div>
				{refusalText === null ? null : (
					<RefusalAlert
						text={refusalText}
						testId="bill-refused"
						refusal={refusal?.refusal ?? "other"}
					/>
				)}
				{action.failure === null ? null : (
					<FailureAlert
						failure={action.failure}
						invalidKey="bills.error.invalid"
					/>
				)}
				<button
					type="submit"
					className={primaryButton}
					data-action="primary"
					disabled={busy}
					aria-busy={busy}
				>
					<BusyLabel busy={busy} busyText={t("bills.submitting")}>
						{t("bills.submit")}
					</BusyLabel>
				</button>
			</form>
		</>
	);
}

function ReverseForm({
	bill,
	onDone,
	onCancel,
}: {
	readonly bill: RecentBill;
	readonly onDone: () => void;
	readonly onCancel: () => void;
}) {
	const { t } = useI18n();
	const { bills } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const [reason, setReason] = useState("");
	const [problem, setProblem] = useState<ReasonProblem | null>(null);
	const [refusal, setRefusal] = useState<ReverseRefusal | "other" | null>(null);
	const busy = action.busy;
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const found = reasonProblem(reason);
		if (found !== null) {
			setProblem(found);
			return;
		}
		const result = await action.run(() =>
			bills.reverse(bill.id, reason.trim()),
		);
		if (!result.ok) return;
		if (result.value.state === "refused") {
			setRefusal(result.value.refusal ?? "other");
			return;
		}
		onDone();
	};
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => void submit(event)}
			noValidate
			data-testid="bill-reverse-form"
		>
			<ReasonField
				label={t("bills.reverseReason")}
				value={reason}
				disabled={busy}
				testId="bill-reverse-reason"
				problem={problem}
				onChange={(value) => {
					setReason(value);
					setProblem(null);
					setRefusal(null);
				}}
			/>
			{refusal === null ? null : (
				<RefusalAlert
					text={t(`bills.reverseRefusal.${refusal}`)}
					testId="bill-reverse-refused"
					refusal={refusal}
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
					className={dangerButton}
					disabled={busy}
					aria-busy={busy}
				>
					<BusyLabel busy={busy} busyText={t("bills.reversing")}>
						{t("bills.reverseConfirm")}
					</BusyLabel>
				</button>
			</div>
		</form>
	);
}

function RecentRow({
	bill,
	now,
	open,
	onOpen,
	onClose,
	onReversed,
}: {
	readonly bill: RecentBill;
	readonly now: Date;
	readonly open: boolean;
	readonly onOpen: () => void;
	readonly onClose: () => void;
	readonly onReversed: () => void;
}) {
	const { t } = useI18n();
	const { manager, formatters } = useLoyaltyEnv();
	const when = useWhen();
	const reversible = manager && canReverse(bill, now);
	return (
		<li
			data-testid="recent-bill"
			data-state={bill.state}
			data-bill-no={bill.billNo}
		>
			<Card>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="font-mono text-body font-semibold text-ink">
						{bill.billNo}
					</p>
					<BillStateChip state={bill.state} />
				</div>
				<p className="text-body text-ink tabular-nums">
					{t("bills.line", {
						time: when(bill.createdAt).time,
						total: formatters.moneyExact(bill.total),
					})}
				</p>
				<p className="text-sm text-ink-muted" data-testid="recent-bill-member">
					{t("loyalty.member", { phone: shownPhone(bill.phoneMasked) })}
				</p>
				{bill.source === "counter_claim" ? (
					<Chip tone="accent">{t("bills.counterClaim")}</Chip>
				) : null}
				{manager && bill.recordedByName !== null ? (
					<p className="text-sm text-ink-muted">
						{t("bills.recordedBy", { name: bill.recordedByName })}
					</p>
				) : null}
				{bill.reversalReason === null ? null : (
					<p className="text-sm text-ink-muted" data-testid="bill-reversal">
						{t(`bills.reversal.${bill.reversalReason}`)}
					</p>
				)}
				{reversible && !open ? (
					<button
						type="button"
						className={secondaryButton}
						onClick={onOpen}
						aria-label={t("bills.reverseFor", { billNo: bill.billNo })}
					>
						{t("bills.reverse")}
					</button>
				) : null}
				{reversible && open ? (
					<>
						{bill.reverseUntil === null ? null : (
							<Hint>{t("bills.reverseUntil", when(bill.reverseUntil))}</Hint>
						)}
						<ReverseForm bill={bill} onDone={onReversed} onCancel={onClose} />
					</>
				) : null}
			</Card>
		</li>
	);
}

function RecentList({
	recent,
	onReversed,
}: {
	readonly recent: RecentBills;
	readonly onReversed: () => void;
}) {
	const { t } = useI18n();
	const { manager } = useLoyaltyEnv();
	const [open, setOpen] = useState<string | null>(null);
	const now = new Date();
	return (
		<Panel
			title={t(manager ? "bills.recent" : "bills.recentMine")}
			testId="recent-bills"
		>
			{recent.bills.length === 0 ? (
				<p className="text-body text-ink-muted">{t("bills.recentEmpty")}</p>
			) : (
				<ul className="flex flex-col gap-3">
					{recent.bills.map((bill) => (
						<RecentRow
							key={bill.id}
							bill={bill}
							now={now}
							open={open === bill.id}
							onOpen={() => setOpen(bill.id)}
							onClose={() => setOpen(null)}
							onReversed={() => {
								setOpen(null);
								onReversed();
							}}
						/>
					))}
				</ul>
			)}
		</Panel>
	);
}

export function BillsScreen(_: LoyaltyScreenProps) {
	const { t } = useI18n();
	const { open } = useLoyaltyEnv();
	const { load, reload } = useRecentBills();
	const [answer, setAnswer] = useState<Recorded | null>(null);
	const [modal, setModal] = useState<string | null>(null);
	return (
		<LoyaltyFrame title={t("bills.title")} testId="bills">
			<div
				data-testid="bills-body"
				data-status={load.status}
				className="contents"
			>
				{load.status === "loading" ? (
					<Loading label={t("bills.loading")} />
				) : load.status === "failed" ? (
					<div className="flex flex-col gap-2">
						<Alert testId="bills-failed">{t(failureKey(load.failure))}</Alert>
						<button
							type="button"
							className={primaryButton}
							data-action="primary"
							onClick={reload}
						>
							{t("ops.retry")}
						</button>
					</div>
				) : load.recent.mode !== "staff" ? (
					<div className="flex flex-col gap-3" data-testid="bills-pos-sync">
						<p className="text-body text-ink">{t("bills.posSync")}</p>
						<button
							type="button"
							className={primaryButton}
							data-action="primary"
							onClick={() => open(LOYALTY_PATHS.checkIn)}
						>
							{t("loyalty.checkIn")}
						</button>
					</div>
				) : (
					<>
						{answer === null ? (
							<BillForm
								onRecorded={(recorded) => {
									setAnswer(recorded);
									setModal(t("bills.recorded"));
									reload();
								}}
							/>
						) : (
							<BillResult answer={answer} onAgain={() => setAnswer(null)} />
						)}
						<RecentList
							recent={load.recent}
							onReversed={() => {
								setModal(t("bills.reversed"));
								reload();
							}}
						/>
					</>
				)}
			</div>
			{modal === null ? null : (
				<ResultModal message={modal} onDone={() => setModal(null)} />
			)}
		</LoyaltyFrame>
	);
}
