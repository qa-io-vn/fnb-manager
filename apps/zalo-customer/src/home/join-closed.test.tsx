import type { CustomerHome } from "@fnb/zalo-mini/loyalty";
import { mockSdkCalls } from "@fnb/zalo-mini/testing/mock-sdk";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JoinFlow } from "../join/join-flow";
import { problemOf } from "../join/model";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { joinBlock, programmeOpen } from "./model";

afterEach(() => setSearch(""));

const PROGRAMME = {
	name: "Chương trình",
	status: null,
	startsOn: "2026-11-01",
	endsOn: null,
	stampsPerCard: 8,
	welcomeStamps: 2,
	stampValidityMonths: 6,
	pointsEnabled: true,
	pointsExpiryMonths: 12,
	claimsPerDay: 3,
	claimWindowHours: 72,
	summary: null,
	stampRule: null,
	pointsRule: null,
	rewardSummary: null,
	retentionMonths: null,
	tiers: [],
} as const;

const HOME: CustomerHome = {
	programme: PROGRAMME,
	oaId: null,
	legal: { entityName: "Quán", policyVersion: "privacy-1", documents: [] },
	stores: [],
	menu: [],
};

function expectClosed(reason: string, text: RegExp) {
	const note = screen.getByTestId("join-closed");
	expect(note).toHaveAttribute("data-reason", reason);
	expect(note).toHaveTextContent(text);
	for (const name of ["Tham gia thành viên", "Nhận điểm từ hóa đơn"]) {
		const button = screen.getByRole("button", { name });
		expect(button).toBeDisabled();
		expect(button).toHaveAccessibleDescription(text);
	}
}

describe("when joining is open", () => {
	it("needs an active programme whose period covers today and a published privacy notice", () => {
		expect(joinBlock(HOME, "2026-11-19")).toBeNull();
		expect(joinBlock({ ...HOME, programme: null }, "2026-11-19")).toBe(
			"no-programme",
		);
		for (const status of ["paused", "ended"] as const) {
			expect(programmeOpen({ ...PROGRAMME, status }, "2026-11-19")).toBe(false);
		}
		expect(programmeOpen(PROGRAMME, "2026-10-31")).toBe(false);
		expect(
			programmeOpen({ ...PROGRAMME, endsOn: "2026-11-19" }, "2026-11-19"),
		).toBe(true);
		expect(
			programmeOpen({ ...PROGRAMME, endsOn: "2026-11-18" }, "2026-11-19"),
		).toBe(false);
		expect(
			joinBlock(
				{ ...HOME, legal: { ...HOME.legal, policyVersion: null } },
				"2026-11-19",
			),
		).toBe("no-privacy");
		expect(
			joinBlock(
				{
					programme: null,
					oaId: null,
					legal: { ...HOME.legal, policyVersion: null },
					stores: [],
					menu: [],
				},
				"2026-11-19",
			),
		).toBe("no-programme");
		expect(problemOf("no_programme")).toBe("no-programme");
	});
});

describe("a tenant without a published privacy notice", () => {
	it("keeps browsing usable and disables joining and receipt claims with the reason", async () => {
		renderCustomerApp({ settings: { privacy: false } });
		expect(
			await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" }),
		).toBeInTheDocument();
		expectClosed("no-privacy", /chưa công bố Chính sách bảo mật/);
		expect(screen.getAllByTestId("menu-item")).toHaveLength(4);
		fireEvent.click(screen.getByRole("button", { name: "Chính sách bảo mật" }));
		expect(
			within(await screen.findByRole("dialog")).getByRole("alert"),
		).toHaveTextContent("Chưa tải được văn bản");
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", { name: /Đóng/ }),
		);
		fireEvent.click(screen.getByRole("button", { name: /Cửa hàng Mẫu 1/ }));
		expect(
			await screen.findByRole("heading", { name: "Cửa hàng Mẫu 1" }),
		).toBeInTheDocument();
		expectClosed("no-privacy", /chưa công bố Chính sách bảo mật/);
		expect(mockSdkCalls().map((call) => call.api)).not.toContain(
			"getPhoneNumber",
		);
	});

	it("says so in English", async () => {
		renderCustomerApp({ settings: { privacy: false }, language: "en" });
		const note = await screen.findByTestId("join-closed");
		expect(note).toHaveTextContent(
			"The shop has not published its privacy policy yet",
		);
		expect(
			screen.getByRole("button", { name: "Earn from a receipt" }),
		).toBeDisabled();
	});
});

describe("a tenant without an active programme", () => {
	it("shows the stores and menu, and no join, when there is no programme at all", async () => {
		renderCustomerApp({ settings: { programme: "none" } });
		expect(
			await screen.findByRole("heading", { name: "Chương trình thành viên" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("Quán chưa mở chương trình thành viên."),
		).toBeInTheDocument();
		expectClosed("no-programme", /chưa mở chương trình thành viên nên/);
		expect(screen.getByTestId("store-list")).toHaveTextContent(
			"Cửa hàng Mẫu 2",
		);
	});

	it("disables joining a paused programme up front and on the card tab", async () => {
		renderCustomerApp({ settings: { programme: "paused" } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		expectClosed("no-programme", /chưa mở chương trình thành viên nên/);
		fireEvent.click(
			within(screen.getByRole("navigation")).getByText("Thẻ thành viên"),
		);
		const prompt = await screen.findByTestId("join-prompt");
		expect(
			within(prompt).getByRole("button", { name: "Tham gia thành viên" }),
		).toBeDisabled();
	});

	it("answers a join opened by its address with the reason and no phone prompt", async () => {
		renderCustomerApp({
			settings: { programme: "ended" },
			routes: [{ path: "/", element: <JoinFlow /> }],
		});
		expect(
			await screen.findByRole("heading", { name: "Chưa tham gia được" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("join-closed")).toHaveAttribute(
			"data-reason",
			"no-programme",
		);
		expect(mockSdkCalls().map((call) => call.api)).not.toContain(
			"getPhoneNumber",
		);
	});

	it("words the server's refusal when the programme closed during the join", async () => {
		const app = renderCustomerApp();
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(
			screen.getByRole("button", { name: "Tham gia thành viên" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		fireEvent.click(await screen.findByTestId("consent-loyalty"));
		Object.assign(app.world, {
			sessionFetch: async () =>
				new Response(JSON.stringify({ error: "no_programme" }), {
					status: 409,
					headers: { "content-type": "application/json" },
				}),
		});
		fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
		expect(await screen.findByTestId("join-problem")).toHaveTextContent(
			"Chương trình thành viên hiện không mở để tham gia.",
		);
	});
});
