import { useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useId, useState } from "react";
import type {
	BillRefusal,
	BillState,
	ClaimRefusal,
	StoreBillMode,
} from "../loyalty/bills-contract";
import { MAX_BILL_REASON_LENGTH } from "../loyalty/bills-contract";
import { BILL_STATE_TONES } from "../loyalty/bills-model";
import { useLoyaltyEnv } from "../loyalty/env";
import { isoDayIn, type ReasonProblem } from "../loyalty/model";
import type { Failure } from "../shift/model";
import { Chip, fieldClass } from "../shift/parts";

export type ModeLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly mode: StoreBillMode }
	| { readonly status: "failed"; readonly failure: Failure };

/** the store's confirmation mode, asked once per screen and store */
export function useStoreBillMode(): ModeLoad & { reload(): void } {
	const { bills, store, recover } = useLoyaltyEnv();
	const [load, setLoad] = useState<ModeLoad>({ status: "loading" });
	const reload = useCallback(() => {
		let active = true;
		setLoad({ status: "loading" });
		bills.mode(store.id).then(
			(mode) => {
				if (active) setLoad({ status: "ready", mode });
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
	return { ...load, reload };
}

export function useWhen() {
	const { formatters, context } = useLoyaltyEnv();
	return useCallback(
		(iso: string) => {
			const instant = new Date(iso);
			return {
				time: formatters.time(instant),
				date: formatters.date(isoDayIn(instant, context.timeZone)),
			};
		},
		[formatters, context.timeZone],
	);
}

export function BillStateChip({
	state,
	testId = "bill-state",
}: {
	readonly state: BillState;
	readonly testId?: string;
}) {
	const { t } = useI18n();
	return (
		<Chip tone={BILL_STATE_TONES[state]} testId={testId}>
			{t(`bills.state.${state}`)}
		</Chip>
	);
}

/** the precheck and code refusals of a bill, shared by Ghi hóa đơn and the counter claims */
export function billRefusalKey(refusal: BillRefusal | null): string {
	return `bills.refusal.${refusal ?? "other"}`;
}

export function claimRefusalKey(refusal: ClaimRefusal | null): string {
	if (refusal === "already_answered" || refusal === "expired")
		return `counter.refusal.${refusal}`;
	if (refusal === null || refusal === "locked") return "counter.refusal.other";
	return billRefusalKey(refusal);
}

export function reasonProblemKey(problem: ReasonProblem): string {
	return `bills.reasonProblem.${problem}`;
}

export function ReasonField({
	label,
	value,
	disabled,
	testId,
	problem,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly disabled: boolean;
	readonly testId: string;
	readonly problem: ReasonProblem | null;
	readonly onChange: (value: string) => void;
}) {
	const { t } = useI18n();
	const id = useId();
	const problemId = useId();
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm text-ink-muted">
				{label}
			</label>
			<textarea
				id={id}
				data-testid={testId}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				maxLength={MAX_BILL_REASON_LENGTH}
				rows={2}
				aria-invalid={problem !== null}
				aria-describedby={problem === null ? undefined : problemId}
				className={`${fieldClass} min-h-20`}
			/>
			{problem === null ? null : (
				<p
					id={problemId}
					role="alert"
					data-testid={`${testId}-problem`}
					className="rounded-xl bg-negative-soft px-3 py-2 text-base text-negative"
				>
					{t(reasonProblemKey(problem))}
				</p>
			)}
		</div>
	);
}

export function RefusalAlert({
	text,
	testId,
	refusal,
}: {
	readonly text: string;
	readonly testId: string;
	readonly refusal: string;
}) {
	return (
		<p
			role="alert"
			data-testid={testId}
			data-refusal={refusal}
			className="rounded-xl bg-negative-soft px-3 py-2 text-base text-negative"
		>
			{text}
		</p>
	);
}
