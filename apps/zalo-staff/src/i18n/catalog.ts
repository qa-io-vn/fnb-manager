import { mergeCatalogs } from "@fnb/zalo-mini";
import { withSharedMessages } from "@fnb/zalo-mini/react";
import loyaltyEn from "../loyalty/i18n/en.json";
import loyaltyVi from "../loyalty/i18n/vi.json";
import shiftEn from "../shift/i18n/en.json";
import shiftVi from "../shift/i18n/vi.json";
import teamEn from "../team/i18n/en.json";
import teamVi from "../team/i18n/vi.json";
import en from "./en.json";
import vi from "./vi.json";

export const appCatalogs = {
	vi: mergeCatalogs(vi, shiftVi, loyaltyVi, teamVi),
	en: mergeCatalogs(en, shiftEn, loyaltyEn, teamEn),
} as const;

export const catalogs = withSharedMessages(appCatalogs);
