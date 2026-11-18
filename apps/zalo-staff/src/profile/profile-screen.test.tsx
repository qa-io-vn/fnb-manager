import { STAND_IN_LEGAL_DOCUMENTS, STAND_IN_NOTICE } from "@fnb/zalo-mini";
import type { MiniAppRoute } from "@fnb/zalo-mini/react";
import { mockSdkCalls, resetMockSdk } from "@fnb/zalo-mini/testing/mock-sdk";
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { routes } from "../app";
import type { StaffAccount } from "../onboarding/account";
import { renderStaffApp } from "../test/render-app";
import { type PhoneTokenRequest, ProfileScreen } from "./profile-screen";

function routesWith(requestToken: PhoneTokenRequest): MiniAppRoute[] {
	return routes.map((route) =>
		route.path === "/ca-nhan"
			? {
					path: route.path,
					element: <ProfileScreen requestToken={requestToken} />,
				}
			: route,
	);
}

function account(overrides: Partial<StaffAccount> = {}) {
	const calls: string[] = [];
	const value: StaffAccount = {
		noticeCheck: async () => ({ consent: "current", notice: STAND_IN_NOTICE }),
		acceptNotice: async () => undefined,
		withdraw: async () => {
			calls.push("withdraw");
		},
		linkPhone: async (token) => {
			calls.push(`linkPhone ${token}`);
			return "…789";
		},
		legalDocuments: async () => {
			calls.push("legalDocuments");
			return STAND_IN_LEGAL_DOCUMENTS;
		},
		...overrides,
	};
	return { factory: () => value, calls };
}

async function openProfile() {
	fireEvent.click(
		within(await screen.findByRole("navigation")).getByRole("button", {
			name: "Cá nhân",
		}),
	);
	return screen.findByTestId("profile");
}

function primaryActions(): string[] {
	return screen
		.queryAllByRole("button")
		.filter((button) => button.dataset.action === "primary")
		.map((button) => button.textContent ?? "");
}

beforeEach(() => {
	resetMockSdk();
});

