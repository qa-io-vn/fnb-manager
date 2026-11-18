import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { useT } from "../../i18n";
import { controlClass } from "../../settings/forms/field";

export function PackCopyDialog({
	text,
	fileName,
	onClose,
}: {
	text: string;
	fileName: string;
	onClose: () => void;
}) {
	const t = useT();
	const id = useId();
	const dialog = useRef<HTMLDialogElement>(null);
	const box = useRef<HTMLTextAreaElement>(null);
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		const created = URL.createObjectURL(
			new Blob([text], { type: "text/plain" }),
		);
		setUrl(created);
		return () => URL.revokeObjectURL(created);
	}, [text]);
	useEffect(() => {
		const element = dialog.current;
		if (element === null) return;
		if (typeof element.showModal === "function") {
			if (!element.open) element.showModal();
		} else {
			element.setAttribute("open", "");
		}
		box.current?.focus();
		box.current?.select();
	}, []);
	const close = () => {
		const element = dialog.current;
		if (element !== null && typeof element.close === "function") {
			element.close();
		} else {
			onClose();
		}
	};
	return (
		<dialog
			ref={dialog}
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-hint`}
			onClose={onClose}
			className="m-auto max-h-[calc(100%-2rem)] w-[min(40rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-surface-raised p-4 text-ink backdrop:bg-black/50"
			data-testid="pack-copy-dialog"
		>
			<div className="space-y-3">
				<h3 id={`${id}-title`} className="text-lg font-semibold">
					{t("exports.pack.copyDialog.title")}
				</h3>
				<p id={`${id}-hint`} className="text-sm">
					{t("exports.pack.copyDialog.hint")}
				</p>
				<textarea
					ref={box}
					readOnly
					rows={10}
					value={text}
					aria-label={t("exports.pack.copyDialog.text")}
					onFocus={(event) => event.currentTarget.select()}
					className={cn(controlClass, "py-2 font-mono")}
					data-testid="pack-copy-text"
				/>
				<div className="flex flex-wrap gap-2">
					{url === null ? null : (
						<a
							href={url}
							download={fileName}
							className={`${buttonVariants()} inline-flex max-w-full items-center`}
							data-testid="pack-copy-download"
						>
							{t("exports.pack.copyDialog.download")}
						</a>
					)}
					<Button
						tone="secondary"
						onClick={close}
						data-testid="pack-copy-close"
					>
						{t("exports.pack.copyDialog.close")}
					</Button>
				</div>
			</div>
		</dialog>
	);
}
