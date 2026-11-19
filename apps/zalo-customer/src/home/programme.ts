import type { Translate } from "@fnb/zalo-mini";
import type { Programme } from "@fnb/zalo-mini/loyalty";
import { shownDate } from "../data/dates";

export interface ProgrammeTexts {
	readonly summary: string;
	readonly reward: string;
	readonly rules: readonly string[];
	readonly period: string | null;
}

export function programmeTexts(
	programme: Programme,
	t: Translate,
): ProgrammeTexts {
	const rules = [
		programme.stampRule ?? t("programme.stampRule"),
		programme.stampValidityMonths === null
			? null
			: t("programme.stampValidity", {
					months: programme.stampValidityMonths,
				}),
		programme.pointsEnabled
			? (programme.pointsRule ?? t("programme.pointsRule"))
			: null,
		programme.pointsEnabled && programme.pointsExpiryMonths !== null
			? t("programme.pointsValidity", { months: programme.pointsExpiryMonths })
			: null,
		programme.welcomeStamps > 0
			? t("home.welcomeStamps", { count: programme.welcomeStamps })
			: null,
	].filter((rule): rule is string => rule !== null);
	const period =
		programme.startsOn === null
			? null
			: programme.endsOn === null
				? t("programme.from", { start: shownDate(programme.startsOn) })
				: t("programme.between", {
						start: shownDate(programme.startsOn),
						end: shownDate(programme.endsOn),
					});
	return {
		summary:
			programme.summary ??
			t("programme.summary", { count: programme.stampsPerCard }),
		reward:
			programme.rewardSummary ??
			t("programme.reward", { count: programme.stampsPerCard }),
		rules,
		period,
	};
}

export function retentionText(programme: Programme, t: Translate): string {
	return programme.retentionMonths === null
		? t("join.purpose.howLongPolicy")
		: t("join.purpose.howLong", { months: programme.retentionMonths });
}
