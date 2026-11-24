import { createTranslator, RestError } from "@fnb/zalo-mini";
import { I18nProvider } from "@fnb/zalo-mini/react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../i18n/en.json";
import vi_ from "../i18n/vi.json";
import { Failed } from "../ui";
import { failureDetailOf, failureOf } from "./source";

// The short code under "The data could not be loaded" that tells a developer on the phone which step failed
// (Development builds only). It never holds data: the status and the server's code of a data error, or a class name.
describe("the technical detail of a failure", () => {
	it("names the status and the code of a data error, and only the class of anything else", () => {
		expect(failureDetailOf(new RestError(400, "22023"))).toBe("data 400 22023");
		expect(failureDetailOf(new RestError(404))).toBe("data 404");
		expect(failureDetailOf(new RestError(0))).toBe("data 0");
		expect(failureDetailOf(new TypeError("the phone 0900000000 is bad"))).toBe(
			"app TypeError",
		);
		expect(failureDetailOf("a string")).toBe("app error");
		expect(failureDetailOf(new RestError(500, "x".repeat(60)))).toBe(
			`data 500 ${"x".repeat(40)}`,
		);
		// the category of the message itself is unchanged
		expect(failureOf(new RestError(400, "22023"))).toBe("unknown");
	});

	afterEach(() => vi.unstubAllEnvs());

	function failed(stage: string, detail?: string) {
		vi.stubEnv("VITE_MINI_APP_STAGE", stage);
		return render(
			<I18nProvider language="en" catalogs={{ vi: vi_, en }}>
				<Failed failure="unknown" onRetry={() => {}} detail={detail} />
			</I18nProvider>,
		);
	}

	it("shows the detail under the message in a Development build only", () => {
		const { unmount } = failed("development", "session 401 zalo_token_refused");
		expect(screen.getByTestId("failed-detail").textContent).toBe(
			"session 401 zalo_token_refused",
		);
		unmount();
		const testing = failed("testing", "session 401 zalo_token_refused");
		expect(screen.queryByTestId("failed-detail")).toBeNull();
		testing.unmount();
		failed("development");
		expect(screen.queryByTestId("failed-detail")).toBeNull();
		expect(createTranslator(en)("customer.error.unknown")).toBe(
			"The data could not be loaded. Try again in a few minutes.",
		);
	});
});
