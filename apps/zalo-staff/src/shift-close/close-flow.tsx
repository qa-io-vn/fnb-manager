import type {
	CashCountReceipt,
	CashCountRecord,
	CashCountRow,
} from "@fnb/zalo-mini";
import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useId, useState } from "react";
import { failureKey, useAction, useShiftEnv } from "../shift/env";
import { isoDateShift, seesDifference } from "../shift/model";
import {
	Alert,
	BusyLabel,
	Card,
	Chip,
	fieldClass,
	focusRing,
	Hint,
	OfflineBanner,
	SubScreen,
} from "../shift/parts";
import { primaryButton, secondaryButton } from "../ui";
import {
	type CountDraft,
	type CountOutcome,
	countOutcome,
	countProblem,
	denominationsFor,
	denominationsPayload,
	draftAmount,
	MAX_COUNT_NOTE,
	MAX_HANDOVER_NOTE,
	nextShifts,
	noteProblem,
	pendingRecount,
	readPieces,
	SHIFT_NUMBERS,
	signedMoney,
} from "./model";

type Step =
	| { readonly kind: "count" }
	| { readonly kind: "confirm" }
	| {
			readonly kind: "handover";
			readonly receipt: CashCountReceipt;
			readonly outcome: CountOutcome;
	  }
	| {
			readonly kind: "done";
			readonly receipt: CashCountReceipt;
			readonly outcome: CountOutcome;
			readonly handover: boolean;
	  };

function Stepper({
	face,
	count,
	onChange,
}: {
	readonly face: number;
	readonly count: number;
	readonly onChange: (count: number) => void;
}) {
	const { t } = useI18n();
	const { formatters } = useShiftEnv();
	const inputId = useId();
	const faceText = formatters.moneyExact(face);
	return (
		<li
			className="flex items-center justify-between gap-2 py-1"
			data-testid="denomination"
			data-face={face}
		>
			<label
				htmlFor={inputId}
				className="min-w-0 flex-1 text-body font-semibold tabular-nums text-ink"
			>
				{faceText}
			</label>
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => onChange(Math.max(0, count - 1))}
					disabled={count === 0}
					aria-label={t("close.less", { face: faceText })}
					className={`flex size-11 items-center justify-center rounded-control-xl border-outline border-edge text-xl text-ink disabled:opacity-40 ${focusRing}`}
				>
					−
				</button>
				<input
					id={inputId}
					inputMode="numeric"
					autoComplete="off"
					enterKeyHint="next"
					value={count === 0 ? "" : String(count)}
					placeholder="0"
					onChange={(event) => {
						const value = readPieces(event.target.value);
						if (value !== null) onChange(value);
					}}
					aria-label={t("close.pieces", { face: faceText })}
					className={`min-h-11 w-16 max-w-16 shrink-0 rounded-field border-field border-line-strong bg-surface-raised px-2 py-2 text-center text-base tabular-nums text-ink placeholder:text-ink-muted ${focusRing}`}
				/>
				<button
					type="button"
					onClick={() => onChange(count + 1)}
					aria-label={t("close.more", { face: faceText })}
					className={`flex size-11 items-center justify-center rounded-control-xl border-outline border-edge text-xl text-ink ${focusRing}`}
				>
					+
				</button>
			</div>
		</li>
	);
}

function OutcomeCard({
	receipt,
	outcome,
}: {
	readonly receipt: CashCountReceipt;
	readonly outcome: CountOutcome;
}) {
	const { t } = useI18n();
	const { formatters } = useShiftEnv();
	const time = formatters.time(new Date(receipt.countedAt));
	return (
		<Card testId="count-outcome" state={outcome.kind}>
			<p className="text-sm text-ink-muted">{t("close.countedAt", { time })}</p>
			{outcome.kind === "recorded" ? (
				<>
					<Chip tone="positive" testId="count-recorded">
						{t("close.recorded")}
					</Chip>
					{outcome.matched ? null : <Hint>{t("close.waitingForShift")}</Hint>}
				</>
			) : null}
			{outcome.kind === "unmatched" ? (
				<>
					<Chip tone="neutral">{t("close.unmatched")}</Chip>
					<Hint>{t("close.waitingForShift")}</Hint>
				</>
			) : null}
			{outcome.kind === "no-reference" ? (
				<>
					<Chip tone="neutral">{t("close.noReference")}</Chip>
					{outcome.shiftNumber === null ? null : (
						<Hint>{t("ops.shift", { n: outcome.shiftNumber })}</Hint>
					)}
				</>
			) : null}
			{outcome.kind === "difference" ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm text-ink-muted">
						{outcome.shiftNumber === null
							? t("close.difference")
							: t("close.differenceOf", {
									shift: t("ops.shift", { n: outcome.shiftNumber }),
								})}
					</p>
					<p
						className="text-2xl font-semibold tabular-nums text-ink"
						data-testid="count-difference"
					>
						{signedMoney(outcome.variance, formatters.moneyExact)}
					</p>
					<Chip
						tone={outcome.over ? "warning" : "positive"}
						testId="count-threshold"
					>
						{outcome.over ? t("close.over") : t("close.within")}
					</Chip>
				</div>
			) : null}
		</Card>
	);
}

