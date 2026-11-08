import type { MessageKey } from "../i18n";
import { type Language, languages, useLanguage, useT } from "../i18n";

const shortLabel: Record<Language, MessageKey> = {
	vi: "shell.language.short.vi",
	en: "shell.language.short.en",
};

const fullLabel: Record<Language, MessageKey> = {
	vi: "shell.language.vi",
	en: "shell.language.en",
};

export function LanguageToggle() {
	const t = useT();
	const { language, setLanguage } = useLanguage();
	return (
		<fieldset className="flex rounded-lg border border-line p-0.5 print:hidden">
			<legend className="sr-only">{t("shell.language")}</legend>
			{languages.map((option) => (
				<button
					key={option}
					type="button"
					lang={option}
					aria-pressed={language === option}
					title={t(fullLabel[option])}
					onClick={() => setLanguage(option)}
					className="min-h-11 min-w-11 rounded-md px-2 text-sm font-semibold aria-pressed:bg-accent aria-pressed:text-accent-ink"
				>
					{t(shortLabel[option])}
				</button>
			))}
		</fieldset>
	);
}
