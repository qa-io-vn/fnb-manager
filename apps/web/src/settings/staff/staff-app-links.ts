import type { StoreProfile } from "../source";
import type { StaffApp } from "./source";

export const ZALO_MINI_APP_BASE = "https://zalo.me/s/";

export function staffAppLink(miniAppId: string, storeCode: string): string {
	return `${ZALO_MINI_APP_BASE}${encodeURIComponent(miniAppId)}/?store=${encodeURIComponent(storeCode)}`;
}

export interface StaffAppEntry {
	readonly app: StaffApp;
	readonly link: string | null;
}

export interface StoreStaffApps {
	readonly store: StoreProfile;
	readonly entries: readonly StaffAppEntry[];
}

export function staffAppsByStore(
	profiles: readonly StoreProfile[],
	apps: readonly StaffApp[],
): StoreStaffApps[] {
	return profiles.map((store) => {
		const code = store.code?.trim() ?? "";
		return {
			store,
			entries: apps
				.filter((app) => app.storeIds.includes(store.storeId))
				.map((app) => ({
					app,
					link: code === "" ? null : staffAppLink(app.miniAppId, code),
				})),
		};
	});
}
