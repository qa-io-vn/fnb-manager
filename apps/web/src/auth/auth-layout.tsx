import type { ReactNode } from "react";
import { useT } from "../i18n";
import { LanguageToggle } from "../shell/language-toggle";
import { PageHeading } from "../shell/page-heading";

export function AuthLayout({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	const t = useT();
	return (
		<div className="flex min-h-dvh flex-col px-4 py-4">
			<header className="mx-auto flex w-full max-w-md items-center justify-between">
				<p className="text-lg font-semibold">{t("app.title")}</p>
				<LanguageToggle />
			</header>
			<main className="mx-auto mt-10 w-full max-w-md">
				<div className="rounded-xl border border-line bg-surface-raised p-6 shadow-sm">
					<PageHeading title={title} className="mb-4 text-xl font-semibold" />
					{children}
				</div>
			</main>
		</div>
	);
}

export function TextField({
	id,
	label,
	type,
	value,
	onChange,
	autoComplete,
}: {
	id: string;
	label: string;
	type: "email" | "password";
	value: string;
	onChange: (value: string) => void;
	autoComplete: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			<input
				id={id}
				type={type}
				required
				value={value}
				autoComplete={autoComplete}
				onChange={(event) => onChange(event.target.value)}
				className="min-h-11 rounded-lg border border-line bg-surface px-3"
			/>
		</div>
	);
}

export const primaryButtonClass =
	"min-h-11 w-full rounded-lg bg-accent px-4 font-semibold text-accent-ink disabled:opacity-70";

export const textLinkClass =
	"inline-flex min-h-11 items-center text-accent underline underline-offset-2";

export const secondaryButtonClass =
	"min-h-11 w-full rounded-lg border border-line px-4 font-semibold hover:bg-surface-sunken";
