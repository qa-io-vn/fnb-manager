import {
	type LazyViews,
	lazyCard,
	lazyScreen as lazyScreenWith,
	useI18n,
} from "@fnb/zalo-mini/react";
import type { ComponentType } from "react";
import { Alert, Loading } from "./shift/parts";
import { primaryButton } from "./ui";

function ScreenLoading() {
	const { t } = useI18n();
	return (
		<div className="px-4 pt-5" data-testid="screen-loading" role="presentation">
			<Loading label={t("loyalty.loading")} />
		</div>
	);
}

function ScreenFailed({ retry }: { readonly retry: () => void }) {
	const { t } = useI18n();
	return (
		<div
			className="flex flex-col gap-4 px-4 pt-5"
			data-testid="screen-load-failed"
		>
			<Alert>{t("lazy.failed")}</Alert>
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				onClick={retry}
			>
				{t("ops.retry")}
			</button>
		</div>
	);
}

const VIEWS: LazyViews = { Loading: ScreenLoading, Failed: ScreenFailed };

export function lazyScreen<M, P extends object>(
	importer: () => Promise<M>,
	pick: (loaded: M) => ComponentType<P>,
): ComponentType<P> {
	return lazyScreenWith(importer, pick, VIEWS);
}

export { lazyCard };
