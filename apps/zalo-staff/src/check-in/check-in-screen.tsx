import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useId, useRef, useState } from "react";
import type {
	CheckinAnswer,
	CheckinEntry,
	CheckinRefusal,
} from "../loyalty/contract";
import { LOYALTY_PATHS, useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import {
	ENTRY_MAX_DIGITS,
	type EntryProblem,
	entryDigits,
	readEntry,
	readScannedMember,
	shownPhone,
} from "../loyalty/model";
import {
	FailureAlert,
	ScanButton,
	ScanNotice,
	useScanner,
	VisitChip,
	visitStateOf,
} from "../loyalty/parts";
import { LoyaltyFrame, type LoyaltyScreenProps } from "../loyalty/route";
import { BusyLabel, Card, fieldClass, Hint } from "../shift/parts";
import { primaryButton, secondaryButton } from "../ui";

type Recorded = Extract<CheckinAnswer, { outcome: "recorded" }>;

const PROBLEM_KEYS: Readonly<Record<EntryProblem, string>> = {
	empty: "checkin.problem.empty",
	phone: "checkin.problem.phone",
	format: "checkin.problem.format",
};

function refusalKey(refusal: CheckinRefusal | null): string {
	return `checkin.refusal.${refusal ?? "other"}`;
}

function CheckinResult({
	answer,
	onAgain,
}: {
	readonly answer: Recorded;
	readonly onAgain: () => void;
}) {
	const { t } = useI18n();
	const { formatters, open } = useLoyaltyEnv();
	const state = visitStateOf(answer.state);
	const member = answer.member;
	return (
		<div
			className="flex flex-col gap-4"
			data-testid="checkin-result"
			data-state={answer.state}
		>
			<Card testId="checkin-pending" state={answer.state}>
				<div className="flex items-center justify-between gap-2">
					<p className="text-lg font-semibold text-ink">
						{t("checkin.result.title")}
					</p>
					<VisitChip state={state} testId="checkin-state" />
				</div>
				<p className="text-base text-ink" data-testid="checkin-member">
					{t("loyalty.member", { phone: shownPhone(member.phoneMasked) })}
				</p>
				{member.stamps !== null && member.stampsPerCard !== null ? (
					<p className="text-sm text-ink-muted">
						{t("loyalty.stampsOf", {
							stamps: member.stamps,
							perCard: member.stampsPerCard,
						})}
					</p>
				) : null}
				{answer.state === "pending" ? (
					<>
						{answer.confirmBy === null ? null : (
							<p
								className="text-base font-semibold text-ink"
								data-testid="checkin-confirm-by"
							>
								{t("checkin.result.confirmBy", {
									time: formatters.time(new Date(answer.confirmBy)),
								})}
							</p>
						)}
						<Hint>{t("checkin.result.pendingBody")}</Hint>
					</>
				) : (
					<Hint>{t(`checkin.result.${answer.state}`)}</Hint>
				)}
			</Card>
			<div className="grid grid-cols-2 gap-3">
				<button
					type="button"
					className={secondaryButton}
					onClick={() => open(LOYALTY_PATHS.redeem)}
				>
					{t("loyalty.redeem")}
				</button>
				<button
					type="button"
					className={secondaryButton}
					onClick={() =>
						open(LOYALTY_PATHS.lookup, member.membershipId ?? undefined)
					}
				>
					{t("loyalty.lookup")}
				</button>
			</div>
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				onClick={onAgain}
			>
				{t("checkin.again")}
			</button>
		</div>
	);
}

export function CheckInScreen(_: LoyaltyScreenProps) {
	const { t } = useI18n();
	const { client, store } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const scanner = useScanner("member");
	const inputId = useId();
	const hintId = useId();
	const messageId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState("");
	const [problem, setProblem] = useState<EntryProblem | null>(null);
	const [refusal, setRefusal] = useState<{
		readonly refusal: CheckinRefusal | null;
	} | null>(null);
	const [answer, setAnswer] = useState<Recorded | null>(null);
	const [modal, setModal] = useState(false);
	const busy = action.busy;

	const record = async (entry: CheckinEntry) => {
		setProblem(null);
		setRefusal(null);
		const result = await action.run(() =>
			client.recordCheckin({ storeId: store.id, entry }),
		);
		if (!result.ok) return;
		if (result.value.outcome === "refused") {
			setRefusal({ refusal: result.value.refusal });
			return;
		}
		setValue("");
		scanner.reset();
		setAnswer(result.value);
		setModal(true);
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const read = readEntry(value);
		if (!read.ok) {
			setRefusal(null);
			action.clear();
			setProblem(read.problem);
			inputRef.current?.focus();
			return;
		}
		void record(read.entry);
	};

	const scan = async () => {
		setProblem(null);
		setRefusal(null);
		action.clear();
		const result = await scanner.scan();
		if (result === null) return;
		if (result.kind === "refused") {
			inputRef.current?.focus();
			return;
		}
		if (result.kind !== "content") return;
		const scanned = readScannedMember(result.content);
		if (!scanned.ok) {
			scanner.unreadable();
			return;
		}
		await record({
			kind: "code",
			code: scanned.code,
			payload: scanned.payload,
		});
	};

	const again = () => {
		setAnswer(null);
		setModal(false);
		action.clear();
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	const message =
		problem !== null
			? t(PROBLEM_KEYS[problem])
			: refusal !== null
				? t(refusalKey(refusal.refusal))
				: null;

	return (
		<LoyaltyFrame
			title={t("checkin.title")}
			testId="check-in"
			backDisabled={busy}
		>
			{answer !== null ? (
				<CheckinResult answer={answer} onAgain={again} />
			) : (
				<>
					<p className="text-base text-ink">{t("checkin.intro")}</p>
					<ScanButton
						state={scanner.state}
						disabled={busy}
						label={t("checkin.scan")}
						onScan={() => void scan()}
					/>
					<ScanNotice
						state={scanner.state}
						refusedKey="checkin.scanRefused"
						unreadableKey="checkin.scanUnreadable"
					/>
					<form className="flex flex-col gap-3" onSubmit={submit} noValidate>
						<label htmlFor={inputId} className="text-sm text-ink-muted">
							{t("checkin.label")}
						</label>
						<input
							ref={inputRef}
							id={inputId}
							data-testid="checkin-entry"
							value={value}
							onChange={(event) => {
								setValue(entryDigits(event.target.value));
								setProblem(null);
								setRefusal(null);
							}}
							inputMode="numeric"
							pattern="[0-9]*"
							enterKeyHint="done"
							autoComplete="off"
							maxLength={ENTRY_MAX_DIGITS}
							aria-invalid={message !== null}
							aria-describedby={
								message === null ? hintId : `${hintId} ${messageId}`
							}
							className={`${fieldClass} text-xl tracking-wider tabular-nums`}
						/>
						<p id={hintId} className="text-sm text-ink-muted">
							{t("checkin.hint")}
						</p>
						{message === null ? null : (
							<p
								id={messageId}
								role="alert"
								data-testid="checkin-problem"
								data-refusal={refusal?.refusal ?? problem ?? undefined}
								className="rounded-xl bg-negative-soft px-3 py-2 text-base text-negative"
							>
								{message}
							</p>
						)}
						{action.failure === null ? null : (
							<FailureAlert
								failure={action.failure}
								invalidKey="checkin.error.invalid"
							/>
						)}
						<button
							type="submit"
							className={primaryButton}
							data-action="primary"
							disabled={busy}
							aria-busy={busy}
						>
							<BusyLabel busy={busy} busyText={t("checkin.submitting")}>
								{t("checkin.submit")}
							</BusyLabel>
						</button>
					</form>
				</>
			)}
			{modal ? (
				<ResultModal
					message={t("checkin.recorded")}
					onDone={() => setModal(false)}
				/>
			) : null}
		</LoyaltyFrame>
	);
}
