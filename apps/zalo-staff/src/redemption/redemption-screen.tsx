import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useId, useRef, useState } from "react";
import type { RedemptionAnswer } from "../loyalty/contract";
import { MAX_REDEMPTION_CODE_LENGTH } from "../loyalty/contract";
import { useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import {
	isoDayIn,
	readScannedRedemption,
	redemptionCode,
	shownPhone,
} from "../loyalty/model";
import {
	FailureAlert,
	ScanButton,
	ScanNotice,
	useScanner,
	VisitChip,
} from "../loyalty/parts";
import { LoyaltyFrame, type LoyaltyScreenProps } from "../loyalty/route";
import { BusyLabel, Card, fieldClass, Hint } from "../shift/parts";
import { primaryButton } from "../ui";

type Accepted = Extract<RedemptionAnswer, { outcome: "accepted" }>;
type Refused = Extract<RedemptionAnswer, { outcome: "refused" }>;

function Instruction({ answer }: { readonly answer: Accepted }) {
	const { t } = useI18n();
	const instruction = answer.instruction;
	return (
		<div
			className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-3"
			data-testid="redeem-instruction"
			data-kind={instruction.kind}
		>
			<p className="text-base text-ink">
				{t(`redeem.instruction.${instruction.kind}`)}
			</p>
			{instruction.kind === "pos_discount" ? (
				<p
					className="text-xl font-semibold break-words text-ink"
					data-testid="redeem-apply"
				>
					{instruction.discountName}
				</p>
			) : (
				<p
					className="font-mono text-2xl font-semibold tracking-widest break-all text-ink"
					data-testid="redeem-apply"
				>
					{instruction.voucherCode}
				</p>
			)}
		</div>
	);
}

function AcceptedView({
	answer,
	onAgain,
}: {
	readonly answer: Accepted;
	readonly onAgain: () => void;
}) {
	const { t } = useI18n();
	const { formatters } = useLoyaltyEnv();
	return (
		<div className="flex flex-col gap-4" data-testid="redeem-result">
			<Card testId="redeem-accepted" state="pending">
				<div className="flex items-start justify-between gap-2">
					<div className="flex min-w-0 flex-col gap-0.5">
						<p className="text-sm text-ink-muted">{t("redeem.reward")}</p>
						<p
							className="text-lg font-semibold text-ink"
							data-testid="redeem-reward"
						>
							{answer.rewardName}
						</p>
					</div>
					<VisitChip state="pending" testId="redeem-state" />
				</div>
				<Instruction answer={answer} />
				{answer.minBillAmount === null ? null : (
					<p className="text-base text-ink" data-testid="redeem-min-bill">
						{t("redeem.minBill", {
							amount: formatters.moneyExact(answer.minBillAmount),
						})}
					</p>
				)}
				<Hint>{t(`redeem.pendingBody.${answer.instruction.kind}`)}</Hint>
				{answer.holdUntil === null ? null : (
					<p className="text-sm text-ink-muted">
						{t("redeem.holdUntil", {
							time: formatters.time(new Date(answer.holdUntil)),
						})}
					</p>
				)}
				{answer.phoneMasked === null ? null : (
					<p className="text-sm text-ink-muted" data-testid="redeem-member">
						{t("loyalty.member", { phone: shownPhone(answer.phoneMasked) })}
					</p>
				)}
			</Card>
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				onClick={onAgain}
			>
				{t("redeem.again")}
			</button>
		</div>
	);
}

function RefusedView({ answer }: { readonly answer: Refused }) {
	const { t } = useI18n();
	const { formatters, context } = useLoyaltyEnv();
	const refusal = answer.refusal ?? "other";
	let detail: string | null = null;
	if (refusal === "used" && answer.usedAt !== null) {
		const usedAt = new Date(answer.usedAt);
		const params = {
			time: formatters.time(usedAt),
			date: formatters.date(isoDayIn(usedAt, context.timeZone)),
		};
		detail =
			answer.usedStoreName === null
				? t("redeem.refusal.usedAtNoStore", params)
				: t("redeem.refusal.usedAt", {
						...params,
						store: answer.usedStoreName,
					});
	} else if (refusal !== "used") {
		detail = t(`redeem.refusal.${refusal}Body`);
	}
	return (
		<div
			role="alert"
			data-testid="redeem-refused"
			data-refusal={refusal}
			className="flex flex-col gap-1 rounded-xl bg-negative-soft px-3 py-3 text-negative"
		>
			<p className="text-lg font-semibold">{t(`redeem.refusal.${refusal}`)}</p>
			{detail === null ? null : <p className="text-base">{detail}</p>}
			<p className="text-base">{t("redeem.refusal.doNotApply")}</p>
		</div>
	);
}

export function RedemptionScreen(_: LoyaltyScreenProps) {
	const { t } = useI18n();
	const { client, store } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const scanner = useScanner("redemption");
	const inputId = useId();
	const problemId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState("");
	const [problem, setProblem] = useState(false);
	const [answer, setAnswer] = useState<RedemptionAnswer | null>(null);
	const [modal, setModal] = useState(false);
	const busy = action.busy;

	const verify = async (code: string) => {
		setProblem(false);
		setAnswer(null);
		const result = await action.run(() =>
			client.verifyRedemption(store.id, code),
		);
		if (!result.ok) return;
		setAnswer(result.value);
		if (result.value.outcome === "accepted") {
			setValue("");
			setModal(true);
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const code = redemptionCode(value);
		if (code === null) {
			setProblem(true);
			setAnswer(null);
			action.clear();
			inputRef.current?.focus();
			return;
		}
		void verify(code);
	};

	const scan = async () => {
		setProblem(false);
		setAnswer(null);
		action.clear();
		const result = await scanner.scan();
		if (result === null) return;
		if (result.kind === "refused") {
			inputRef.current?.focus();
			return;
		}
		if (result.kind !== "content") return;
		const scanned = readScannedRedemption(result.content);
		if (!scanned.ok) {
			scanner.unreadable();
			return;
		}
		setValue(scanned.code);
		await verify(scanned.code);
	};

	const again = () => {
		setAnswer(null);
		setModal(false);
		action.clear();
		scanner.reset();
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	return (
		<LoyaltyFrame
			title={t("redeem.title")}
			testId="redemption"
			backDisabled={busy}
		>
			{answer?.outcome === "accepted" ? (
				<AcceptedView answer={answer} onAgain={again} />
			) : (
				<>
					<p className="text-base text-ink">{t("redeem.intro")}</p>
					<ScanButton
						state={scanner.state}
						disabled={busy}
						label={t("redeem.scan")}
						onScan={() => void scan()}
					/>
					<ScanNotice
						state={scanner.state}
						refusedKey="redeem.scanRefused"
						unreadableKey="redeem.scanUnreadable"
					/>
					<form className="flex flex-col gap-3" onSubmit={submit} noValidate>
						<label htmlFor={inputId} className="text-sm text-ink-muted">
							{t("redeem.label")}
						</label>
						<input
							ref={inputRef}
							id={inputId}
							data-testid="redeem-code"
							value={value}
							onChange={(event) => {
								setValue(event.target.value.replace(/\s/g, ""));
								setProblem(false);
								setAnswer(null);
							}}
							autoCapitalize="characters"
							autoCorrect="off"
							spellCheck={false}
							autoComplete="off"
							enterKeyHint="done"
							maxLength={MAX_REDEMPTION_CODE_LENGTH}
							aria-invalid={problem || answer?.outcome === "refused"}
							aria-describedby={problem ? problemId : undefined}
							className={`${fieldClass} font-mono text-xl tracking-wider`}
						/>
						{problem ? (
							<p
								id={problemId}
								role="alert"
								className="rounded-xl bg-negative-soft px-3 py-2 text-base text-negative"
							>
								{t("redeem.problem")}
							</p>
						) : null}
						{answer?.outcome === "refused" ? (
							<RefusedView answer={answer} />
						) : null}
						{action.failure === null ? null : (
							<FailureAlert
								failure={action.failure}
								invalidKey="redeem.error.invalid"
							/>
						)}
						<button
							type="submit"
							className={primaryButton}
							data-action="primary"
							disabled={busy}
							aria-busy={busy}
						>
							<BusyLabel busy={busy} busyText={t("redeem.submitting")}>
								{t("redeem.submit")}
							</BusyLabel>
						</button>
					</form>
				</>
			)}
			{modal ? (
				<ResultModal
					message={t("redeem.valid")}
					onDone={() => setModal(false)}
				/>
			) : null}
		</LoyaltyFrame>
	);
}
