import { mergeCatalogs } from "@fnb/zalo-mini";
import { I18nProvider, useI18n } from "@fnb/zalo-mini/react";
import type { ReactNode } from "react";
import { catalogs } from "../i18n/catalog";
import billsEn from "./i18n/en.json";
import billsVi from "./i18n/vi.json";

/**
 * The texts of the staff-mode bill screens travel with the lazily loaded till screens instead of the first-load
 * catalogue: the app's catalogue with these added on top.
 */
export const billCatalogs = {
	vi: mergeCatalogs(catalogs.vi, billsVi),
	en: mergeCatalogs(catalogs.en, billsEn),
} as const;

export function BillTexts({ children }: { readonly children: ReactNode }) {
	const { language } = useI18n();
	return (
		<I18nProvider language={language} catalogs={billCatalogs}>
			{children}
		</I18nProvider>
	);
}
