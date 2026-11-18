import { withSharedMessages } from "@fnb/zalo-mini/react";
import en from "./en.json";
import vi from "./vi.json";

export const appCatalogs = { vi, en } as const;

export const catalogs = withSharedMessages(appCatalogs);
