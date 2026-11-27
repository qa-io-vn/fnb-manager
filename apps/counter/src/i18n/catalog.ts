import type { Catalog, Language } from "@fnb/zalo-mini/i18n/translate";
import en from "./en.json";
import vi from "./vi.json";

export const catalogs: Readonly<Record<Language, Catalog>> = { vi, en };
