import type { CashCountRow, CashCountState } from "@fnb/zalo-mini";
import { Popup, ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { useState } from "react";
import { failureKey, useAction, useShiftEnv } from "../shift/env";
import {
	Alert,
	BusyLabel,
	Card,
	Chip,
	Hint,
	quietAction,
	type Tone,
} from "../shift/parts";
import { primaryButton, secondaryButton } from "../ui";
import { signedMoney } from "./model";

const STATE_TONES: Readonly<Record<CashCountState, Tone>> = {
	over: "warning",
	within: "positive",
	no_count: "neutral",
	unmatched: "neutral",
	no_reference: "neutral",
	recorded: "positive",
};

function ShiftRow({
	row,
	onReopen,
}: {
	readonly row: CashCountRow;
	readonly onReopen: (row: CashCountRow) => void;
}) {
	const { t } = useI18n();
	const { formatters } = useShiftEnv();
	const date = formatters.date(row.businessDate);
	return (
		<Card testId="cash-shift" state={row.state}>
			<div className="flex items-start justify-between gap-2">
				<p className="text-body font-semibold text-ink">
					{row.shiftNumber !== null
						? t("cash.shiftOn", {
								shift: t("ops.shift", { n: row.shiftNumber }),
								date,
							})
						: t("cash.countOn", { date })}
				</p>
				<Chip tone={STATE_TONES[row.state]} testId="cash-state">
					{t(`cash.state.${row.state}`)}
				</Chip>
			</div>
			<dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
				<dt className="text-ink-muted">{t("cash.counted")}</dt>
				<dd className="text-right tabular-nums text-ink">
					{row.countedAmount === null
						? "—"
						: formatters.moneyExact(row.countedAmount)}
				</dd>
				<dt className="text-ink-muted">{t("cash.expected")}</dt>
				<dd className="text-right tabular-nums text-ink">
					{row.expectedCash === null
						? "—"
						: formatters.moneyExact(row.expectedCash)}
				</dd>
				<dt className="text-ink-muted">{t("cash.difference")}</dt>
				<dd
					className={`text-right font-semibold tabular-nums ${row.state === "over" ? "text-warning" : "text-ink"}`}
					data-testid="cash-difference"
				>
					{row.variance === null
						? "—"
						: signedMoney(row.variance, formatters.moneyExact)}
				</dd>
			</dl>
			{row.recounts > 0 ? (
				<Hint>{t("cash.recounts", { count: row.recounts })}</Hint>
			) : null}
			{row.cashCountId !== null ? (
				<button
					type="button"
					className={`${quietAction} self-start`}
					onClick={() => onReopen(row)}
				>
					{t("cash.reopen")}
				</button>
			) : null}
		</Card>
	);
}

export function CashReview({
	rows,
	onChanged,
}: {
	readonly rows: readonly CashCountRow[];
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const { ops } = useShiftEnv();
	const action = useAction();
	const [reopening, setReopening] = useState<CashCountRow | null>(null);
	const [done, setDone] = useState(false);
	const reopen = async () => {
		const id = reopening?.cashCountId;
		if (id === null || id === undefined) return;
		const result = await action.run(() => ops.reopenCashCount(id));
		if (result.ok) {
			setReopening(null);
			setDone(true);
		}
	};
	if (rows.length === 0) {
		return <Hint testId="cash-empty">{t("cash.none")}</Hint>;
	}
	return (
		<div className="flex flex-col gap-3" data-testid="cash-review">
			{[...rows].reverse().map((row) => (
				<ShiftRow
					key={`${row.businessDate}-${row.shiftId ?? row.cashCountId ?? "none"}`}
					row={row}
					onReopen={(chosen) => {
						action.clear();
						setReopening(chosen);
					}}
				/>
			))}
			{reopening !== null ? (
				<Popup
					title={t("cash.reopenTitle")}
					onClose={() => setReopening(null)}
					testId="reopen-confirm"
					footer={
						<>
							<button
								type="button"
								className={primaryButton}
								data-action="primary"
								disabled={action.busy}
								aria-busy={action.busy}
								onClick={reopen}
							>
								<BusyLabel busy={action.busy} busyText={t("review.saving")}>
									{t("cash.reopenConfirm")}
								</BusyLabel>
							</button>
							<button
								type="button"
								className={secondaryButton}
								disabled={action.busy}
								onClick={() => setReopening(null)}
							>
								{t("cash.keep")}
							</button>
						</>
					}
				>
					<p className="text-body text-ink">{t("cash.reopenBody")}</p>
					{action.failure !== null ? (
						<Alert>{t(failureKey(action.failure))}</Alert>
					) : null}
				</Popup>
			) : null}
			{done ? (
				<ResultModal
					message={t("cash.reopened")}
					onDone={() => {
						setDone(false);
						onChanged();
					}}
				/>
			) : null}
		</div>
	);
}