describe("the Cá nhân tab", () => {
	it("shows a paired staff member the phone link, Privacy and Terms and the withdrawal", async () => {
		renderStaffApp();
		const profile = await openProfile();
		expect(
			within(profile).getByRole("heading", {
				level: 1,
				name: "Thành viên thử",
			}),
		).toBeInTheDocument();
		expect(within(profile).getByTestId("profile-role")).toHaveTextContent(
			"Quản lý",
		);
		expect(
			within(profile).getByTestId("profile-phone-state"),
		).toHaveTextContent("Chưa liên kết. Việc liên kết là tùy chọn.");
		expect(primaryActions()).toEqual(["Liên kết số điện thoại"]);
		expect(
			within(profile).getByRole("button", { name: "Rút lại đồng ý" }),
		).toBeInTheDocument();
		expect(within(profile).queryByRole("link")).not.toBeInTheDocument();
	});

	it("shows a member off the roster no phone link and no withdrawal", async () => {
		const { factory } = account({
			noticeCheck: async () => ({ consent: "not_required", notice: null }),
		});
		renderStaffApp({ accountFor: factory });
		const profile = await openProfile();
		expect(
			within(profile).queryByTestId("profile-phone"),
		).not.toBeInTheDocument();
		expect(
			within(profile).queryByTestId("profile-consent"),
		).not.toBeInTheDocument();
		expect(within(profile).getByTestId("profile-legal")).toBeInTheDocument();
	});

	it("explains the phone link before Zalo's permission prompt, and a refusal changes nothing", async () => {
		const { factory, calls } = account();
		let prompts = 0;
		renderStaffApp({
			accountFor: factory,
			routes: routesWith(async () => {
				prompts += 1;
				return null;
			}),
		});
		await openProfile();
		fireEvent.click(
			screen.getByRole("button", { name: "Liên kết số điện thoại" }),
		);
		const purpose = await screen.findByTestId("phone-purpose");
		expect(purpose).toHaveTextContent(
			"Số điện thoại giúp quản lý cửa hàng liên lạc với bạn về công việc khi cần.",
		);
		expect(purpose).toHaveTextContent("Việc liên kết là tùy chọn");
		expect(prompts).toBe(0);
		expect(primaryActions()).toEqual(["Tiếp tục"]);
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		const profile = await screen.findByTestId("profile");
		expect(prompts).toBe(1);
		expect(
			within(profile).getByTestId("profile-phone-state"),
		).toHaveTextContent("Chưa liên kết.");
		expect(calls).toEqual([]);
		expect(screen.queryByTestId("result-modal")).not.toBeInTheDocument();
	});

	it("links the phone after the person agrees in Zalo, with a result modal", async () => {
		const { factory, calls } = account();
		renderStaffApp({
			accountFor: factory,
			routes: routesWith(async () => "phone-token"),
		});
		await openProfile();
		fireEvent.click(
			screen.getByRole("button", { name: "Liên kết số điện thoại" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã liên kết số điện thoại",
		);
		expect(await screen.findByTestId("profile-phone-state")).toHaveTextContent(
			"Đã liên kết số …789",
		);
		expect(calls).toEqual(["linkPhone phone-token"]);
	});

	it("says so when the phone cannot be linked, and lets the person leave", async () => {
		const { factory } = account({
			linkPhone: async () => {
				throw new Error("refused");
			},
		});
		renderStaffApp({
			accountFor: factory,
			routes: routesWith(async () => "phone-token"),
		});
		await openProfile();
		fireEvent.click(
			screen.getByRole("button", { name: "Liên kết số điện thoại" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Chưa liên kết được số điện thoại. Hãy thử lại sau.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Để sau" }));
		expect(await screen.findByTestId("profile")).toBeInTheDocument();
	});

	it("asks Zalo for the phone with the mocked SDK only after the purpose screen", async () => {
		renderStaffApp();
		await openProfile();
		fireEvent.click(
			screen.getByRole("button", { name: "Liên kết số điện thoại" }),
		);
		await screen.findByTestId("phone-purpose");
		expect(mockSdkCalls().map((call) => call.api)).not.toContain(
			"getPhoneNumber",
		);
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		expect(await screen.findByTestId("result-modal")).toBeInTheDocument();
		expect(mockSdkCalls().map((call) => call.api)).toContain("getPhoneNumber");
	});

	it("opens Privacy and Terms as popups from the member's published texts", async () => {
		const { factory, calls } = account();
		renderStaffApp({
			accountFor: factory,
			dataEndpoint: {
				kind: "supabase",
				url: "https://project.example.com",
				publishableKey: "publishable-test",
			},
		});
		await openProfile();
		fireEvent.click(screen.getByRole("button", { name: "Quyền riêng tư" }));
		expect(
			await screen.findByRole("dialog", {
				name: "Chính sách quyền riêng tư (bản thử)",
			}),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
		fireEvent.click(screen.getByRole("button", { name: "Điều khoản sử dụng" }));
		expect(
			await screen.findByRole("dialog", {
				name: "Điều khoản sử dụng (bản thử)",
			}),
		).toBeInTheDocument();
		expect(calls).toEqual(["legalDocuments", "legalDocuments"]);
	});

	it("says when a text cannot be read and tries again", async () => {
		let attempts = 0;
		const { factory } = account({
			legalDocuments: async () => {
				attempts += 1;
				return attempts === 1 ? null : STAND_IN_LEGAL_DOCUMENTS;
			},
		});
		renderStaffApp({
			accountFor: factory,
			dataEndpoint: {
				kind: "supabase",
				url: "https://project.example.com",
				publishableKey: "publishable-test",
			},
		});
		await openProfile();
		fireEvent.click(screen.getByRole("button", { name: "Quyền riêng tư" }));
		const dialog = await screen.findByRole("dialog", {
			name: "Quyền riêng tư",
		});
		expect(within(dialog).getByRole("alert")).toHaveTextContent(
			"Chưa tải được văn bản. Hãy thử lại sau.",
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Thử lại" }));
		expect(
			await screen.findByRole("dialog", {
				name: "Chính sách quyền riêng tư (bản thử)",
			}),
		).toBeInTheDocument();
	});

	it("withdraws the agreement after a confirmation and goes back to the notice", async () => {
		const { factory, calls } = account();
		renderStaffApp({ accountFor: factory });
		await openProfile();
		fireEvent.click(screen.getByRole("button", { name: "Rút lại đồng ý" }));
		const dialog = await screen.findByRole("dialog", {
			name: "Rút lại đồng ý?",
		});
		expect(dialog).toHaveTextContent(
			"Đồng ý nhận thông báo, nếu có, vẫn giữ nguyên.",
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(calls).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "Rút lại đồng ý" }));
		fireEvent.click(
			within(
				await screen.findByRole("dialog", { name: "Rút lại đồng ý?" }),
			).getByRole("button", { name: "Rút lại đồng ý" }),
		);
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã rút lại đồng ý",
		);
		expect(
			await screen.findByRole("heading", {
				level: 1,
				name: STAND_IN_NOTICE.title,
			}),
		).toBeInTheDocument();
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(calls).toEqual(["withdraw"]);
	});
});
