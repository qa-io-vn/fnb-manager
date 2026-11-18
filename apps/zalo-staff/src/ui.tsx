const focusRing =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const primaryButton = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink disabled:opacity-60 ${focusRing}`;

export const secondaryButton = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line px-4 text-base text-ink disabled:opacity-60 ${focusRing}`;

export const dangerButton = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line px-4 text-base text-negative disabled:opacity-60 ${focusRing}`;

export const quietButton = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-base text-ink underline underline-offset-4 ${focusRing}`;

export function Spinner() {
	return (
		<span
			aria-hidden="true"
			className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
		/>
	);
}

export function shownDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const day = String(date.getDate()).padStart(2, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	return `${day}/${month}/${date.getFullYear()}`;
}
