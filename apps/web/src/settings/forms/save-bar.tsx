import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { useT } from "../../i18n";

export type SaveBarTone = "info" | "success" | "error";

export interface SaveBarStatus {
	readonly tone: SaveBarTone;
	readonly text: string;
}

export interface SaveBarProps {
	readonly pendingCount: number;
	readonly canSave: boolean;
	readonly saving: boolean;
	readonly onSave: () => void;
	readonly onCancel: () => void;
	readonly status?: SaveBarStatus | null;
}

const UNAVAILABLE_CLASS =
	"aria-disabled:cursor-not-allowed aria-disabled:border aria-disabled:border-line aria-disabled:bg-surface-sunken aria-disabled:text-ink-muted";

const TONE_CLASSES: Readonly<Record<SaveBarTone, string>> = {
	info: "text-ink-muted",
	success: "text-positive",
	error: "text-negative",
};

export function SaveBar({
	pendingCount,
	canSave,
	saving,
	onSave,
	onCancel,
	status,
}: SaveBarProps) {
	const t = useT();
	const hasChanges = pendingCount > 0;
	const canCancel = hasChanges && !saving;
	const canSubmit = hasChanges && canSave && !saving;
	const pendingText = hasChanges
		? t(
				pendingCount === 1
					? "settings.saveBar.pendingOne"
					: "settings.saveBar.pendingMany",
				{
					count: pendingCount,
				},
			)
		: t("settings.saveBar.none");
	return (
		<section
			aria-label={t("settings.saveBar.label")}
			className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-raised p-2 shadow-sm lg:bottom-2 print:hidden"
			data-testid="settings-save-bar"
			data-pending={pendingCount}
		>
			<div className="min-w-0 flex-1 basis-40 text-sm">
				<p className="font-medium" data-testid="settings-save-bar-pending">
					{pendingText}
				</p>
				<p
					role="status"
					className={cn(status ? TONE_CLASSES[status.tone] : null)}
					data-testid="settings-save-bar-status"
				>
					{saving ? t("settings.saving") : (status?.text ?? "")}
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={!canCancel || undefined}
					onClick={canCancel ? onCancel : undefined}
					className={UNAVAILABLE_CLASS}
					data-testid="settings-cancel"
				>
					{t("settings.cancel")}
				</Button>
				<Button
					size="compact"
					aria-disabled={!canSubmit || undefined}
					aria-busy={saving || undefined}
					onClick={canSubmit ? onSave : undefined}
					className={UNAVAILABLE_CLASS}
					data-testid="settings-save"
				>
					{t("settings.save")}
				</Button>
			</div>
		</section>
	);
}

export function RestoreDefaultsButton({
	onClick,
	disabled,
}: {
	readonly onClick: () => void;
	readonly disabled?: boolean;
}) {
	const t = useT();
	return (
		<Button
			tone="secondary"
			size="compact"
			disabled={disabled}
			onClick={onClick}
			data-testid="settings-restore-defaults"
		>
			{t("settings.restoreDefaults")}
		</Button>
	);
}
