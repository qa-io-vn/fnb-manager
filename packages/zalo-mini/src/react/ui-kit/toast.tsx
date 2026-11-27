import { useEffect, useRef } from "react";

export const TOAST_MS = 4000;

export interface ToastProps {
	readonly message: string;
	/** Called once the toast has been shown for its time; the caller removes it. */
	readonly onDone: () => void;
	readonly durationMs?: number;
	readonly testId?: string;
}

/**
 * A short message on an inverse pill (never the only place a result is stated): a polite status that goes by its own
 * after four seconds. It floats above the bars at the bottom of the screen.
 */
export function Toast({
	message,
	onDone,
	durationMs = TOAST_MS,
	testId,
}: ToastProps) {
	const done = useRef(onDone);
	done.current = onDone;
	useEffect(() => {
		const timer = setTimeout(() => done.current(), durationMs);
		return () => clearTimeout(timer);
	}, [durationMs]);
	return (
		<div
			role="status"
			aria-live="polite"
			data-testid={testId}
			className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--bottom-clear,0px)+0.75rem)] z-[1050] flex justify-center"
		>
			<p className="rounded-card-xl bg-inverse px-4 py-3 text-body text-inverse-ink shadow-card">
				{message}
			</p>
		</div>
	);
}
