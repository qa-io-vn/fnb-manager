import { TextLink } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import { PageHeading } from "../../shell/page-heading";
import { PACK_TAB_PATH, PLAN_PASTE_PATH } from "../exports/paths";

export const PLAN_LIST_PHASE = "11b";

export function PlansPage() {
	const t = useT();
	const steps = [
		{
			to: PACK_TAB_PATH,
			label: t("plans.home.pack"),
			hint: t("plans.home.packHint"),
		},
		{
			to: PLAN_PASTE_PATH,
			label: t("plans.home.paste"),
			hint: t("plans.home.pasteHint"),
		},
	];
	return (
		<div className="space-y-4" data-testid="plans-page">
			<PageHeading
				title={t("plans.title")}
				className="text-2xl font-semibold"
			/>
			<div className="space-y-3 rounded-xl border border-line bg-surface-raised p-5">
				<p className="font-medium">{t("plans.home.now")}</p>
				<ul className="space-y-3" data-testid="plans-next-steps">
					{steps.map((step) => (
						<li key={step.to} className="space-y-1">
							<TextLink to={step.to} className="font-medium">
								{step.label}
							</TextLink>
							<p className="text-sm text-ink-muted">{step.hint}</p>
						</li>
					))}
				</ul>
				<p className="text-sm" data-testid="placeholder-phase">
					{t("plans.home.coming", { phase: PLAN_LIST_PHASE })}
				</p>
			</div>
		</div>
	);
}
