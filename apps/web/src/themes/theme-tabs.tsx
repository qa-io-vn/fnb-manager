import {
	MAX_THEME_RANGE_DAYS,
	THEME_ORDER,
	THEME_SLUGS,
	type ThemeKind,
	type ThemeSlug,
	themeDefinitions,
	themeKeys,
} from "@fnb/reports";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";
import { translateKey } from "../reports/typed-values";

export const LATER_THEME_PHASE = "10b";

export interface ThemeTabEntry {
	readonly kind: ThemeKind;
	readonly slug: ThemeSlug;
	readonly titleKey: string;
	readonly maxRangeDays: number;
	readonly built: boolean;
}

const LATER_TITLE_KEYS: Readonly<Partial<Record<ThemeKind, string>>> =
	themeKeys.later;

export function themeTabEntries(): readonly ThemeTabEntry[] {
	return THEME_ORDER.flatMap((kind): ThemeTabEntry[] => {
		const definition = themeDefinitions[kind];
		if (definition !== undefined) {
			return [
				{
					kind,
					slug: definition.slug,
					titleKey: definition.titleKey,
					maxRangeDays: definition.maxRangeDays,
					built: true,
				},
			];
		}
		const titleKey = LATER_TITLE_KEYS[kind];
		return titleKey === undefined
			? []
			: [
					{
						kind,
						slug: THEME_SLUGS[kind],
						titleKey,
						maxRangeDays: MAX_THEME_RANGE_DAYS,
						built: false,
					},
				];
	});
}

export function laterThemeOfSlug(
	slug: string | undefined,
): ThemeTabEntry | null {
	return (
		themeTabEntries().find((entry) => !entry.built && entry.slug === slug) ??
		null
	);
}

export function ThemeTabs({
	kind,
	hrefFor,
}: {
	kind: ThemeKind;
	hrefFor: (target: ThemeTabEntry) => string;
}) {
	const t = useT();
	const current = useRef<HTMLAnchorElement | null>(null);
	const entries = themeTabEntries();
	const activeIndex = entries.findIndex((entry) => entry.kind === kind);
	useEffect(() => {
		if (activeIndex < 0) return;
		current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeIndex]);
	return (
		<nav
			aria-label={t(themeKeys.tabs.label)}
			className="print:hidden"
			data-testid="theme-tabs"
		>
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1">
				{entries.map((entry) => {
					const active = entry.kind === kind;
					return (
						<li key={entry.kind} className="shrink-0">
							<Link
								ref={active ? current : undefined}
								to={hrefFor(entry)}
								aria-current={active ? "page" : undefined}
								data-built={entry.built ? "true" : "false"}
								className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
							>
								{translateKey(t, entry.titleKey)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
