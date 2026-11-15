import { themeKeys } from "@fnb/reports";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useT } from "../../../i18n";
import { STORE_PARAM } from "../../../reports/report-route";
import { translateKey } from "../../../reports/typed-values";
import { PageHeading } from "../../../shell/page-heading";
import { useReadyTenantScope } from "../../../state/tenant-scope";
import {
	LATER_THEME_PHASE,
	laterThemeOfSlug,
	ThemeTabs,
} from "../../../themes/theme-tabs";

export const DEFAULT_THEME_PATH = "/chu-de/doanh-thu";

export function linkSearch(
	search: string,
	storeIds: readonly string[] | null,
): string {
	const params = new URLSearchParams(search);
	params.delete(STORE_PARAM);
	if (storeIds !== null && storeIds.length > 0) {
		params.set(STORE_PARAM, storeIds.join(","));
	}
	return params.toString().replaceAll("%2C", ",");
}

export function LaterThemePage() {
	const t = useT();
	const { slug } = useParams();
	const { search } = useLocation();
	const scope = useReadyTenantScope();
	const entry = laterThemeOfSlug(slug);
	if (entry === null) {
		return <Navigate to={`${DEFAULT_THEME_PATH}${search}`} replace />;
	}
	const title = translateKey(t, entry.titleKey);
	return (
		<div className="space-y-4">
			<PageHeading title={title} className="text-2xl font-semibold" />
			<ThemeTabs
				kind={entry.kind}
				hrefFor={(target) =>
					`/chu-de/${target.slug}?${linkSearch(search, scope.allStoresSelected ? null : scope.selectedStores.map((store) => store.id))}`
				}
			/>
			<div
				className="rounded-xl border border-dashed border-line bg-surface-raised p-5"
				data-testid="theme-later"
			>
				<p className="mb-2 font-medium">{t(themeKeys.laterPage.title)}</p>
				<p className="text-ink-muted" data-testid="theme-later-phase">
					{translateKey(t, themeKeys.laterPage.body, {
						theme: title,
						phase: LATER_THEME_PHASE,
					})}
				</p>
			</div>
		</div>
	);
}
