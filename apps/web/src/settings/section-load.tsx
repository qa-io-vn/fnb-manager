import { Button } from "../components/ui/button";
import { useT } from "../i18n";
import {
	useRetrySettingsSource,
	useSettingsSourceState,
} from "./settings-source-context";

export interface SectionRead {
	readonly status: "pending" | "error" | "success";
	readonly refetch: () => Promise<unknown>;
}

export interface SectionLoad {
	readonly failed: boolean;
	readonly retry: () => void;
}

export function useSectionLoad(reads: readonly SectionRead[]): SectionLoad {
	const sourceState = useSettingsSourceState();
	const retrySource = useRetrySettingsSource();
	const sourceFailed = sourceState.status === "failed";
	return {
		failed: sourceFailed || reads.some((read) => read.status === "error"),
		retry: sourceFailed
			? retrySource
			: () => {
					for (const read of reads) {
						if (read.status === "error") void read.refetch();
					}
				},
	};
}

export function SectionLoadState({
	load,
	failedTestId,
}: {
	readonly load: SectionLoad;
	readonly failedTestId: string;
}) {
	const t = useT();
	if (!load.failed) return <p role="status">{t("app.loading")}</p>;
	return (
		<div role="alert" className="space-y-2" data-testid={failedTestId}>
			<p>{t("app.error")}</p>
			<Button tone="secondary" size="compact" onClick={load.retry}>
				{t("app.retry")}
			</Button>
		</div>
	);
}
