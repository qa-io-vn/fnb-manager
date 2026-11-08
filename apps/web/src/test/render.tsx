import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider, type Language } from "../i18n";
import { createFormatters, type Formatters } from "../lib/format";

export function renderWithLanguage(
	ui: ReactElement,
	language: Language = "vi",
) {
	return render(
		<I18nProvider language={language} onLanguageChange={() => undefined}>
			{ui}
		</I18nProvider>,
	);
}

export function vndFormatters(uiLocale = "vi-VN"): Formatters {
	return createFormatters({
		currencyCode: "VND",
		uiLocale,
		timeZone: "Asia/Ho_Chi_Minh",
		unitLabels: { million: "tr", billion: "tỷ" },
	});
}
