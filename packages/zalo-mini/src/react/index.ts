import sharedEn from "../i18n/messages/en.json";
import sharedVi from "../i18n/messages/vi.json";
import type { Catalog, Language } from "../i18n/translate";
import { mergeCatalogs } from "../i18n/translate";

export {
	type BootOptions,
	bootMiniApp,
	MINI_APP_ROOT_ID,
	type MiniAppEnvironment,
	miniAppEnvironment,
} from "./boot";
export { type ColorScheme, useColorScheme } from "./color-scheme";
export { I18nProvider, type I18nProviderProps, useI18n } from "./i18n";
export {
	MAX_TABS,
	MiniApp,
	type MiniAppProps,
	type MiniAppRoute,
	type MiniAppTab,
	PlainState,
	shellProblems,
} from "./mini-app-shell";
export {
	SessionProvider,
	type SessionProviderProps,
	useSession,
} from "./session";
export { SessionScreen } from "./session-screen";

export const sharedCatalogs: Readonly<Record<Language, Catalog>> = {
	vi: sharedVi,
	en: sharedEn,
};

export function withSharedMessages(
	catalogs: Readonly<Record<Language, Catalog>>,
): Readonly<Record<Language, Catalog>> {
	return {
		vi: mergeCatalogs(sharedCatalogs.vi, catalogs.vi),
		en: mergeCatalogs(sharedCatalogs.en, catalogs.en),
	};
}
