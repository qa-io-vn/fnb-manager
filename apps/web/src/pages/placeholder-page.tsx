import type { MessageKey } from "../i18n";
import { useT } from "../i18n";
import { PageHeading } from "../shell/page-heading";

export type PlaceholderSection =
	| "reports"
	| "topics"
	| "plans"
	| "settings"
	| "exports";

interface PlaceholderContent {
	title: MessageKey;
	body: MessageKey;
	phase: string;
}

export const placeholderContent: Record<
	PlaceholderSection,
	PlaceholderContent
> = {
	reports: {
		title: "placeholder.reports.title",
		body: "placeholder.reports.body",
		phase: "9",
	},
	topics: {
		title: "placeholder.topics.title",
		body: "placeholder.topics.body",
		phase: "10a, 10b",
	},
	plans: {
		title: "placeholder.plans.title",
		body: "placeholder.plans.body",
		phase: "11b",
	},
	settings: {
		title: "placeholder.settings.title",
		body: "placeholder.settings.body",
		phase: "10b, 12",
	},
	exports: {
		title: "placeholder.exports.title",
		body: "placeholder.exports.body",
		phase: "11a",
	},
};

export function PlaceholderPage({ section }: { section: PlaceholderSection }) {
	const t = useT();
	const content = placeholderContent[section];
	return (
		<div className="space-y-4">
			<PageHeading
				title={t(content.title)}
				className="text-2xl font-semibold"
			/>
			<div className="rounded-xl border border-dashed border-line bg-surface-raised p-5">
				<p className="mb-2 font-medium">{t("placeholder.coming")}</p>
				<p className="mb-3 text-ink-muted">{t(content.body)}</p>
				<p className="text-sm" data-testid="placeholder-phase">
					{t("placeholder.phase", { phase: content.phase })}
				</p>
			</div>
		</div>
	);
}
