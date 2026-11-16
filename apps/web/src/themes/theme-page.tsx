import {
	type ThemeCallResults,
	type ThemeContext,
	type ThemeDefinition,
	type ThemeParamOption,
	type ThemeParamSpec,
	themeKeys,
	themeParamOptions,
	themeParamsOfCard,
} from "@fnb/reports";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { useT } from "../i18n";
import { ReportCardView } from "../reports/report-card-view";
import { translateKey } from "../reports/typed-values";
import { CatchUpBanner } from "../settings/catch-up/catch-up-banner";
import { PageHeading } from "../shell/page-heading";
import { StatusMessage } from "../shell/scope-status";
import { storeSelectionLabel } from "../shell/store-select";
import { useFormatters } from "../state/formatters";
import { useReadyTenantScope } from "../state/tenant-scope";
import { RangePicker } from "./range-picker";
import { ThemeParamControls } from "./theme-param-controls";
import { ThemeTabs } from "./theme-tabs";
import { type ThemeLocation, useThemeContext } from "./use-theme-context";
import { useThemeLoad } from "./use-theme-load";

function Notice({ testId, children }: { testId: string; children: string }) {
	return (
		<p
			role="note"
			className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
			data-testid={testId}
		>
			{children}
		</p>
	);
}

interface KeptOptions {
	readonly scope: string;
	readonly options: readonly ThemeParamOption[];
}

export function paramOptionsScope(
	context: ThemeContext,
	paramId: string,
): string {
	const others = Object.entries(context.params)
		.filter(([id]) => id !== paramId)
		.sort(([left], [right]) => (left < right ? -1 : 1));
	return JSON.stringify([
		context.range.from,
		context.range.to,
		context.stores.map((store) => store.id),
		others,
	]);
}

function fixedOptionsOf(
	spec: ThemeParamSpec,
): readonly ThemeParamOption[] | null {
	return spec.options.length > 0 ? spec.options : null;
}

function CardControls({
	definition,
	cardId,
	context,
	answered,
	focusParam,
	onChange,
}: {
	definition: ThemeDefinition;
	cardId: string;
	context: ThemeContext;
	answered: ThemeCallResults;
	focusParam: string | null;
	onChange: (id: string, value: string, replace: boolean) => void;
}) {
	const specs = themeParamsOfCard(definition.params, cardId);
	const kept = useRef(new Map<string, KeptOptions>());
	const choices = specs.map((spec) => {
		const scope = paramOptionsScope(context, spec.id);
		const answeredOptions = themeParamOptions(spec, answered);
		const previous = kept.current.get(spec.id);
		if (answeredOptions !== null) {
			kept.current.set(spec.id, { scope, options: answeredOptions });
		}
		return {
			spec,
			options:
				answeredOptions ??
				(previous?.scope === scope ? previous.options : null) ??
				fixedOptionsOf(spec),
			value: context.params[spec.id] ?? spec.defaultValue,
		};
	});
	const unoffered = choices.find(
		(choice) =>
			choice.spec.optionsFrom !== undefined &&
			choice.options !== null &&
			choice.value !== choice.spec.defaultValue &&
			!choice.options.some(
				(option) => option.value === choice.value && option.disabled !== true,
			),
	);
	const unofferedId = unoffered?.spec.id ?? null;
	const unofferedDefault = unoffered?.spec.defaultValue ?? "";
	const latestChange = useRef(onChange);
	latestChange.current = onChange;
	useEffect(() => {
		if (unofferedId !== null) {
			latestChange.current(unofferedId, unofferedDefault, true);
		}
	}, [unofferedId, unofferedDefault]);
	if (specs.length === 0) return null;
	return (
		<ThemeParamControls
			choices={choices}
			focusParam={focusParam}
			onChange={(id, value) => onChange(id, value, false)}
		/>
	);
}

function ThemeCards({
	definition,
	location,
}: {
	definition: ThemeDefinition;
	location: ThemeLocation;
}) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const { context } = location;
	const load = useThemeLoad(definition, context);
	const [focused, setFocused] = useState<{
		readonly cardId: string;
		readonly paramId: string;
	} | null>(null);
	const { goTo } = location;
	const changeParam = useCallback(
		(cardId: string, id: string, value: string, replace: boolean) => {
			if (!replace) setFocused({ cardId, paramId: id });
			goTo(context.range, {
				replace,
				params: { ...context.params, [id]: value },
			});
		},
		[goTo, context.range, context.params],
	);
	return (
		<>
			{load.failed ? (
				<StatusMessage>
					<p role="alert" className="mb-3">
						{t("app.error")}
					</p>
					<Button type="button" onClick={load.retry}>
						{t("app.retry")}
					</Button>
				</StatusMessage>
			) : null}
			<p className="hidden text-sm print:block" data-testid="print-summary">
				{t(themeKeys.print.summary, {
					report: translateKey(t, definition.titleKey),
					range: t(themeKeys.range.span, {
						from: formatters.date(context.range.from),
						to: formatters.date(context.range.to),
					}),
					stores: storeSelectionLabel(
						scope.stores,
						scope.stores.filter((store) =>
							context.stores.some((selected) => selected.id === store.id),
						),
						t,
					),
					date: formatters.date(context.range.to),
				})}
			</p>
			<div
				className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-1"
				data-testid="report-cards"
			>
				{load.cards.map((state) => (
					<ReportCardView
						key={state.id}
						kind={definition.kind}
						state={state}
						formatters={formatters}
						wide={
							definition.cards.find((card) => card.id === state.id)?.wide ===
							true
						}
						controls={
							<CardControls
								definition={definition}
								cardId={state.id}
								context={context}
								answered={load.answered}
								focusParam={
									focused?.cardId === state.id ? focused.paramId : null
								}
								onChange={(id, value, replace) =>
									changeParam(state.id, id, value, replace)
								}
							/>
						}
					/>
				))}
			</div>
		</>
	);
}

export function ThemePage({ definition }: { definition: ThemeDefinition }) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const location = useThemeContext(definition);
	const { context } = location;
	return (
		<div className="space-y-4">
			<PageHeading
				title={translateKey(t, definition.titleKey)}
				className="text-2xl font-semibold"
			/>
			<ThemeTabs
				kind={definition.kind}
				hrefFor={(target) => location.hrefFor(target)}
			/>
			<RangePicker
				range={context.range}
				maxDays={definition.maxRangeDays}
				formatters={formatters}
				onChange={(range, options) => location.goTo(range, options)}
			/>
			{location.rangeClamped ? (
				<Notice testId="range-clamped">
					{t(themeKeys.page.rangeClamped, {
						days: formatters.count(definition.maxRangeDays),
					})}
				</Notice>
			) : null}
			{location.todayClamped ? (
				<Notice testId="range-today-clamped">
					{t(themeKeys.page.todayClamped, {
						date: formatters.date(context.range.to),
					})}
				</Notice>
			) : null}
			{location.invalid ? (
				<Notice testId="range-invalid">{t(themeKeys.page.invalidRange)}</Notice>
			) : null}
			<CatchUpBanner formatters={formatters} timeZone={scope.tenant.timeZone} />
			{context.stores.length === 0 ? (
				<StatusMessage>
					<p>{t(themeKeys.page.noStores)}</p>
				</StatusMessage>
			) : (
				<ThemeCards definition={definition} location={location} />
			)}
		</div>
	);
}
