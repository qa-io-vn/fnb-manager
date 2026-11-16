import { Button } from "../../components/ui/button";
import { type MessageKey, useT } from "../../i18n";
import type { SaveBarStatus } from "./save-bar";

export type SaveOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "saved" }
	| {
			readonly kind: "refused";
			readonly messageKey: MessageKey;
			readonly canRetry: boolean;
	  };

export interface MutationResult {
	readonly saved: boolean;
	readonly errorKey: MessageKey | null;
	readonly canRetry: boolean;
}

export function saveOutcomeOf({
	saved,
	errorKey,
	canRetry,
}: MutationResult): SaveOutcome {
	if (errorKey !== null) {
		return { kind: "refused", messageKey: errorKey, canRetry };
	}
	return saved ? { kind: "saved" } : { kind: "idle" };
}

export function saveStatusOf(
	t: (key: MessageKey) => string,
	outcome: SaveOutcome,
	pendingCount: number,
): SaveBarStatus | null {
	if (outcome.kind === "refused") {
		return { tone: "error", text: t(outcome.messageKey) };
	}
	if (outcome.kind === "saved" && pendingCount === 0) {
		return { tone: "success", text: t("settings.saved") };
	}
	return null;
}

export function RetrySave({
	outcome,
	saving,
	onRetry,
}: {
	readonly outcome: SaveOutcome;
	readonly saving: boolean;
	readonly onRetry: () => void;
}) {
	const t = useT();
	if (outcome.kind !== "refused" || !outcome.canRetry) return null;
	return (
		<Button
			tone="secondary"
			size="compact"
			aria-disabled={saving || undefined}
			onClick={saving ? undefined : onRetry}
			data-testid="settings-retry-save"
		>
			{t("app.retry")}
		</Button>
	);
}
