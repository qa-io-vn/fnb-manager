import { SettingsSourceProvider } from "../../settings/settings-source-context";
import { SettingsLayout } from "./settings-layout";

export function SettingsRoute() {
	return (
		<SettingsSourceProvider>
			<SettingsLayout />
		</SettingsSourceProvider>
	);
}
