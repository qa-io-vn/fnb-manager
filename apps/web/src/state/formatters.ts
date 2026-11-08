import { useMemo } from "react";
import type { TenantRow } from "../data/row-source";
import { uiLocaleOf, useLanguage, useT } from "../i18n";
import { createFormatters, type Formatters } from "../lib/format";

export function useFormatters(tenant: TenantRow): Formatters {
	const { language } = useLanguage();
	const t = useT();
	return useMemo(
		() =>
			createFormatters({
				currencyCode: tenant.currencyCode,
				uiLocale: uiLocaleOf[language],
				timeZone: tenant.timeZone,
				unitLabels: {
					million: t("money.million"),
					billion: t("money.billion"),
				},
			}),
		[tenant.currencyCode, tenant.timeZone, language, t],
	);
}
