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
