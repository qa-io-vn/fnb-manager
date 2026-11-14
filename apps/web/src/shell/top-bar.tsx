import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "../components/ui/cn";
import { fieldVariants } from "../components/ui/field";
import { useT } from "../i18n";
import type { Period } from "../lib/period";
import { useFormatters } from "../state/formatters";
import { usePreferences } from "../state/preferences";
import { type ReadyTenantScope, useTenantScope } from "../state/tenant-scope";
import { DemoBanner, DemoExitButton } from "./demo-banner";
import { FreshnessBadge } from "./freshness-badge";
import { LanguageToggle } from "./language-toggle";
import { activeSection } from "./navigation";
import { PeriodPicker, periodSummary } from "./period-picker";
import { SignOutButton } from "./sign-out-button";
import { StoreSelect, storeSelectionLabel } from "./store-select";
import { TenantSelect } from "./tenant-select";

const sectionsWithFixedPeriod = new Set(["", "bao-cao", "chu-de"]);

function ScopeControls() {
	const scope = useTenantScope();
	const { pathname } = useLocation();
	const { preferences, update } = usePreferences();
	if (scope.status !== "ready") return null;
	return (
		<ScopeControlsReady
			scope={scope}
			showPeriod={!sectionsWithFixedPeriod.has(activeSection(pathname))}
			period={preferences.period}
			onPeriodChange={(period) => update({ period })}
		/>
	);
}

function ScopeSummaryButton({
	summary,
	open,
	panelId,
	onToggle,
}: {
	summary: string;
	open: boolean;
	panelId: string;
	onToggle: () => void;
}) {
	const t = useT();
	return (
		<button
			type="button"
			aria-expanded={open}
			aria-controls={panelId}
			onClick={onToggle}
			className={cn(
				fieldVariants({ kind: "trigger" }),
				"min-w-0 flex-1 text-left lg:hidden",
			)}
			data-testid="scope-summary"
		>
			<span className="sr-only">{t("shell.scope")}</span>
			<span className="truncate font-semibold">{summary}</span>
			<span aria-hidden="true" className="ml-auto">
				{open ? "▴" : "▾"}
			</span>
		</button>
	);
}

function ScopeControlsReady({
	scope,
	showPeriod,
	period,
	onPeriodChange,
}: {
	scope: ReadyTenantScope;
	showPeriod: boolean;
	period: Period;
	onPeriodChange: (period: Period) => void;
}) {
	const t = useT();
	const formatters = useFormatters(scope.tenant);
	const panelId = useId();
	const [open, setOpen] = useState(false);
	const summary = [
		storeSelectionLabel(scope.stores, scope.selectedStores, t),
		...(showPeriod ? [periodSummary(period, t, formatters.date)] : []),
	].join(" · ");
	return (
		<div className="flex flex-wrap items-center gap-2 lg:items-end">
			<ScopeSummaryButton
				summary={summary}
				open={open}
				panelId={panelId}
				onToggle={() => setOpen((value) => !value)}
			/>
			<p className="hidden text-sm font-semibold print:block">{summary}</p>
			<div
				id={panelId}
				className={`${open ? "flex" : "hidden"} order-last w-full flex-wrap items-end gap-2 lg:order-none lg:flex lg:w-auto print:hidden`}
			>
				<TenantSelect
					tenants={scope.tenants}
					tenant={scope.tenant}
					onChange={scope.selectTenant}
				/>
				<StoreSelect
					stores={scope.stores}
					selected={scope.selectedStores}
					onChange={scope.selectStores}
				/>
				{showPeriod ? (
					<PeriodPicker
						period={period}
						onChange={onPeriodChange}
						formatDate={formatters.date}
					/>
				) : null}
			</div>
			<div className="lg:ml-auto lg:pb-3">
				<FreshnessBadge source={scope.source} tenant={scope.tenant} />
			</div>
		</div>
	);
}

export const TOP_BAR_HEIGHT_PROPERTY = "--top-bar-height";

function usePublishedHeight(
	element: RefObject<HTMLElement | null>,
	property: string,
) {
	useEffect(() => {
		const target = element.current;
		if (target === null || typeof ResizeObserver !== "function") return;
		const root = document.documentElement;
		const publish = () =>
			root.style.setProperty(property, `${target.offsetHeight}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(target);
		return () => {
			observer.disconnect();
			root.style.removeProperty(property);
		};
	}, [element, property]);
}

export function TopBar() {
	const t = useT();
	const header = useRef<HTMLElement>(null);
	usePublishedHeight(header, TOP_BAR_HEIGHT_PROPERTY);
	return (
		<header
			ref={header}
			className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur print:static"
		>
			<DemoBanner />
			<div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2">
				<div className="flex items-center justify-between gap-2">
					<p className="truncate text-lg font-semibold lg:invisible">
						{t("app.title")}
					</p>
					<div className="flex items-center gap-2">
						<LanguageToggle />
						<DemoExitButton />
						<SignOutButton />
					</div>
				</div>
				<ScopeControls />
			</div>
		</header>
	);
}
