import { isNamedPreset, type NamedPreset } from "@fnb/reports";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { isLanguage, type Language } from "../i18n";
import { type IsoDate, isIsoDate, todayIn } from "../lib/business-dates";
import { defaultPeriod, type Period, parsePeriod } from "../lib/period";
import { readStoredJson, writeStoredJson } from "../lib/storage";

export const PREFERENCES_KEY = "fnb.preferences.v1";
const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

export interface Preferences {
	language: Language;
	tenantId: string | null;
	storeIds: string[] | null;
	period: Period;
	periodSetOn: IsoDate;
	themePreset: NamedPreset | null;
}

function localToday(now: Date): IsoDate {
	return todayIn(DEFAULT_TIME_ZONE, now);
}

export function defaultPreferences(now: Date = new Date()): Preferences {
	const today = localToday(now);
	return {
		language: "vi",
		tenantId: null,
		storeIds: null,
		period: defaultPeriod(today),
		periodSetOn: today,
		themePreset: null,
	};
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

export function parsePreferences(
	value: unknown,
): Partial<Preferences> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const stored = value as Record<string, unknown>;
	const parsed: Partial<Preferences> = {};
	if (isLanguage(stored.language)) parsed.language = stored.language;
	if (typeof stored.tenantId === "string") parsed.tenantId = stored.tenantId;
	if (stored.storeIds === null || isStringArray(stored.storeIds)) {
		parsed.storeIds = stored.storeIds;
	}
	const period = parsePeriod(stored.period);
	if (period) parsed.period = period;
	if (isIsoDate(stored.periodSetOn)) parsed.periodSetOn = stored.periodSetOn;
	if (
		typeof stored.themePreset === "string" &&
		isNamedPreset(stored.themePreset)
	) {
		parsed.themePreset = stored.themePreset;
	}
	return parsed;
}

export function reanchoredToday(
	preferences: Preferences,
	now: Date,
): Preferences {
	const today = localToday(now);
	if (preferences.periodSetOn === today) return preferences;
	return {
		...preferences,
		period: { ...preferences.period, anchor: today },
		periodSetOn: today,
	};
}

export function loadPreferences(now: Date = new Date()): Preferences {
	return reanchoredToday(
		{
			...defaultPreferences(now),
			periodSetOn: "",
			...readStoredJson(PREFERENCES_KEY, parsePreferences),
		},
		now,
	);
}

interface PreferencesContextValue {
	preferences: Preferences;
	update: (change: Partial<Preferences>) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({
	children,
	initial,
}: {
	children: ReactNode;
	initial?: Preferences;
}) {
	const [preferences, setPreferences] = useState<Preferences>(
		() => initial ?? loadPreferences(),
	);
	const update = useCallback((change: Partial<Preferences>) => {
		setPreferences((previous) => {
			const next = {
				...previous,
				...change,
				...(change.period ? { periodSetOn: localToday(new Date()) } : {}),
			};
			writeStoredJson(PREFERENCES_KEY, next);
			return next;
		});
	}, []);
	const value = useMemo(() => ({ preferences, update }), [preferences, update]);
	return (
		<PreferencesContext.Provider value={value}>
			{children}
		</PreferencesContext.Provider>
	);
}

export function usePreferences(): PreferencesContextValue {
	const value = useContext(PreferencesContext);
	if (value === null) throw new Error("PreferencesProvider is missing");
	return value;
}
