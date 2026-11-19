import { shiftsTheme } from "@fnb/reports";
import { CashCountThemeCard } from "../../../operations/theme-cards";
import { ThemePage } from "../../../themes/theme-page";

export function CaKetTienPage() {
	return (
		<ThemePage
			definition={shiftsTheme}
			extraCards={(context) => <CashCountThemeCard context={context} />}
		/>
	);
}
