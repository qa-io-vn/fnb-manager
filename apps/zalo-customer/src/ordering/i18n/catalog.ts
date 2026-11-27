import { mergeCatalogs } from "@fnb/zalo-mini";
import { withSharedMessages } from "@fnb/zalo-mini/react";
import { appCatalogs } from "../../i18n/catalog";
import en from "./en.json";
import vi from "./vi.json";

// The ordering screens' messages (design spec C01 to C20), loaded only by the ordering build. They are generic: a
// brand's own words belong in its private copy pack.
export const orderingAppCatalogs = { vi, en } as const;

export const orderingCatalogs = withSharedMessages({
	vi: mergeCatalogs(appCatalogs.vi, vi),
	en: mergeCatalogs(appCatalogs.en, en),
});
