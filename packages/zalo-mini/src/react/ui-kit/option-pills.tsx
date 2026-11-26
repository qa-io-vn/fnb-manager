import type { ReactNode } from "react";

export interface OptionPill<T extends string> {
	readonly value: T;
	readonly label: string;
	/** A change of price or another small note inside the pill, written by the caller (a PriceText). */
	readonly note?: ReactNode;
}

interface Common<T extends string> {
	/** The question the options answer ("Cỡ ly"): the legend of the group. */
	readonly legend: string;
	readonly options: readonly OptionPill<T>[];
	/** A name shared by the group's inputs. */
	readonly name: string;
	readonly testId?: string;
}

export type OptionPillsProps<T extends string> =
	| (Common<T> & {
			readonly multiple?: false;
			readonly value: T | null;
			readonly onChange: (next: T) => void;
	  })
	| (Common<T> & {
			readonly multiple: true;
			readonly value: readonly T[];
			readonly onChange: (next: readonly T[]) => void;
	  });

const RING =
	"has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

/**
 * A group of option pills: radio buttons for one choice, checkboxes for several. Idle pills have a line_strong edge on a
 * card; a chosen one is filled with the accent and shows a check mark, so the choice is never colour alone.
 */
export function OptionPills<T extends string>(props: OptionPillsProps<T>) {
	const { legend, options, name, testId } = props;
	const chosen = (value: T): boolean =>
		props.multiple === true
			? props.value.includes(value)
			: props.value === value;
	const choose = (value: T): void => {
		if (props.multiple === true) {
			props.onChange(
				props.value.includes(value)
					? props.value.filter((entry) => entry !== value)
					: [...props.value, value],
			);
		} else {
			props.onChange(value);
		}
	};
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0" data-testid={testId}>
			<legend className="px-0 pb-2 text-body font-bold text-ink">
				{legend}
			</legend>
			<div className="flex flex-wrap gap-2">
				{options.map((option) => {
					const on = chosen(option.value);
					return (
						<label
							key={option.value}
							data-selected={on}
							className={`relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-control border-field px-4 text-body font-bold ${RING} ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface-raised text-ink"}`}
						>
							<input
								type={props.multiple === true ? "checkbox" : "radio"}
								name={name}
								value={option.value}
								checked={on}
								onChange={() => choose(option.value)}
								className="absolute -inset-0.5 m-0 size-[calc(100%+4px)] cursor-pointer appearance-none rounded-control opacity-0"
							/>
							{on ? (
								<svg
									aria-hidden="true"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.6"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M5 12.5l4.5 4.5L19 7.5" />
								</svg>
							) : null}
							<span>{option.label}</span>
							{option.note === undefined ? null : (
								<span className="text-[13px] font-semibold">{option.note}</span>
							)}
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}
