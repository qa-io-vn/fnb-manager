import { type MessageKey, useT } from "../i18n";
import type { SettingsWriteCode } from "../settings/source";

const ERROR_KEYS: Readonly<Record<SettingsWriteCode, MessageKey>> = {
	forbidden: "loyalty.privacy.error.forbidden",
	invalid: "loyalty.privacy.error.invalid",
	duplicate: "loyalty.privacy.error.invalid",
	frozen: "loyalty.privacy.error.other",
	network: "loyalty.privacy.error.network",
};

export function ActionError({
	code,
	testId = "privacy-error",
}: {
	readonly code: SettingsWriteCode | null;
	readonly testId?: string;
}) {
	const t = useT();
	if (code === null) return null;
	return (
		<p role="alert" className="text-sm text-negative" data-testid={testId}>
			{t(ERROR_KEYS[code])}
		</p>
	);
}

export function ActionDone({
	message,
	testId = "privacy-done",
}: {
	readonly message: string | null;
	readonly testId?: string;
}) {
	if (message === null) return null;
	return (
		<p role="status" className="text-sm" data-testid={testId}>
			{message}
		</p>
	);
}
