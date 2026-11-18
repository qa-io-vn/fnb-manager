import type { StaffMiniAppRow } from "./database.js";

export interface LocalAppConfig {
	readonly app: {
		readonly title: string;
		readonly headerTitle: { readonly vi: string; readonly en: string };
		readonly headerColor: { readonly light: string; readonly dark: string };
		readonly textColor: {
			readonly light: "black" | "white";
			readonly dark: "black" | "white";
		};
		readonly statusBarType: "normal";
		readonly hideIOSSafeAreaBottom: false;
		readonly hideAndroidBottomNavigationBar: false;
	};
	readonly listCSS: readonly string[];
	readonly listSyncJS: readonly string[];
	readonly listAsyncJS: readonly string[];
}

export function staffAppConfig(row: StaffMiniAppRow): LocalAppConfig {
	return {
		app: {
			title: row.title,
			headerTitle: { vi: row.header_title_vi, en: row.header_title_en },
			headerColor: {
				light: row.header_color_light.toUpperCase(),
				dark: row.header_color_dark.toUpperCase(),
			},
			textColor: { light: row.text_color_light, dark: row.text_color_dark },
			statusBarType: "normal",
			hideIOSSafeAreaBottom: false,
			hideAndroidBottomNavigationBar: false,
		},
		listCSS: [],
		listSyncJS: [],
		listAsyncJS: [],
	};
}