export function CloseFlow({ onBack }: { readonly onBack: () => void }) {
	const { t } = useI18n();
	const { ops, store, context, formatters } = useShiftEnv();
	const faces = denominationsFor(context.currencyCode);
	const [step, setStep] = useState<Step>({ kind: "count" });
	const [draft, setDraft] = useState<CountDraft>({
		mode: faces.length > 0 ? "pieces" : "total",
		pieces: {},
		totalText: "",
		note: "",
	});
	const [problem, setProblem] = useState<string | null>(null);
	const [recount, setRecount] = useState<CashCountRecord | null>(null);
	const [shifts, setShifts] = useState(nextShifts(null));
	const [note, setNote] = useState("");
	const [noteIssue, setNoteIssue] = useState<string | null>(null);
	const [showResult, setShowResult] = useState(false);
	const record = useAction();
	const handover = useAction();
	const totalId = useId();
	const countNoteId = useId();
	const noteId = useId();
	const fromId = useId();
	const toId = useId();
	const reminderId = useId();

	useEffect(() => {
		let active = true;
		ops.cashCounts(store.id, isoDateShift(store.today, -1)).then(
			(records) => {
				if (active) setRecount(pendingRecount(records));
			},
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [ops, store.id, store.today]);

	const amount = draftAmount(draft);
	const shownAmount = amount === null ? "—" : formatters.moneyExact(amount);

	const toConfirm = () => {
		const found = countProblem(draft);
		if (found !== null) {
			setProblem(`close.problem.${found}`);
			return;
		}
		setProblem(null);
		setStep({ kind: "confirm" });
	};

	const confirm = async () => {
		if (amount === null) return;
		const result = await record.run(async () => {
			const receipt = await ops.recordCashCount({
				storeId: store.id,
				amount,
				denominations:
					draft.mode === "pieces" ? denominationsPayload(draft.pieces) : null,
				note: draft.note.trim() === "" ? null : draft.note.trim(),
				replacesId: recount?.id ?? null,
			});
			let row: CashCountRow | null = null;
			const shows = seesDifference(context.role, context.access);
			if (shows) {
				row =
					(
						await ops
							.cashCountReview(
								[store.id],
								receipt.businessDate,
								receipt.businessDate,
							)
							.catch(() => [])
					).find(
						(candidate) => candidate.cashCountId === receipt.cashCountId,
					) ?? null;
			}
			return { receipt, outcome: countOutcome(receipt, row, shows), row };
		});
		if (!result.ok) return;
		setShifts(nextShifts(result.value.row?.shiftNumber ?? null));
		setStep({
			kind: "handover",
			receipt: result.value.receipt,
			outcome: result.value.outcome,
		});
	};

	const sendHandover = async (
		receipt: CashCountReceipt,
		outcome: CountOutcome,
	) => {
		const found = noteProblem(note, MAX_HANDOVER_NOTE);
		if (found !== null) {
			setNoteIssue(`close.note.${found}`);
			return;
		}
		setNoteIssue(null);
		const result = await handover.run(() =>
			ops.writeHandover({
				storeId: store.id,
				fromShift: shifts.from,
				toShift: shifts.to,
				note: note.trim(),
			}),
		);
		if (!result.ok) return;
		setStep({ kind: "done", receipt, outcome, handover: true });
		setShowResult(true);
	};

	if (step.kind === "count") {
		return (
			<SubScreen
				title={t("close.title")}
				subtitle={t("close.countStep", { store: store.name })}
				onBack={onBack}
				testId="close-count"
			>
				<OfflineBanner />
				{recount !== null ? (
					<Card testId="recount">
						<Chip tone="warning">{t("close.recountTitle")}</Chip>
						<Hint>
							{t("close.recountBody", {
								time: formatters.time(new Date(recount.countedAt)),
							})}
						</Hint>
					</Card>
				) : null}
				{faces.length > 0 ? (
					<fieldset className="flex gap-2" aria-label={t("close.mode")}>
						{(["pieces", "total"] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								aria-pressed={draft.mode === mode}
								onClick={() => setDraft({ ...draft, mode })}
								className={`flex-1 ${draft.mode === mode ? "inline-flex min-h-11 items-center justify-center rounded-control-xl border-2 border-accent bg-surface-raised px-3 text-body font-semibold text-ink" : `${secondaryButton}`} ${focusRing}`}
							>
								{t(`close.mode.${mode}`)}
							</button>
						))}
					</fieldset>
				) : null}
				{draft.mode === "pieces" ? (
					<ul
						className="flex flex-col divide-y divide-line rounded-card-2xl border-card border-line bg-surface-raised px-4"
						aria-label={t("close.denominations")}
					>
						{faces.map((face) => (
							<Stepper
								key={face}
								face={face}
								count={draft.pieces[String(face)] ?? 0}
								onChange={(count) =>
									setDraft({
										...draft,
										pieces: { ...draft.pieces, [String(face)]: count },
									})
								}
							/>
						))}
					</ul>
				) : (
					<div className="flex flex-col gap-1">
						<label htmlFor={totalId} className="text-sm text-ink-muted">
							{t("close.totalLabel")}
						</label>
						<input
							id={totalId}
							inputMode="numeric"
							autoComplete="off"
							value={draft.totalText}
							onChange={(event) =>
								setDraft({ ...draft, totalText: event.target.value })
							}
							data-testid="count-total"
							className={`${fieldClass} text-lg tabular-nums`}
						/>
					</div>
				)}
				<div className="flex flex-col gap-1">
					<label htmlFor={countNoteId} className="text-sm text-ink-muted">
						{t("close.countNote")}
					</label>
					<input
						id={countNoteId}
						autoComplete="off"
						maxLength={MAX_COUNT_NOTE}
						value={draft.note}
						onChange={(event) =>
							setDraft({ ...draft, note: event.target.value })
						}
						className={fieldClass}
					/>
					<Hint>{t("ops.noPersonalDetails")}</Hint>
				</div>
				{problem !== null ? (
					<Alert testId="count-problem">{t(problem)}</Alert>
				) : null}
				<div className="sticky bottom-[calc(48px+var(--zaui-safe-area-inset-bottom,0px))] -mx-4 flex flex-col gap-2 border-t border-line bg-surface px-4 pt-3 pb-3">
					<p
						className="flex items-baseline justify-between text-body text-ink"
						aria-live="polite"
						data-testid="running-total"
						data-amount={amount ?? ""}
					>
						<span>{t("close.total")}</span>
						<span className="text-xl font-semibold tabular-nums">
							{shownAmount}
						</span>
					</p>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={toConfirm}
					>
						{t("close.next")}
					</button>
				</div>
			</SubScreen>
		);
	}

	if (step.kind === "confirm") {
		return (
			<SubScreen
				title={t("close.confirmTitle")}
				subtitle={store.name}
				onBack={() => setStep({ kind: "count" })}
				backDisabled={record.busy}
				testId="close-confirm"
			>
				<OfflineBanner />
				<Card testId="confirm-amount">
					<p className="text-sm text-ink-muted">{t("close.total")}</p>
					<p className="text-3xl font-semibold tabular-nums text-ink">
						{shownAmount}
					</p>
					{draft.mode === "pieces" ? (
						<ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
							{faces
								.filter((face) => (draft.pieces[String(face)] ?? 0) > 0)
								.map((face) => (
									<li key={face} className="tabular-nums">
										{t("close.piecesLine", {
											face: formatters.moneyExact(face),
											count: draft.pieces[String(face)] ?? 0,
										})}
									</li>
								))}
						</ul>
					) : null}
					{recount !== null ? <Hint>{t("close.replacesHint")}</Hint> : null}
				</Card>
				<Hint>{t("close.confirmHint")}</Hint>
				{record.failure !== null ? (
					<Alert testId="count-failed">
						{t(
							record.failure === "check"
								? "close.error.check"
								: record.failure === "duplicate"
									? "close.error.duplicate"
									: record.failure === "invalid"
										? "close.error.replaced"
										: failureKey(record.failure),
						)}
					</Alert>
				) : null}
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					disabled={record.busy}
					aria-busy={record.busy}
					onClick={confirm}
				>
					<BusyLabel busy={record.busy} busyText={t("close.saving")}>
						{t("close.confirm")}
					</BusyLabel>
				</button>
				<button
					type="button"
					className={secondaryButton}
					disabled={record.busy}
					onClick={() => setStep({ kind: "count" })}
				>
					{t("close.edit")}
				</button>
			</SubScreen>
		);
	}

	if (step.kind === "handover") {
		const length = [...note.trim()].length;
		return (
			<SubScreen
				title={t("close.title")}
				subtitle={t("close.handoverStep", { store: store.name })}
				onBack={onBack}
				backDisabled={handover.busy}
				testId="close-handover"
			>
				<OfflineBanner />
				<OutcomeCard receipt={step.receipt} outcome={step.outcome} />
				<div className="grid grid-cols-2 gap-3">
					<div className="flex flex-col gap-1">
						<label htmlFor={fromId} className="text-sm text-ink-muted">
							{t("close.fromShift")}
						</label>
						<select
							id={fromId}
							value={shifts.from}
							onChange={(event) =>
								setShifts({ ...shifts, from: Number(event.target.value) })
							}
							className={fieldClass}
						>
							{SHIFT_NUMBERS.map((n) => (
								<option key={n} value={n}>
									{t("ops.shift", { n })}
								</option>
							))}
						</select>
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor={toId} className="text-sm text-ink-muted">
							{t("close.toShift")}
						</label>
						<select
							id={toId}
							value={shifts.to}
							onChange={(event) =>
								setShifts({ ...shifts, to: Number(event.target.value) })
							}
							className={fieldClass}
						>
							{SHIFT_NUMBERS.map((n) => (
								<option key={n} value={n}>
									{t("ops.shift", { n })}
								</option>
							))}
						</select>
					</div>
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor={noteId} className="text-sm text-ink-muted">
						{t("close.noteLabel")}
					</label>
					<textarea
						id={noteId}
						rows={5}
						value={note}
						onChange={(event) => setNote(event.target.value)}
						aria-describedby={reminderId}
						data-testid="handover-note"
						className={`${fieldClass} min-h-32`}
					/>
					<div className="flex justify-between gap-2">
						<p id={reminderId} className="text-sm text-ink-muted">
							{t("ops.noPersonalDetails")}
						</p>
						<p
							className={`shrink-0 text-sm tabular-nums ${length > MAX_HANDOVER_NOTE ? "text-negative" : "text-ink-muted"}`}
						>
							{t("close.noteCount", { count: length, max: MAX_HANDOVER_NOTE })}
						</p>
					</div>
				</div>
				{noteIssue !== null ? (
					<Alert testId="note-problem">{t(noteIssue)}</Alert>
				) : null}
				{handover.failure !== null ? (
					<Alert testId="handover-failed">
						{t(
							handover.failure === "check"
								? "close.note.long"
								: failureKey(handover.failure),
						)}
					</Alert>
				) : null}
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					disabled={handover.busy}
					aria-busy={handover.busy}
					onClick={() => sendHandover(step.receipt, step.outcome)}
				>
					<BusyLabel busy={handover.busy} busyText={t("close.sending")}>
						{t("close.sendHandover")}
					</BusyLabel>
				</button>
				<button
					type="button"
					className={secondaryButton}
					disabled={handover.busy}
					onClick={() => {
						setStep({
							kind: "done",
							receipt: step.receipt,
							outcome: step.outcome,
							handover: false,
						});
						setShowResult(true);
					}}
				>
					{t("close.skipHandover")}
				</button>
			</SubScreen>
		);
	}

	return (
		<SubScreen
			title={t("close.doneTitle")}
			subtitle={store.name}
			onBack={onBack}
			testId="close-done"
		>
			<OutcomeCard receipt={step.receipt} outcome={step.outcome} />
			<Card testId="handover-state">
				<Chip tone={step.handover ? "positive" : "neutral"}>
					{step.handover ? t("close.handoverSent") : t("close.handoverSkipped")}
				</Chip>
			</Card>
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				onClick={onBack}
			>
				{t("ops.backToShift")}
			</button>
			{showResult ? (
				<ResultModal
					message={t("close.done")}
					onDone={() => setShowResult(false)}
				/>
			) : null}
		</SubScreen>
	);
}
