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
export {
	applyBrandTheme,
	BRAND_THEME_STYLE_ID,
	BrandBanner,
	BrandHero,
	BrandWordmark,
	currentBrandTheme,
} from "./brand-theme";
export { type ColorScheme, useColorScheme } from "./color-scheme";
export {
	bootCustomerMiniApp,
	type CustomerBootOptions,
	type CustomerEnvironment,
	type CustomerStandIn,
	customerMiniAppEnvironment,
} from "./customer-boot";
export {
	CustomerSessionProvider,
	type CustomerSessionProviderProps,
	type CustomerSessionValue,
	useCustomerSession,
} from "./customer-session";
export {
	DataEndpointProvider,
	type DataEndpointProviderProps,
	useDataEndpoint,
} from "./data-endpoint";
export { I18nProvider, type I18nProviderProps, useI18n } from "./i18n";
export {
	MAX_TABS,
	MiniApp,
	type MiniAppGate,
	type MiniAppProps,
	type MiniAppRoute,
	type MiniAppTab,
	PlainState,
	shellProblems,
} from "./mini-app-shell";
export {
	Popup,
	type PopupProps,
	RESULT_MODAL_MS,
	ResultModal,
	type ResultModalProps,
} from "./popup";
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
export {
	type LazyViews,
	lazyCard,
	lazyScreen,
	PRELOAD_DELAY_MS,
	preloadLazyScreens,
} from "./lazy";
export {
	type Chip,
	ChipGroup,
	type ChipGroupProps,
	type ChipTone,
	type KitButtonVariant,
	kitButton,
	type OptionPill,
	OptionPills,
	type OptionPillsProps,
	PriceText,
	type PriceTextProps,
	type PriceTextSize,
	type PriceTextTone,
	StatusPill,
	type StatusPillProps,
	type StatusPillTone,
	Stepper,
	type StepperProps,
	StickyActionBar,
	type StickyActionBarProps,
	TOAST_MS,
	Toast,
	type ToastProps,
} from "./ui-kit/index";
