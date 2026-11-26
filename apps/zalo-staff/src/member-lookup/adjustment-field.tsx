import { useI18n } from "@fnb/zalo-mini/react";
import { useId } from "react";
import { MAX_ADJUSTMENT } from "../loyalty/contract";
import { readAdjustment } from "../loyalty/model";
import { fieldClass, focusRing } from "../shift/parts";

const stepClass = `flex size-11 shrink-0 items-center justify-center rounded-control-xl border-outline border-edge text-xl font-semibold text-ink disabled:opacity-60 ${focusRing}`;

export function AdjustmentField({
	label,
	value,
	disabled,
	testId,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly disabled: boolean;
	readonly testId: string;
	readonly onChange: (value: string) => void;
}) {
	const { t } = useI18n();
	const inputId = useId();
	const current = readAdjustment(value);
	const step = (delta: number) => {
		const next = Math.max(
			-MAX_ADJUSTMENT,
			Math.min(MAX_ADJUSTMENT, (current ?? 0) + delta),
		);
		onChange(String(next));
	};
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={inputId} className="text-sm text-ink-muted">
				{label}
			</label>
			<div className="flex items-center gap-2">
				<button
					type="button"
					className={stepClass}
					disabled={disabled}
					onClick={() => step(-1)}
					aria-label={t("request.less", { what: label })}
				>
					−
				</button>
				<input
					id={inputId}
					data-testid={testId}
					value={value}
					disabled={disabled}
					onChange={(event) =>
						onChange(event.target.value.replace(/[^\d+\-−]/g, "").slice(0, 6))
					}
					inputMode="numeric"
					autoComplete="off"
					className={`${fieldClass} text-center text-lg tabular-nums`}
				/>
				<button
					type="button"
					className={stepClass}
					disabled={disabled}
					onClick={() => step(1)}
					aria-label={t("request.more", { what: label })}
				>
					+
				</button>
			</div>
		</div>
	);
}
