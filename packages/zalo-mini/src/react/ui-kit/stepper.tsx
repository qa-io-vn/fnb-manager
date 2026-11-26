export interface StepperProps {
	readonly value: number;
	/** The smallest value; 1 for the quantity of a line in a cart. */
	readonly min?: number;
	readonly max: number;
	readonly onChange: (next: number) => void;
	/** At the smallest value the minus becomes a bin that calls this, when it is given; without it the minus stops. */
	readonly onRemove?: () => void;
	/** Names of the two buttons and the bin, for assistive technology: "Bớt một", "Thêm một", "Bỏ món". */
	readonly decreaseLabel: string;
	readonly increaseLabel: string;
	readonly removeLabel?: string;
	readonly testId?: string;
}

const HIT = "flex size-11 items-center justify-center rounded-full";
const RING =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * A quantity stepper: minus, the count, plus. The buttons have a 44 px target around a 36 px circle (a line_strong
 * outline for the minus, the accent for the plus); the count is a live region, so a change is read out. A button that
 * cannot act is disabled and drawn in the sunken fill and the muted ink, never with an opacity.
 */
export function Stepper({
	value,
	min = 1,
	max,
	onChange,
	onRemove,
	decreaseLabel,
	increaseLabel,
	removeLabel,
	testId,
}: StepperProps) {
	const atMin = value <= min;
	const removing = atMin && onRemove !== undefined;
	const minusDisabled = atMin && !removing;
	const plusDisabled = value >= max;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a plain group of buttons
		<div
			className="inline-flex items-center gap-1"
			data-testid={testId}
			role="group"
		>
			<button
				type="button"
				aria-label={removing ? (removeLabel ?? decreaseLabel) : decreaseLabel}
				disabled={minusDisabled}
				onClick={() => (removing ? onRemove?.() : onChange(value - 1))}
				className={`${HIT} ${RING}`}
				data-testid={testId === undefined ? undefined : `${testId}-minus`}
			>
				<span
					aria-hidden="true"
					className={`flex size-9 items-center justify-center rounded-full border-field ${minusDisabled ? "border-transparent bg-surface-sunken text-ink-muted" : "border-line-strong bg-surface-raised text-ink"}`}
				>
					{removing ? (
						<svg
							aria-hidden="true"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
						</svg>
					) : (
						<svg
							aria-hidden="true"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
						>
							<path d="M6 12h12" />
						</svg>
					)}
				</span>
			</button>
			<span
				aria-live="polite"
				className="min-w-8 text-center text-[17px] font-bold text-ink tabular-nums"
				data-testid={testId === undefined ? undefined : `${testId}-count`}
			>
				{value}
			</span>
			<button
				type="button"
				aria-label={increaseLabel}
				disabled={plusDisabled}
				onClick={() => onChange(value + 1)}
				className={`${HIT} ${RING}`}
				data-testid={testId === undefined ? undefined : `${testId}-plus`}
			>
				<span
					aria-hidden="true"
					className={`flex size-9 items-center justify-center rounded-full ${plusDisabled ? "bg-surface-sunken text-ink-muted" : "bg-accent text-accent-ink"}`}
				>
					<svg
						aria-hidden="true"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.4"
						strokeLinecap="round"
					>
						<path d="M12 6v12M6 12h12" />
					</svg>
				</span>
			</button>
		</div>
	);
}
