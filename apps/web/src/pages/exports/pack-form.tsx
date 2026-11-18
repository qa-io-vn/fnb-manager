import {
	HORIZONS,
	MAX_PACK_STORES,
	PACK_LANGUAGES,
	TOKEN_LIMIT,
} from "@fnb/datapack";
import type { IsoDate } from "@fnb/reports";
import { useId } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import type { StoreRow } from "../../data/row-source";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { controlClass, Field } from "../../settings/forms/field";
import { CHECK_ROW, CHECKBOX, FIELDSET, LEGEND } from "./export-form";
import {
	type PackFailure,
	type PackFormValues,
	type PackTextField,
	requestTextLength,
	storeCountValid,
	TEXT_LIMITS,
	textTooLong,
} from "./pack-request";

export type PackOutcome =
	| {
			readonly kind: "failed";
			readonly failure: PackFailure;
			readonly code: string | null;
	  }
	| { readonly kind: "stopped" }
	| null;

export interface PackFormProps {
	readonly values: PackFormValues;
	readonly onChange: (values: PackFormValues) => void;
	readonly stores: readonly StoreRow[];
	readonly completeAsOf: IsoDate;
	readonly formatters: Formatters;
	readonly outcome: PackOutcome;
	readonly onBuild: () => void;
}

const FOCUS_SUGGESTIONS = [
	"exports.pack.focus.suggestion.afternoon",
	"exports.pack.focus.suggestion.ticket",
	"exports.pack.focus.suggestion.discounts",
	"exports.pack.focus.suggestion.quietHours",
] as const;

const TEXT_FIELDS: readonly {
	readonly field: PackTextField;
	readonly label: "exports.pack.form.focus" | "exports.pack.form.ownerNote";
	readonly hint:
		| "exports.pack.form.focusHint"
		| "exports.pack.form.ownerNoteHint";
	readonly rows: number;
}[] = [
	{
		field: "focus",
		label: "exports.pack.form.focus",
		hint: "exports.pack.form.focusHint",
		rows: 2,
	},
	{
		field: "ownerNote",
		label: "exports.pack.form.ownerNote",
		hint: "exports.pack.form.ownerNoteHint",
		rows: 4,
	},
];

export function packFormReady(
	values: PackFormValues,
	storeCount: number,
): boolean {
	return (
		storeCountValid(storeCount) &&
		!textTooLong(values, "focus") &&
		!textTooLong(values, "ownerNote")
	);
}

function Outcome({
	outcome,
	completeAsOf,
	formatters,
	onRetry,
}: {
	outcome: PackOutcome;
	completeAsOf: IsoDate;
	formatters: Formatters;
	onRetry: () => void;
}) {
	const t = useT();
	if (outcome === null) return null;
	if (outcome.kind === "stopped") {
		return (
			<p role="status" data-testid="pack-stopped">
				{t("exports.pack.stopped")}
			</p>
		);
	}
	return (
		<div
			role="alert"
			className="space-y-2 rounded-xl border border-negative bg-negative-soft p-4"
			data-testid="pack-failed"
			data-failure={outcome.failure}
		>
			<p className="font-medium" data-testid="pack-failed-message">
				{t(`exports.pack.error.${outcome.failure}`, {
					date: formatters.date(completeAsOf),
					max: MAX_PACK_STORES,
					limit: formatters.count(TOKEN_LIMIT),
				})}
			</p>
			{outcome.code === null ? null : (
				<p className="text-sm" data-testid="pack-failed-code">
					{t("exports.pack.error.code", { code: outcome.code })}
				</p>
			)}
			<Button tone="secondary" onClick={onRetry} data-testid="pack-retry">
				{t("exports.pack.error.retry")}
			</Button>
		</div>
	);
}

