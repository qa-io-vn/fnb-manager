import { type ReactNode, useEffect, useId, useRef } from "react";
import { CloseIcon } from "./icons";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
	readonly title: string;
	readonly onClose: () => void;
	readonly children: ReactNode;
	/** The buttons at the bottom; the close button in the corner is always there. */
	readonly footer?: ReactNode;
	readonly size?: "sm" | "md" | "lg";
	readonly closeLabel: string;
	readonly testId?: string;
	/** A dialog that must not close by Esc or the backdrop while it works (a payment being recorded). */
	readonly busy?: boolean;
}

const WIDTH = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" } as const;

/**
 * A modal dialog: it takes the focus, keeps Tab inside, closes with Esc or the corner button, and gives the focus back
 * to what opened it. On a phone it fills the screen from the bottom like a sheet.
 */
export function Dialog({
	title,
	onClose,
	children,
	footer,
	size = "md",
	closeLabel,
	testId,
	busy = false,
}: DialogProps) {
	const id = useId();
	const panel = useRef<HTMLDivElement>(null);
	const close = useRef(onClose);
	close.current = onClose;
	const busyRef = useRef(busy);
	busyRef.current = busy;

	useEffect(() => {
		const opener =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const first =
			panel.current?.querySelector<HTMLElement>("[data-autofocus]") ??
			panel.current?.querySelector<HTMLElement>(FOCUSABLE);
		(first ?? panel.current)?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !busyRef.current) {
				event.stopPropagation();
				close.current();
				return;
			}
			if (event.key !== "Tab" || panel.current === null) return;
			const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
			if (items.length === 0) return;
			const head = items[0];
			const tail = items[items.length - 1];
			if (event.shiftKey && document.activeElement === head) {
				event.preventDefault();
				tail?.focus();
			} else if (!event.shiftKey && document.activeElement === tail) {
				event.preventDefault();
				head?.focus();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			opener?.focus();
		};
	}, []);

	return (
		<div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-6">
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				className="absolute inset-0 bg-black/50"
				onClick={() => (busy ? undefined : onClose())}
			/>
			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-labelledby={id}
				tabIndex={-1}
				data-testid={testId}
				className={`relative flex max-h-[92vh] w-full ${WIDTH[size]} flex-col rounded-t-sheet bg-surface-raised text-ink shadow-card sm:rounded-card-2xl`}
			>
				<div className="flex items-center gap-3 border-b border-line px-5 py-3">
					<h2 id={id} className="min-w-0 flex-1 text-lg font-extrabold">
						{title}
					</h2>
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						aria-label={closeLabel}
						className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
					>
						<CloseIcon />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{children}
				</div>
				{footer === undefined ? null : (
					<div className="flex flex-wrap justify-end gap-3 border-t border-line px-5 py-3">
						{footer}
					</div>
				)}
			</div>
		</div>
	);
}
