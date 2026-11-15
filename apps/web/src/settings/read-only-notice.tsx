import { type MessageKey, useT } from "../i18n";
import type { ReadOnlyReason, SettingsAccess } from "./access";

const REASON_KEYS: Readonly<Record<ReadOnlyReason, MessageKey>> = {
	notMember: "settings.readOnly.notMember",
	role: "settings.readOnly.role",
	scope: "settings.readOnly.scope",
	ownerOnly: "settings.readOnly.ownerOnly",
	unknown: "settings.readOnly.unknown",
	unavailable: "settings.readOnly.unavailable",
};

export function ReadOnlyNotice({ access }: { access: SettingsAccess }) {
	const t = useT();
	if (access.canWrite || access.reason === null) return null;
	return (
		<p
			role="note"
			className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
			data-testid="settings-read-only"
			data-reason={access.reason}
		>
			{t(REASON_KEYS[access.reason])}
		</p>
	);
}
