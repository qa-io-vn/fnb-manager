import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useId, useState } from "react";
import {
	type AdjustLimits,
	MAX_REASON_LENGTH,
	type RequestKind,
	type RequestState,
} from "../loyalty/contract";
import { useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import {
	type AmountProblem,
	amountProblem,
	needsManager,
	type ReasonProblem,
	readAdjustment,
	reasonProblem,
	shownPhone,
} from "../loyalty/model";
import { FailureAlert } from "../loyalty/parts";
import { Alert, BusyLabel, fieldClass, Hint, SubScreen } from "../shift/parts";
import { primaryButton } from "../ui";
import { AdjustmentField } from "./adjustment-field";

const REASON_KEYS: Readonly<Record<ReasonProblem, string>> = {
	empty: "request.problem.reason",
	long: "request.problem.reasonLong",
};

const AMOUNT_KEYS: Readonly<Record<AmountProblem, string>> = {
	number: "request.problem.number",
	zero: "request.problem.zero",
	large: "request.problem.large",
};

function resultKey(kind: RequestKind, state: RequestState): string {
	if (kind === "dispute") return "request.result.dispute";
	return state === "applied"
		? "request.result.applied"
		: "request.result.pending";
}

export function RequestForm({
	kind,
	membershipId,
	phoneMasked,
	limits,
	onDone,
	onBack,
}: {
	readonly kind: RequestKind;
	readonly membershipId: string;
	readonly phoneMasked: string;
	readonly limits: AdjustLimits | null;
	readonly onDone: () => void;
	readonly onBack: () => void;
}) {
	const { t } = useI18n();
	const { client, store, role } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const reasonId = useId();
	const [stamps, setStamps] = useState(kind === "dispute" ? "0" : "1");
	const [points, setPoints] = useState("0");
	const [reason, setReason] = useState("");
	const [problems, setProblems] = useState<{
		readonly amount: AmountProblem | null;
		readonly reason: ReasonProblem | null;
	}>({ amount: null, reason: null });
	const [sent, setSent] = useState<RequestState | null>(null);
	const busy = action.busy;
	const stampValue = readAdjustment(stamps);
	const pointValue = readAdjustment(points);
	const waitsForManager =
		kind === "adjustment" &&
		stampValue !== null &&
		pointValue !== null &&
		(stampValue !== 0 || pointValue !== 0) &&
		needsManager(role, stampValue, pointValue, limits);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const amount = amountProblem(stampValue, pointValue, kind === "adjustment");
		const why = reasonProblem(reason);
		setProblems({ amount, reason: why });
		if (amount !== null || why !== null) return;
		const result = await action.run(() =>
			client.request({
				kind,
				storeId: store.id,
				membershipId,
				reason: reason.trim(),
				stamps: stampValue ?? 0,
				points: pointValue ?? 0,
			}),
		);
		if (result.ok) setSent(result.value.state);
	};

	return (
		<SubScreen
			title={t(`request.title.${kind}`)}
			subtitle={t("loyalty.member", { phone: shownPhone(phoneMasked) })}
			onBack={onBack}
			backDisabled={busy}
			testId="request-form"
		>
			<p className="text-body text-ink">
				{kind === "dispute"
					? t("request.intro.dispute")
					: limits === null
						? t("request.intro.adjustmentNoLimit")
						: t("request.intro.adjustment", {
								stamps: limits.stamps,
								points: limits.points,
							})}
			</p>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
				noValidate
			>
				<div className="grid grid-cols-1 gap-3">
					<AdjustmentField
						label={t("request.stamps")}
						value={stamps}
						disabled={busy}
						testId="request-stamps"
						onChange={setStamps}
					/>
					<AdjustmentField
						label={t("request.points")}
						value={points}
						disabled={busy}
						testId="request-points"
						onChange={setPoints}
					/>
				</div>
				{problems.amount === null ? null : (
					<Alert testId="request-amount-problem">
						{t(AMOUNT_KEYS[problems.amount])}
					</Alert>
				)}
				{waitsForManager ? (
					<p
						className="rounded-card-xl bg-warning-soft px-3 py-2 text-body text-warning"
						data-testid="request-needs-manager"
					>
						{t("request.needsManager")}
					</p>
				) : null}
				<div className="flex flex-col gap-1">
					<label htmlFor={reasonId} className="text-sm text-ink-muted">
						{t("request.reason")}
					</label>
					<textarea
						id={reasonId}
						data-testid="request-reason"
						value={reason}
						disabled={busy}
						onChange={(event) => setReason(event.target.value)}
						maxLength={MAX_REASON_LENGTH}
						rows={3}
						className={`${fieldClass} min-h-24`}
					/>
					<Hint testId="privacy-reminder">{t("ops.noPersonalDetails")}</Hint>
				</div>
				{problems.reason === null ? null : (
					<Alert testId="request-reason-problem">
						{t(REASON_KEYS[problems.reason])}
					</Alert>
				)}
				{action.failure === null ? null : (
					<FailureAlert
						failure={action.failure}
						invalidKey="request.error.invalid"
					/>
				)}
				<button
					type="submit"
					className={primaryButton}
					data-action="primary"
					disabled={busy}
					aria-busy={busy}
				>
					<BusyLabel busy={busy} busyText={t("request.sending")}>
						{t("request.send")}
					</BusyLabel>
				</button>
			</form>
			{sent === null ? null : (
				<ResultModal message={t(resultKey(kind, sent))} onDone={onDone} />
			)}
		</SubScreen>
	);
}
