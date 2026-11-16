import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";

export interface ConfirmPanelProps {
	readonly id: string;
	readonly message: string;
	readonly confirmLabel: string;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

export function ConfirmPanel({
	id,
	message,
	confirmLabel,
	onConfirm,
	onCancel,
}: ConfirmPanelProps) {
	const t = useT();
	const confirmRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		confirmRef.current?.focus();
	}, []);
	return (
		<fieldset
			id={id}
			className="min-w-0 rounded-lg border border-warning bg-warning-soft p-3"
			data-testid="legal-confirm"
			onKeyDown={(event) => {
				if (event.key === "Escape") onCancel();
			}}
		>
			<legend className="float-left w-full text-sm">{message}</legend>
			<div className="clear-left flex flex-wrap gap-2 pt-2">
				<Button
					ref={confirmRef}
					size="compact"
					onClick={onConfirm}
					data-testid="legal-confirm-yes"
				>
					{confirmLabel}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					onClick={onCancel}
					data-testid="legal-confirm-no"
				>
					{t("settings.legal.confirm.back")}
				</Button>
			</div>
		</fieldset>
	);
}
