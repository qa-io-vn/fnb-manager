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

export type ReasonMessages = Readonly<
	Partial<Record<ReadOnlyReason, MessageKey>>
>;

export function readOnlyReasonKey(
	reason: ReadOnlyReason,
	messages: ReasonMessages = {},
): MessageKey {
	return messages[reason] ?? REASON_KEYS[reason];
}

export function ReadOnlyNotice({
	access,
	messages,
	testId = "settings-read-only",
}: {
	access: SettingsAccess;
	messages?: ReasonMessages;
	testId?: string;
}) {
	const t = useT();
	if (access.canWrite || access.reason === null) return null;
	return (
		<p
			role="note"
			className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
			data-testid={testId}
			data-reason={access.reason}
		>
			{t(readOnlyReasonKey(access.reason, messages))}
		</p>
	);
}
