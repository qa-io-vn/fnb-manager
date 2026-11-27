import { useI18n } from "@fnb/zalo-mini/i18n";
import { PriceText } from "@fnb/zalo-mini/ui-kit";
import {
	type Counts,
	countTotal,
	DENOMINATIONS,
	type Denomination,
	parseNoteCount,
	setCount,
} from "../lib/cash";

const STEP =
	"flex size-11 items-center justify-center rounded-full border-field border-line-strong bg-surface-raised text-xl font-bold text-ink focus-visible:outline-2 focus-visible:outline-focus disabled:border-transparent disabled:bg-surface-sunken disabled:text-ink-muted";

/**
 * Q02 "Đếm tiền trong két": one row per note with − and + (44 px), the count as a labelled number field and the row's
 * subtotal; the total under the rows. Used for the opening cash and the blind count at clock-out.
 */
export function CashCounter({
	counts,
	onChange,
	testId,
}: {
	readonly counts: Counts;
	readonly onChange: (next: Counts) => void;
	readonly testId: string;
}) {
	const { t } = useI18n();
	const total = countTotal(counts);
	const row = (denomination: Denomination) => {
		const notes = counts[denomination] ?? 0;
		return (
			<li
				key={denomination}
				className="flex items-center gap-2 border-b border-line py-2 last:border-b-0"
			>
				<span className="w-24 shrink-0 font-bold">
					<PriceText amount={denomination} tone="ink" />
				</span>
				<button
					type="button"
					className={STEP}
					aria-label={t("cash.less", { note: denomination })}
					disabled={notes <= 0}
					onClick={() => onChange(setCount(counts, denomination, notes - 1))}
				>
					−
				</button>
				<input
					inputMode="numeric"
					className="h-11 w-16 rounded-field border-field border-line-strong bg-surface-raised text-center text-lg font-bold"
					aria-label={t("cash.notesOf", { note: denomination })}
					value={notes === 0 ? "" : String(notes)}
					placeholder="0"
					data-testid={`${testId}-${denomination}`}
					onChange={(event) => {
						const parsed = parseNoteCount(event.target.value);
						if (parsed !== null)
							onChange(setCount(counts, denomination, parsed));
					}}
				/>
				<button
					type="button"
					className={STEP}
					aria-label={t("cash.more", { note: denomination })}
					onClick={() => onChange(setCount(counts, denomination, notes + 1))}
				>
					+
				</button>
				<span className="ml-auto text-right font-bold tabular-nums">
					<PriceText
						amount={notes * denomination}
						tone={notes === 0 ? "muted" : "ink"}
					/>
				</span>
			</li>
		);
	};
	return (
		<div data-testid={testId}>
			<ul>{DENOMINATIONS.map(row)}</ul>
			<p
				className="flex items-baseline justify-between pt-3 text-lg font-extrabold"
				aria-live="polite"
			>
				<span>{t("cash.total")}</span>
				<PriceText
					amount={total}
					size="lead"
					tone="ink"
					testId={`${testId}-total`}
				/>
			</p>
		</div>
	);
}
