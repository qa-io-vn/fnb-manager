import { mergeCatalogs } from "@fnb/zalo-mini";
import { withSharedMessages } from "@fnb/zalo-mini/react";
import loyaltyEn from "../loyalty/i18n/en.json";
import loyaltyVi from "../loyalty/i18n/vi.json";
import shiftEn from "../shift/i18n/en.json";
import shiftVi from "../shift/i18n/vi.json";
import en from "./en.json";
import vi from "./vi.json";

export const appCatalogs = {
	vi: mergeCatalogs(vi, shiftVi, loyaltyVi),
	en: mergeCatalogs(en, shiftEn, loyaltyEn),
} as const;

export const catalogs = withSharedMessages(appCatalogs);
