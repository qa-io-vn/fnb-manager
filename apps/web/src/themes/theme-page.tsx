import { type ThemeDefinition, themeKeys } from "@fnb/reports";
import { Button } from "../components/ui/button";
import { useT } from "../i18n";
import { ReportCardView } from "../reports/report-card-view";
import { translateKey } from "../reports/typed-values";
import { PageHeading } from "../shell/page-heading";
import { StatusMessage } from "../shell/scope-status";
import { storeSelectionLabel } from "../shell/store-select";
import { useFormatters } from "../state/formatters";
import { useReadyTenantScope } from "../state/tenant-scope";
import { RangePicker } from "./range-picker";
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
				className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-1"
				data-testid="report-cards"
			>
				{load.cards.map((state) => (
					<ReportCardView
						key={state.id}
						kind={definition.kind}
						state={state}
						formatters={formatters}
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
