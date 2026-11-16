import {
	THEME_ORDER,
	type ThemeKind,
	type ThemeSlug,
	themeDefinitions,
	themeKeys,
} from "@fnb/reports";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";
import { translateKey } from "../reports/typed-values";

export interface ThemeTabEntry {
	readonly kind: ThemeKind;
	readonly slug: ThemeSlug;
	readonly titleKey: string;
	readonly maxRangeDays: number;
}

export function themeTabEntries(): readonly ThemeTabEntry[] {
	return THEME_ORDER.map((kind) => {
		const definition = themeDefinitions[kind];
		return {
			kind,
			slug: definition.slug,
			titleKey: definition.titleKey,
			maxRangeDays: definition.maxRangeDays,
		};
	});
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
