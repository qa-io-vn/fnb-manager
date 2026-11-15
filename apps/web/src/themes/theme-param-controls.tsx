import type {
	ThemeParamLabelValue,
	ThemeParamOption,
	ThemeParamSpec,
} from "@fnb/reports";
import { useEffect, useId, useRef, useState } from "react";
import { fieldVariants } from "../components/ui/field";
import { useT } from "../i18n";
import { DATE_IDLE_COMMIT_MS } from "../reports/period-navigator";
import { translateKey } from "../reports/typed-values";

export const PARAM_IDLE_COMMIT_MS = DATE_IDLE_COMMIT_MS;

export interface ThemeParamChoice {
	readonly spec: ThemeParamSpec;
	readonly options: readonly ThemeParamOption[] | null;
	readonly value: string;
}

type Translate = ReturnType<typeof useT>;

function labelValue(t: Translate, value: ThemeParamLabelValue): string {
	return "text" in value ? value.text : translateKey(t, value.key);
}

export function optionLabel(t: Translate, option: ThemeParamOption): string {
	const values =
		option.labelValues === undefined
			? undefined
			: Object.fromEntries(
					Object.entries(option.labelValues).map(([name, value]) => [
						name,
						labelValue(t, value),
					]),
				);
	return translateKey(t, option.labelKey, values);
}

export function shownValue(
	value: string,
	options: readonly ThemeParamOption[],
): string {
	const enabled = options.filter((option) => option.disabled !== true);
	return enabled.some((option) => option.value === value)
		? value
		: (enabled[0]?.value ?? "");
}

function controlId(paramId: string): string {
	return `theme-param-${paramId}`;
}

function useFocusOnMount(
	focus: boolean,
	element: () => HTMLElement | null | undefined,
) {
	const read = useRef(element);
	read.current = element;
	useEffect(() => {
		if (!focus) return;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		read.current()?.focus();
	}, [focus]);
}

function SelectControl({
	choice,
	focus,
	onChange,
}: {
	choice: ThemeParamChoice;
	focus: boolean;
	onChange: (value: string) => void;
}) {
	const t = useT();
	const id = useId();
	const options = choice.options;
	const shown = options === null ? "" : shownValue(choice.value, options);
	const [draft, setDraft] = useState(shown);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const committed = useRef<string | null>(null);
	const select = useRef<HTMLSelectElement>(null);
	useEffect(() => {
		setDraft(shown);
		committed.current = null;
	}, [shown]);
	useEffect(
		() => () => {
			if (timer.current !== null) clearTimeout(timer.current);
		},
		[],
	);
	useFocusOnMount(focus, () => select.current);
	if (options !== null && options.length === 0) return null;
	const commit = (value: string) => {
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
		if (value === shown || value === committed.current) return;
		committed.current = value;
		onChange(value);
	};
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<label htmlFor={id} className="text-xs text-ink-muted">
				{translateKey(t, choice.spec.labelKey)}
			</label>
			<select
				ref={select}
				id={id}
				className={`${fieldVariants()} w-full min-w-0 max-w-full`}
				value={options === null ? "" : draft}
				disabled={options === null}
				onChange={(event) => {
					const next = event.target.value;
					setDraft(next);
					if (timer.current !== null) clearTimeout(timer.current);
					timer.current = setTimeout(() => commit(next), PARAM_IDLE_COMMIT_MS);
				}}
				onBlur={() => commit(draft)}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit(draft);
				}}
				data-testid={controlId(choice.spec.id)}
			>
				{options === null ? (
					<option value="">{t("app.loading")}</option>
				) : (
					options.map((option) => (
						<option
							key={option.value}
							value={option.value}
							disabled={option.disabled === true}
						>
							{optionLabel(t, option)}
						</option>
					))
				)}
			</select>
		</div>
	);
}

function RadioControl({
	choice,
	focus,
	onChange,
}: {
	choice: ThemeParamChoice;
	focus: boolean;
	onChange: (value: string) => void;
}) {
	const t = useT();
	const name = useId();
	const group = useRef<HTMLFieldSetElement>(null);
	const options = choice.options ?? [];
	const shown = shownValue(choice.value, options);
	useFocusOnMount(focus, () =>
		group.current?.querySelector<HTMLInputElement>("input:checked"),
	);
	return (
		<fieldset
			ref={group}
			className="flex min-w-0 flex-col gap-1"
			data-testid={controlId(choice.spec.id)}
		>
			<legend className="text-xs text-ink-muted">
				{translateKey(t, choice.spec.labelKey)}
			</legend>
			<div className="flex flex-wrap gap-2">
				{options.map((option) => (
					<label
						key={option.value}
						className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-1 text-sm has-checked:border-accent has-disabled:opacity-60"
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							className="size-5 shrink-0 accent-accent"
							checked={shown === option.value}
							disabled={option.disabled === true}
							onChange={() => onChange(option.value)}
						/>
						<span>{optionLabel(t, option)}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}

export function ThemeParamControls({
	choices,
	focusParam = null,
	onChange,
}: {
	choices: readonly ThemeParamChoice[];
	focusParam?: string | null;
	onChange: (id: string, value: string) => void;
}) {
	if (choices.length === 0) return null;
	return (
		<div
			className="flex flex-col gap-3 print:hidden"
			data-testid="card-controls"
		>
			{choices.map((choice) =>
				choice.spec.control === "select" ? (
					<SelectControl
						key={choice.spec.id}
						choice={choice}
						focus={focusParam === choice.spec.id}
						onChange={(value) => onChange(choice.spec.id, value)}
					/>
				) : (
					<RadioControl
						key={choice.spec.id}
						choice={choice}
						focus={focusParam === choice.spec.id}
						onChange={(value) => onChange(choice.spec.id, value)}
					/>
				),
			)}
		</div>
	);
}
