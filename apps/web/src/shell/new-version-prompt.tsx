import { Button } from "../components/ui/button";
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
				<Button
					type="button"
					onClick={() => window.location.reload()}
					className="pointer-events-auto rounded-full px-5 shadow-lg"
					data-testid="new-version-prompt"
				>
					{t("shell.newVersion")}
				</Button>
			) : null}
		</div>
	);
}
