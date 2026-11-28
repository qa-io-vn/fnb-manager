export interface ToggleProps {
	/** The switch's name for assistive technology ("Nhận tin ưu đãi qua Zalo"). */
	readonly label: string;
	readonly checked: boolean;
	/** The state word drawn beside the switch ("Đang bật" / "Đang tắt"), so the state never rests on colour alone. */
	readonly stateLabel: string;
	readonly onChange: (next: boolean) => void;
	readonly disabled?: boolean;
	readonly busy?: boolean;
	readonly testId?: string;
}

const RING =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * An on/off switch (design spec: `Toggle`, C12, S05, S13): a button with role="switch" and aria-checked, drawn 48 × 28
 * in a 44-pixel target; on is the positive track with a white knob, off the sunken track with a 1.5 px strong edge (the
 * off state's edge reaches 3:1 against the card). The state word sits beside it. Tapping asks the caller to change the
 * state; the caller decides (a confirm sheet may come first) and passes the new state back.
 */
export function Toggle({
	label,
	checked,
	stateLabel,
	onChange,
	disabled = false,
	busy = false,
	testId,
}: ToggleProps) {
	return (
		<span className="inline-flex items-center gap-2">
			<span className="text-[13px] font-bold text-ink" aria-hidden="true">
				{stateLabel}
			</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				aria-busy={busy || undefined}
				disabled={disabled}
				data-testid={testId}
				data-state={checked ? "on" : "off"}
				onClick={() => {
					if (!busy) onChange(!checked);
				}}
				className={`inline-flex min-h-11 min-w-12 items-center justify-center rounded-control disabled:cursor-not-allowed ${RING}`}
			>
				<span
					aria-hidden="true"
					className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${checked ? "bg-positive" : "border-[1.5px] border-line-strong bg-surface-sunken"}`}
				>
					<span
						className={`absolute size-5 rounded-full bg-white shadow-card transition-transform ${checked ? "translate-x-6" : "translate-x-[3px] border border-line-strong"}`}
					/>
				</span>
			</button>
		</span>
	);
}
