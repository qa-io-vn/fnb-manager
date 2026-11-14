import {
	THEME_ORDER,
	type ThemeDefinition,
	type ThemeKind,
	themeDefinitions,
	themeKeys,
} from "@fnb/reports";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";
import { translateKey } from "../reports/typed-values";

export function builtThemes(): readonly ThemeDefinition[] {
	return THEME_ORDER.flatMap((kind) => {
		const definition = themeDefinitions[kind];
		return definition === undefined ? [] : [definition];
	});
}

export function ThemeTabs({
	kind,
	hrefFor,
}: {
	kind: ThemeKind;
	hrefFor: (target: ThemeDefinition) => string;
}) {
	const t = useT();
	const current = useRef<HTMLAnchorElement | null>(null);
	useEffect(() => {
		current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, []);
	return (
		<nav
			aria-label={t(themeKeys.tabs.label)}
			className="print:hidden"
			data-testid="theme-tabs"
		>
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1">
				{builtThemes().map((definition) => {
					const active = definition.kind === kind;
					return (
						<li key={definition.kind} className="shrink-0">
							<Link
								ref={active ? current : undefined}
								to={hrefFor(definition)}
								aria-current={active ? "page" : undefined}
								className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
							>
								{translateKey(t, definition.titleKey)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
