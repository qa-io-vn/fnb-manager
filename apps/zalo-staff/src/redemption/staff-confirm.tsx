import { useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useState } from "react";
import { ReasonField, RefusalAlert, useWhen } from "../bills/parts";
import type { ConfirmRefusal, VoidRefusal } from "../loyalty/bills-contract";
import { withinWindow } from "../loyalty/bills-model";
import type { RedemptionAnswer } from "../loyalty/contract";
import { useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import { type ReasonProblem, reasonProblem } from "../loyalty/model";
import { FailureAlert } from "../loyalty/parts";
import { BusyLabel, Hint } from "../shift/parts";
import { dangerButton, primaryButton, secondaryButton } from "../ui";

type Accepted = Extract<RedemptionAnswer, { outcome: "accepted" }>;

export type StaffPhase =
	| { readonly phase: "verified" }
	| {
			readonly phase: "confirmed";
			readonly voidUntil: string | null;
			readonly discountName: string | null;
	  }
	| { readonly phase: "voided" };

function VoidForm({
	redemptionId,
	onVoided,
	onCancel,
}: {
	readonly redemptionId: string;
	readonly onVoided: () => void;
	readonly onCancel: () => void;
}) {
	const { t } = useI18n();
	const { bills } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const [reason, setReason] = useState("");
	const [problem, setProblem] = useState<ReasonProblem | null>(null);
	const [refusal, setRefusal] = useState<VoidRefusal | "other" | null>(null);
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
			bills.voidRedemption(redemptionId, reason.trim()),
		);
		if (!result.ok) return;
		if (result.value.state === "refused") {
			setRefusal(result.value.refusal ?? "other");
			return;
		}
		onVoided();
	};
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => void submit(event)}
			noValidate
			data-testid="redeem-void-form"
		>
			<ReasonField
				label={t("redeem.staff.voidReason")}
				value={reason}
				disabled={busy}
				testId="redeem-void-reason"
				problem={problem}
				onChange={(value) => {
					setReason(value);
					setProblem(null);
					setRefusal(null);
				}}
			/>
			{refusal === null ? null : (
				<RefusalAlert
					text={t(`redeem.staff.voidRefusal.${refusal}`)}
					testId="redeem-void-refused"
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
					<BusyLabel busy={busy} busyText={t("redeem.staff.voiding")}>
						{t("redeem.staff.voidConfirm")}
					</BusyLabel>
				</button>
			</div>
		</form>
	);
}

/**
 * Staff mode: after a successful check the cashier confirms the reward at once (staff_confirm_redemption) and applies
 * the named manual discount on the POS; an owner or manager may void it within the window (staff_void_redemption).
 */
export function StaffConfirm({
	answer,
	phase,
	onPhase,
}: {
	readonly answer: Accepted;
	readonly phase: StaffPhase;
	readonly onPhase: (phase: StaffPhase) => void;
}) {
	const { t } = useI18n();
	const { bills, manager } = useLoyaltyEnv();
	const when = useWhen();
	const action = useLoyaltyAction();
	const [refusal, setRefusal] = useState<ConfirmRefusal | "other" | null>(null);
	const [voiding, setVoiding] = useState(false);
	const busy = action.busy;
	const instruction =
		answer.instruction.kind === "pos_discount"
			? answer.instruction.discountName
			: null;

	const confirm = async () => {
		if (busy) return;
		setRefusal(null);
		const result = await action.run(() =>
			bills.confirmRedemption(answer.redemptionId),
		);
		if (!result.ok) return;
		if (result.value.state === "refused") {
			setRefusal(result.value.refusal ?? "other");
			return;
		}
		onPhase({
			phase: "confirmed",
			voidUntil: result.value.voidUntil,
			discountName: result.value.posDiscountName ?? instruction,
		});
	};

	if (phase.phase === "verified") {
		return (
			<div className="flex flex-col gap-3" data-testid="redeem-staff">
				{refusal === null ? null : (
					<RefusalAlert
						text={t(`redeem.staff.refusal.${refusal}`)}
						testId="redeem-confirm-refused"
						refusal={refusal}
					/>
				)}
				{action.failure === null ? null : (
					<FailureAlert failure={action.failure} />
				)}
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					disabled={busy}
					aria-busy={busy}
					onClick={() => void confirm()}
				>
					<BusyLabel busy={busy} busyText={t("redeem.staff.confirming")}>
						{t("redeem.staff.confirm")}
					</BusyLabel>
				</button>
			</div>
		);
	}

	if (phase.phase === "voided") {
		return (
			<p
				role="status"
				data-testid="redeem-voided"
				className="rounded-card-xl bg-surface-sunken px-3 py-3 text-body text-ink"
			>
				{t("redeem.staff.voided")}
			</p>
		);
	}

	const voidable = manager && withinWindow(phase.voidUntil, new Date());
	return (
		<div
			className="flex flex-col gap-3 rounded-card-xl bg-positive-soft p-3"
			data-testid="redeem-confirmed"
		>
			<p className="text-lg font-semibold text-positive">
				{t("redeem.staff.confirmed")}
			</p>
			{phase.discountName === null ? null : (
				<>
					<p className="text-body text-ink">{t("redeem.staff.apply")}</p>
					<p
						className="text-xl font-semibold break-words text-ink"
						data-testid="redeem-confirmed-discount"
					>
						{phase.discountName}
					</p>
				</>
			)}
			{phase.voidUntil === null ? null : (
				<Hint testId="redeem-void-until">
					{t("redeem.staff.voidUntil", when(phase.voidUntil))}
				</Hint>
			)}
			{voidable && !voiding ? (
				<button
					type="button"
					className={dangerButton}
					onClick={() => setVoiding(true)}
				>
					{t("redeem.staff.void")}
				</button>
			) : null}
			{voidable && voiding ? (
				<VoidForm
					redemptionId={answer.redemptionId}
					onVoided={() => onPhase({ phase: "voided" })}
					onCancel={() => setVoiding(false)}
				/>
			) : null}
		</div>
	);
}
