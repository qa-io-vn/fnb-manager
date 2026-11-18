import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
} from "react";
import {
	type Catalog,
	createTranslator,
	type Language,
	type Translate,
} from "../i18n/translate";

interface I18nValue {
	readonly language: Language;
	readonly t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function reportMissing(key: string): void {
	console.error(`missing message: ${key}`);
}

export interface I18nProviderProps {
	readonly language: Language;
	readonly catalogs: Readonly<Record<Language, Catalog>>;
	readonly children: ReactNode;
}

export function I18nProvider({
	language,
	catalogs,
	children,
}: I18nProviderProps) {
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);
	const value = useMemo(
		() => ({
			language,
			t: createTranslator(catalogs[language], reportMissing),
		}),
		[language, catalogs],
	);
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
	const value = useContext(I18nContext);
	if (!value) throw new Error("useI18n needs an I18nProvider");
	return value;
}
