import {
	type SettingsAccess,
	type SettingsArea,
	settingsAccess,
} from "./access";
import { useMembership } from "./queries";

export function useSettingsAccess(area: SettingsArea): SettingsAccess {
	const membership = useMembership();
	if (membership.status === "error") {
		return { canWrite: false, reason: "unavailable" };
	}
	return settingsAccess(
		area,
		membership.status === "success" ? membership.data : undefined,
	);
}
