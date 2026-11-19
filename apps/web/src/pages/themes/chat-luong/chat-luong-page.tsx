import { qualityTheme } from "@fnb/reports";
import {
	MissingChecklistsThemeCard,
	MissingCountsThemeCard,
} from "../../../operations/theme-cards";
import { ThemePage } from "../../../themes/theme-page";

export function ChatLuongPage() {
	return (
		<ThemePage
			definition={qualityTheme}
			extraCards={(context) => (
				<>
					<MissingCountsThemeCard context={context} />
					<MissingChecklistsThemeCard context={context} />
				</>
			)}
		/>
	);
}
