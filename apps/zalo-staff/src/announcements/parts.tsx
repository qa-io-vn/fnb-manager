import type { TeamEnv } from "../team/env";
import type { Announcement } from "./contract";

export function storeLabel(
	announcement: Announcement,
	env: Pick<TeamEnv, "storeName">,
	t: (key: string) => string,
): string {
	if (announcement.storeIds === null) return t("notices.allStores");
	const names = announcement.storeIds
		.map((id) => env.storeName(id))
		.filter((name): name is string => name !== null);
	return names.length === 0 ? t("notices.otherStores") : names.join(", ");
}

export function UnreadDot() {
	return (
		<span
			aria-hidden="true"
			className="mt-2 size-2.5 shrink-0 rounded-full bg-accent"
		/>
	);
}
