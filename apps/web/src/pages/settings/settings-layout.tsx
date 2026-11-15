import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	Suspense,
	useEffect,
	useRef,
} from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAppMode } from "../../app-mode/app-mode";
import { useT } from "../../i18n";
import { translateKey } from "../../reports/typed-values";
import { TenantCatchUpBanner } from "../../settings/catch-up/catch-up-banner";
import {
	DEFAULT_SETTINGS_SLUG,
	SETTINGS_PAGES,
	type SettingsPageEntry,
	settingsPageOf,
} from "../../settings/pages";
import { PageHeading } from "../../shell/page-heading";

function SettingsNav({ current }: { current: SettingsPageEntry }) {
	const t = useT();
	const active = useRef<HTMLAnchorElement | null>(null);
	useEffect(() => {
		active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, []);
	return (
		<nav
			aria-label={t("settings.nav")}
			className="print:hidden"
			data-testid="settings-nav"
		>
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1 lg:flex-col lg:overflow-visible">
				{SETTINGS_PAGES.map((page) => {
					const isCurrent = page.slug === current.slug;
					return (
						<li key={page.slug} className="shrink-0">
							<Link
								ref={isCurrent ? active : undefined}
								to={`/cai-dat/${page.slug}`}
								aria-current={isCurrent ? "page" : undefined}
								className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
							>
								{translateKey(t, page.titleKey)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

function SettingsPlaceholder({ page }: { page: SettingsPageEntry }) {
	const t = useT();
	return (
		<div
			className="rounded-xl border border-dashed border-line bg-surface-raised p-5"
			data-testid="settings-placeholder"
		>
			<p className="mb-2 font-medium">{t("settings.placeholder.title")}</p>
			<p className="text-ink-muted">
				{t("settings.placeholder.body", {
					page: translateKey(t, page.titleKey),
					phase: page.phase,
				})}
			</p>
		</div>
	);
}

const loadedPages = new Map<string, LazyExoticComponent<ComponentType>>();

export function loadedPageOf(
	page: SettingsPageEntry,
): LazyExoticComponent<ComponentType> | null {
	if (page.load === null) return null;
	const known = loadedPages.get(page.slug);
	if (known !== undefined) return known;
	const loaded = lazy(page.load);
	loadedPages.set(page.slug, loaded);
	return loaded;
}

function SettingsPageBody({ page }: { page: SettingsPageEntry }) {
	const t = useT();
	const Loaded = loadedPageOf(page);
	if (Loaded === null) return <SettingsPlaceholder page={page} />;
	return (
		<Suspense
			key={page.slug}
			fallback={<p role="status">{t("app.loading")}</p>}
		>
			<Loaded />
		</Suspense>
	);
}

export function SettingsLayout() {
	const t = useT();
	const { mode } = useAppMode();
	const { slug } = useParams();
	const page = settingsPageOf(slug);
	if (page === null) {
		return <Navigate to={`/cai-dat/${DEFAULT_SETTINGS_SLUG}`} replace />;
	}
	return (
		<div className="space-y-4" data-testid="settings-layout">
			<PageHeading
				title={t("settings.title")}
				className="text-2xl font-semibold"
			/>
			{mode === "demo" ? (
				<p
					className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="settings-demo-note"
				>
					{t("settings.demoNote")}
				</p>
			) : null}
			<TenantCatchUpBanner />
			<div className="space-y-4 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
				<SettingsNav current={page} />
				<section
					aria-labelledby="settings-page-title"
					className="min-w-0 space-y-4"
				>
					<h2 id="settings-page-title" className="text-xl font-semibold">
						{translateKey(t, page.titleKey)}
					</h2>
					<SettingsPageBody page={page} />
				</section>
			</div>
		</div>
	);
}
