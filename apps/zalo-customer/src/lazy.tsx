import {
	type LazyViews,
	lazyScreen as lazyScreenWith,
	useI18n,
} from "@fnb/zalo-mini/react";
import type { ComponentType } from "react";
import { Loading, primaryButton } from "./ui";

function ScreenFailed({ retry }: { readonly retry: () => void }) {
	const { t } = useI18n();
	return (
		<div
			className="flex flex-col gap-4 px-4 pt-5"
			data-testid="screen-load-failed"
		>
			<p
				role="alert"
				className="rounded-card-xl bg-negative-soft px-3 py-2 text-body text-negative"
			>
				{t("customer.error.network")}
			</p>
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				onClick={retry}
			>
				{t("customer.retry")}
			</button>
		</div>
	);
}

const VIEWS: LazyViews = {
	Loading: () => <Loading />,
	Failed: ScreenFailed,
};

/**
 * A screen that loads its own chunk when first opened, so the home screen
 * does not pay for the wallet, join, claim and settings screens.
 */
export function lazyScreen<M, P extends object>(
	importer: () => Promise<M>,
	pick: (loaded: M) => ComponentType<P>,
): ComponentType<P> {
	return lazyScreenWith(importer, pick, VIEWS);
}
