import type { MessageKey, Translate } from "../../i18n";
import type { SaveBarStatus } from "../forms/save-bar";

export type ProfileOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "saved" }
	| {
			readonly kind: "refused";
			readonly errorKey: MessageKey;
			readonly constraint: string | null;
	  };

export function profileOutcomeOf(mutation: {
	readonly errorKey: MessageKey | null;
	readonly errorConstraint: string | null;
	readonly saved: boolean;
}): ProfileOutcome {
	if (mutation.errorKey !== null) {
		return {
			kind: "refused",
			errorKey: mutation.errorKey,
			constraint: mutation.errorConstraint,
		};
	}
	return mutation.saved ? { kind: "saved" } : { kind: "idle" };
}

export function profileStatusOf(
	t: Translate,
	outcome: ProfileOutcome,
	pendingCount: number,
	showsIssue: boolean,
): SaveBarStatus | null {
	if (outcome.kind === "refused") {
		return { tone: "error", text: t(outcome.errorKey) };
	}
	if (showsIssue) {
		return { tone: "info", text: t("settings.saveBar.invalid") };
	}
	if (outcome.kind === "saved" && pendingCount === 0) {
		return { tone: "success", text: t("settings.saved") };
	}
	return null;
}
