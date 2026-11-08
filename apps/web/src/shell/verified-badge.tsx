import type { VerificationMarker } from "../components/report-card/types";
import type { MessageKey } from "../i18n";
import { useT } from "../i18n";

const labelOf: Record<VerificationMarker, MessageKey> = {
	verified: "badge.verified",
	unverified: "badge.unverified",
	sample: "badge.sample",
};

const toneOf: Record<VerificationMarker, string> = {
	verified: "bg-positive-soft text-positive",
	unverified: "bg-warning-soft text-warning",
	sample: "bg-surface-sunken text-ink-muted",
};

export function VerifiedBadge({ state }: { state: VerificationMarker }) {
	const t = useT();
	return (
		<span
			className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneOf[state]}`}
			data-testid="verified-badge"
			data-state={state}
		>
			{t(labelOf[state])}
		</span>
	);
}
