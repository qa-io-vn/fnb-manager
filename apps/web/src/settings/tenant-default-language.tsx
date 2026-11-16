import { useEffect } from "react";
import { usePreferences } from "../state/preferences";
import { useTenantDefaultLanguage } from "./queries";

function AdoptTenantLanguage() {
	const { adoptDefaultLanguage } = usePreferences();
	const language = useTenantDefaultLanguage().data;
	useEffect(() => {
		if (language !== undefined) adoptDefaultLanguage(language);
	}, [language, adoptDefaultLanguage]);
	return null;
}

export function TenantDefaultLanguage() {
	const { preferences } = usePreferences();
	return preferences.languageChosen ? null : <AdoptTenantLanguage />;
}
