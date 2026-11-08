import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
} from "react";
import enMessages from "./en.json";
import viMessages from "./vi.json";

export type Language = "vi" | "en";
export type MessageKey = keyof typeof viMessages;
export type MessageParams = Record<string, string | number>;

const en: Record<MessageKey, string> = enMessages;
const vi: Record<MessageKey, string> = viMessages;

export const messages: Record<Language, Record<MessageKey, string>> = {
	vi,
	en,
};

export const languages: readonly Language[] = ["vi", "en"];

export const uiLocaleOf: Record<Language, string> = {
	vi: "vi-VN",
	en: "en-GB",
};

export function interpolate(template: string, params?: MessageParams): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
		const value = params[name];
		return value === undefined ? placeholder : String(value);
	});
}

export function translate(
	language: Language,
	key: MessageKey,
	params?: MessageParams,
): string {
	return interpolate(messages[language][key], params);
}

export type Translate = (key: MessageKey, params?: MessageParams) => string;

interface I18nContextValue {
	language: Language;
	setLanguage: (language: Language) => void;
}

const I18nContext = createContext<I18nContextValue>({
	language: "vi",
	setLanguage: () => undefined,
});

interface I18nProviderProps {
	language: Language;
	onLanguageChange: (language: Language) => void;
	children: ReactNode;
}

export function I18nProvider({
	language,
	onLanguageChange,
	children,
}: I18nProviderProps) {
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);
	const value = useMemo(
		() => ({ language, setLanguage: onLanguageChange }),
		[language, onLanguageChange],
	);
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLanguage(): I18nContextValue {
	return useContext(I18nContext);
}

export function useT(): Translate {
	const { language } = useContext(I18nContext);
	return useCallback<Translate>(
		(key, params) => translate(language, key, params),
		[language],
	);
}

export function isLanguage(value: unknown): value is Language {
	return value === "vi" || value === "en";
}
