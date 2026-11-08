import { useT } from "../i18n";
import { useNewVersionAvailable } from "../lib/version-check";

export function NewVersionPrompt() {
	const t = useT();
	const available = useNewVersionAvailable(__BUILD_ID__);
	return (
		<div
			role="status"
			className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-6 print:hidden"
		>
			{available ? (
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="pointer-events-auto min-h-11 rounded-full bg-accent px-5 font-semibold text-accent-ink shadow-lg"
					data-testid="new-version-prompt"
				>
					{t("shell.newVersion")}
				</button>
			) : null}
		</div>
	);
}
