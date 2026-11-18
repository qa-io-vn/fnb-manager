import { I18nProvider, sharedCatalogs } from "@fnb/zalo-mini/react";
import {
	MOCK_PERMISSION_DENIED_CODE,
	mockSdkCalls,
	resetMockSdk,
} from "@fnb/zalo-mini/testing/mock-sdk";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { probeCatalogs } from "./messages";
import { ProbeScreen, runPhoneConsentProbe } from "./probe";

describe("phone-consent probe", () => {
	beforeEach(() => {
		resetMockSdk();
	});

	it("records consent without keeping the token", async () => {
		expect(await runPhoneConsentProbe()).toEqual({
			consented: true,
			errorCode: null,
		});
		expect(mockSdkCalls().map((call) => call.api)).toEqual(["getPhoneNumber"]);
	});

	it("records a refusal with its error code", async () => {
		const refuse = async () => {
			throw { code: MOCK_PERMISSION_DENIED_CODE, message: "denied" };
		};
		expect(await runPhoneConsentProbe(refuse)).toEqual({
			consented: false,
			errorCode: MOCK_PERMISSION_DENIED_CODE,
		});
	});

	it("shows the outcome on the probe screen", async () => {
		render(
			<I18nProvider language="vi" catalogs={sharedCatalogs}>
				<MemoryRouter>
					<ProbeScreen />
				</MemoryRouter>
			</I18nProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Bắt đầu kiểm tra" }));
		const outcome = within(await screen.findByTestId("probe-outcome"));
		expect(outcome.getByText("Có")).toBeInTheDocument();
		expect(outcome.getByText("Không có")).toBeInTheDocument();
		expect(screen.queryByText(/mock-phone-token/)).not.toBeInTheDocument();
	});

	it("has the same keys in Vietnamese and English", () => {
		expect(Object.keys(probeCatalogs.en)).toEqual(
			Object.keys(probeCatalogs.vi),
		);
	});
});
