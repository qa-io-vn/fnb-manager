import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PREFERENCES_KEY,
	PreferencesProvider,
	usePreferences,
} from "../state/preferences";
import { TenantDefaultLanguage } from "./tenant-default-language";

const current = vi.hoisted(() => ({
	defaultLanguage: "en" as "vi" | "en" | undefined,
	reads: 0,
}));

vi.mock("./queries", () => ({
	useTenantDefaultLanguage: () => {
		current.reads += 1;
		return { data: current.defaultLanguage };
	},
}));

let toggle: (language: "vi" | "en") => void = () => undefined;

function ShownLanguage() {
	const { preferences, update } = usePreferences();
	toggle = (language) => update({ language });
	return <p data-testid="language">{preferences.language}</p>;
}

function renderShell() {
	return render(
		<PreferencesProvider>
			<TenantDefaultLanguage />
			<ShownLanguage />
		</PreferencesProvider>,
	);
}

describe("TenantDefaultLanguage", () => {
	afterEach(() => {
		window.localStorage.clear();
		current.defaultLanguage = "en";
		current.reads = 0;
	});

	it("opens a device without a stored language in the tenant's language", () => {
		renderShell();
		expect(screen.getByTestId("language")).toHaveTextContent("en");
	});

	it("keeps the language this device chose and does not read the tenant's", () => {
		window.localStorage.setItem(
			PREFERENCES_KEY,
			JSON.stringify({ language: "vi", languageChosen: true }),
		);
		renderShell();
		expect(screen.getByTestId("language")).toHaveTextContent("vi");
		expect(current.reads).toBe(0);
	});

	it("follows the tenant's language on a device an earlier version left with an unmarked Vietnamese", () => {
		window.localStorage.setItem(
			PREFERENCES_KEY,
			JSON.stringify({ language: "vi" }),
		);
		renderShell();
		expect(screen.getByTestId("language")).toHaveTextContent("en");
	});

	it("lets the toggle win on the device once it is used", () => {
		renderShell();
		expect(screen.getByTestId("language")).toHaveTextContent("en");
		act(() => toggle("vi"));
		expect(screen.getByTestId("language")).toHaveTextContent("vi");
		expect(
			JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}").language,
		).toBe("vi");
	});

	it("stays on the app's default while the tenant's language is unknown", () => {
		current.defaultLanguage = undefined;
		renderShell();
		expect(screen.getByTestId("language")).toHaveTextContent("vi");
	});
});
