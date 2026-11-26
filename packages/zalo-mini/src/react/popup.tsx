import { type ReactNode, useEffect, useId, useRef } from "react";
import { useI18n } from "./i18n";

export const RESULT_MODAL_MS = 1500;

export interface PopupProps {
	readonly title: string;
	readonly onClose: () => void;
	readonly children: ReactNode;
	readonly footer?: ReactNode;
	readonly testId?: string;
}

export function Popup({
	title,
	onClose,
	children,
	footer,
	testId,
}: PopupProps) {
	const { t } = useI18n();
	const titleId = useId();
	const closeRef = useRef<HTMLButtonElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		const opener =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		closeRef.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCloseRef.current();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			if (opener?.isConnected) opener.focus();
		};
	}, []);

	return (
		<div
			className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/50"
			data-testid={testId}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-y-auto overscroll-contain rounded-t-sheet bg-surface-raised pb-[var(--zaui-safe-area-inset-bottom,0px)] text-ink"
			>
				<div className="sticky top-0 z-10 flex items-start gap-2 border-b border-line bg-surface-raised py-2 pr-2 pl-4">
					<h2 id={titleId} className="flex-1 py-2 text-lg font-semibold">
						{title}
					</h2>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label={t("popup.close")}
						className="flex size-11 shrink-0 items-center justify-center rounded-control-xl text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					>
						<svg
							aria-hidden="true"
							width="20"
							height="20"
							viewBox="0 0 20 20"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
						>
							<path d="M5 5l10 10M15 5L5 15" />
						</svg>
					</button>
				</div>
				<div className="px-4 py-4" data-testid="popup-body">
					{children}
				</div>
				{footer ? (
					<div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-surface-raised p-4">
						{footer}
					</div>
				) : null}
			</div>
		</div>
	);
}

export interface ResultModalProps {
	readonly message: string;
	readonly onDone: () => void;
}

export function ResultModal({ message, onDone }: ResultModalProps) {
	const onDoneRef = useRef(onDone);
	onDoneRef.current = onDone;
	useEffect(() => {
		const timer = setTimeout(() => onDoneRef.current(), RESULT_MODAL_MS);
		return () => clearTimeout(timer);
	}, []);
	return (
		<div
			className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 px-8"
			data-testid="result-modal"
		>
			<div
				role="status"
				aria-live="polite"
				className="flex w-full max-w-xs flex-col items-center gap-3 rounded-card-2xl bg-surface-raised p-6 text-center text-ink"
			>
				<svg
					aria-hidden="true"
					width="40"
					height="40"
					viewBox="0 0 40 40"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="text-positive"
				>
					<circle cx="20" cy="20" r="17" />
					<path d="M12.5 20.5l5 5 10-11" />
				</svg>
				<p className="text-body font-semibold">{message}</p>
			</div>
		</div>
	);
}