export function PackForm(props: PackFormProps) {
	const t = useT();
	const id = useId();
	const { values, onChange, formatters, stores } = props;
	const set = (patch: Partial<PackFormValues>) =>
		onChange({ ...values, ...patch });
	const storesId = `${id}-stores`;
	const storesHintId = `${id}-stores-hint`;
	const storesErrorId = `${id}-stores-error`;
	const storesValid = storeCountValid(stores.length);
	const ready = packFormReady(values, stores.length);
	return (
		<form
			aria-label={t("exports.pack.form.label")}
			className="space-y-4"
			data-testid="pack-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (ready) props.onBuild();
			}}
		>
			<section
				className={FIELDSET}
				aria-labelledby={storesId}
				aria-describedby={
					storesValid ? storesHintId : `${storesHintId} ${storesErrorId}`
				}
				data-testid="pack-stores-field"
			>
				<h3 id={storesId} className={LEGEND}>
					{t("exports.pack.form.stores")}
				</h3>
				<ul className="space-y-1 px-1">
					{stores.map((store) => (
						<li key={store.id} className="break-words">
							{store.name}
						</li>
					))}
				</ul>
				<p id={storesHintId} className="px-1 text-sm text-ink-muted">
					{t("exports.pack.form.storesHint", { max: MAX_PACK_STORES })}
				</p>
				{storesValid ? null : (
					<p
						id={storesErrorId}
						role="alert"
						className="px-1 text-sm font-medium text-negative"
						data-testid="pack-stores-error"
					>
						{t("exports.pack.form.storesError", { max: MAX_PACK_STORES })}
					</p>
				)}
			</section>
			<div className={FIELDSET}>
				<Field
					id={`${id}-as-of`}
					label={t("exports.pack.form.asOf")}
					hint={t("exports.pack.form.asOfHint", {
						date: formatters.date(props.completeAsOf),
					})}
				>
					{(control) => (
						<input
							{...control}
							type="date"
							max={props.completeAsOf}
							value={values.asOf}
							onChange={(event) => set({ asOf: event.target.value })}
							className={controlClass}
							data-testid="pack-as-of"
						/>
					)}
				</Field>
			</div>
			<fieldset className={FIELDSET}>
				<legend className={LEGEND}>{t("exports.pack.form.horizon")}</legend>
				{HORIZONS.map((horizon) => (
					<label key={horizon} className={CHECK_ROW}>
						<input
							type="radio"
							name={`${id}-horizon`}
							className={CHECKBOX}
							checked={values.horizon === horizon}
							onChange={() => set({ horizon })}
						/>
						<span>{t(`exports.pack.horizon.${horizon}`)}</span>
					</label>
				))}
			</fieldset>
			<div className={cn(FIELDSET, "space-y-3")}>
				{TEXT_FIELDS.map(({ field, label, hint, rows }) => {
					const max = TEXT_LIMITS[field];
					return (
						<div key={field} className="space-y-2">
							<Field
								id={`${id}-${field}`}
								label={t(label)}
								hint={`${t(hint)} ${t("exports.pack.form.length", {
									count: formatters.count(requestTextLength(values[field])),
									max: formatters.count(max),
								})}`}
								error={
									textTooLong(values, field)
										? t("exports.pack.form.tooLong", {
												max: formatters.count(max),
											})
										: null
								}
							>
								{(control) => (
									<textarea
										{...control}
										rows={rows}
										value={values[field]}
										onChange={(event) => set({ [field]: event.target.value })}
										className={cn(controlClass, "py-2")}
										data-testid={`pack-${field}`}
									/>
								)}
							</Field>
							{field === "focus" ? (
								<fieldset
									className="m-0 min-w-0 border-0 p-0"
									data-testid="pack-focus-suggestions"
								>
									<legend className="mb-1 text-sm text-ink-muted">
										{t("exports.pack.focus.suggestions")}
									</legend>
									<div className="flex flex-wrap gap-2">
										{FOCUS_SUGGESTIONS.map((key) => (
											<Button
												key={key}
												tone="secondary"
												size="compact"
												className="rounded-full"
												aria-pressed={values.focus === t(key)}
												onClick={() => set({ focus: t(key) })}
											>
												{t(key)}
											</Button>
										))}
									</div>
								</fieldset>
							) : null}
						</div>
					);
				})}
			</div>
			<fieldset className={FIELDSET}>
				<legend className={LEGEND}>{t("exports.pack.form.language")}</legend>
				{PACK_LANGUAGES.map((language) => (
					<label key={language} className={CHECK_ROW}>
						<input
							type="radio"
							name={`${id}-language`}
							className={CHECKBOX}
							checked={values.language === language}
							onChange={() => set({ language })}
						/>
						<span>{t(`exports.pack.language.${language}`)}</span>
					</label>
				))}
			</fieldset>
			<Button type="submit" disabled={!ready} data-testid="pack-build">
				{t("exports.pack.form.build")}
			</Button>
			<Outcome
				outcome={props.outcome}
				completeAsOf={props.completeAsOf}
				formatters={formatters}
				onRetry={props.onBuild}
			/>
		</form>
	);
}
