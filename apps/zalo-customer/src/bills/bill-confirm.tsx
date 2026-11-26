import type {
	BillConfirmResult,
	BillDisputeResult,
	BillToConfirm,
	LoyaltyClient,
} from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useId, useState } from "react";
import { cleanAmount, groupedAmount } from "../claim/model";
import { useCustomerData } from "../data/customer-data";
import { shownInstant } from "../data/dates";
import {
	dangerButton,
	failureKey,
	fieldClass,
	primaryButton,
	Spinner,
	secondaryButton,
} from "../ui";
import {
	type BillOutcome,
	billOutcome,
	totalProblem,
	typedTotal,
} from "./model";

const TONES = {
	positive: "bg-positive-soft",
	pending: "bg-warning-soft",
	neutral: "bg-neutral-soft",
	negative: "bg-negative-soft",
} as const;

interface Answered {
	readonly bill: BillToConfirm;
	readonly outcome: BillOutcome;
}

type Busy = "confirm" | "dispute" | null;

/**
 * One bill a staff member recorded for the customer. The customer types the total they paid without ever seeing the
 * total the staff member typed (the wallet answer does not carry it): agreeing confirms the earn at once, a different
 * total sends it to a manager, and "Không đúng" reverses it.
 */
export function BillItem({
	bill,
	onAnswer,
}: {
	readonly bill: BillToConfirm;
	readonly onAnswer: (bill: BillToConfirm, outcome: BillOutcome) => void;
}) {
	const { t } = useI18n();
	const { client, recover } = useCustomerData();
	const [digits, setDigits] = useState("");
	const [shown, setShown] = useState(false);
	const [busy, setBusy] = useState<Busy>(null);
	const [asking, setAsking] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const totalId = useId();
	const problem = shown ? totalProblem(digits) : null;

	const run = async (
		kind: Exclude<Busy, null>,
		call: (
			active: LoyaltyClient,
		) => Promise<BillConfirmResult | BillDisputeResult>,
	) => {
		if (client === null || busy !== null) return;
		setBusy(kind);
		setFailure(null);
		try {
			const result = await call(client);
			setBusy(null);
			onAnswer(bill, billOutcome(result));
		} catch (error) {
			setBusy(null);
			setFailure(failureKey(recover(error)));
		}
	};

	const confirm = (event: FormEvent) => {
		event.preventDefault();
		setShown(true);
		const total = typedTotal(digits);
		if (total === null) return;
		void run("confirm", (active) => active.confirmBill(bill.id, total));
	};

	return (
		<li
			className="flex flex-col gap-3 rounded-card-xl border-card border-line px-4 py-3"
			data-testid="bill-to-confirm"
		>
			<div className="flex flex-col gap-0.5">
				<span className="text-body font-semibold text-ink">
					{t("bill.number", { bill: bill.billNo })}
				</span>
				<span className="text-sm text-ink">{bill.storeName}</span>
				<span className="text-sm text-ink-muted">
					{t("bill.recorded", { time: shownInstant(bill.recordedAt) })}
				</span>
				<span className="text-sm text-ink-muted" data-testid="bill-deadline">
					{t("bill.deadline", { time: shownInstant(bill.confirmBy) })}
				</span>
			</div>
			{asking ? (
				<div className="flex flex-col gap-2" data-testid="bill-dispute-ask">
					<p className="text-body text-ink">
						{t("bill.disputeAsk", { bill: bill.billNo })}
					</p>
					<button
						type="button"
						className={dangerButton}
						disabled={busy !== null}
						aria-busy={busy === "dispute"}
						onClick={() =>
							void run("dispute", (active) => active.disputeBill(bill.id))
						}
					>
						{busy === "dispute" ? <Spinner /> : null}
						{t("bill.disputeYes")}
					</button>
					<button
						type="button"
						className={secondaryButton}
						disabled={busy !== null}
						onClick={() => setAsking(false)}
					>
						{t("bill.disputeNo")}
					</button>
				</div>
			) : (
				<form className="flex flex-col gap-2" onSubmit={confirm} noValidate>
					<label htmlFor={totalId} className="text-sm text-ink-muted">
						{t("bill.total")}
					</label>
					<input
						id={totalId}
						value={groupedAmount(digits)}
						onChange={(event) => setDigits(cleanAmount(event.target.value))}
						inputMode="numeric"
						autoComplete="off"
						enterKeyHint="done"
						aria-invalid={problem !== null}
						aria-describedby={
							problem === null ? `${totalId}-hint` : `${totalId}-problem`
						}
						className={fieldClass}
						data-testid="bill-total"
					/>
					{problem === null ? (
						<p id={`${totalId}-hint`} className="text-sm text-ink-muted">
							{t("bill.totalHint")}
						</p>
					) : (
						<p id={`${totalId}-problem`} className="text-sm text-negative">
							{t(problem)}
						</p>
					)}
					<button
						type="submit"
						className={primaryButton}
						disabled={busy !== null}
						aria-busy={busy === "confirm"}
						data-testid="bill-confirm"
					>
						{busy === "confirm" ? <Spinner /> : null}
						{busy === "confirm" ? t("bill.confirming") : t("bill.confirm")}
					</button>
					<button
						type="button"
						className={dangerButton}
						disabled={busy !== null}
						onClick={() => setAsking(true)}
						data-testid="bill-dispute"
					>
						{t("bill.dispute")}
					</button>
				</form>
			)}
			{failure === null ? null : (
				<p role="alert" className="text-body text-negative">
					{t(failure)}
				</p>
			)}
		</li>
	);
}

/** The "Xác nhận hóa đơn" card of the wallet: the bills waiting for the customer, then what each answer did. */
export function BillsToConfirmCard({
	bills,
	onAnswered,
}: {
	readonly bills: readonly BillToConfirm[];
	readonly onAnswered: () => void;
}) {
	const { t } = useI18n();
	const titleId = useId();
	const [answered, setAnswered] = useState<readonly Answered[]>([]);
	const done = new Set(answered.map((answer) => answer.bill.id));
	const open = bills.filter((bill) => !done.has(bill.id));
	if (open.length === 0 && answered.length === 0) return null;
	return (
		<section
			aria-labelledby={titleId}
			className="flex flex-col gap-3 rounded-card-2xl bg-surface-raised p-4"
			data-testid="bills-to-confirm"
		>
			<h2 id={titleId} className="text-lg font-semibold text-ink">
				{t("bill.title")}
			</h2>
			{open.length === 0 ? null : (
				<>
					<p className="text-body text-ink">{t("bill.intro")}</p>
					<ul className="flex flex-col gap-3">
						{open.map((bill) => (
							<BillItem
								key={bill.id}
								bill={bill}
								onAnswer={(answeredBill, outcome) => {
									setAnswered((current) => [
										...current,
										{ bill: answeredBill, outcome },
									]);
									onAnswered();
								}}
							/>
						))}
					</ul>
				</>
			)}
			<div aria-live="polite" className="flex flex-col gap-2">
				{answered.map(({ bill, outcome }) => (
					<p
						key={bill.id}
						role="status"
						className={`rounded-card-xl px-3 py-2 text-body text-ink ${TONES[outcome.tone]}`}
						data-testid="bill-result"
						data-outcome={outcome.key}
					>
						{t(outcome.key, { bill: bill.billNo })}
					</p>
				))}
			</div>
		</section>
	);
}
