import config from "virtual:mini-app-config";
import {
	RestError,
	STAND_IN_CONTACT,
	STAND_IN_LEGAL_DOCUMENTS,
	STAND_IN_NEW_NOTICE,
	STAND_IN_NOTICE,
	STAND_IN_REJECTED_CODE,
	STAND_IN_WAIT_CODE,
} from "@fnb/zalo-mini";
import { RESULT_MODAL_MS } from "@fnb/zalo-mini/react";
import { mockSdkCalls, resetMockSdk } from "@fnb/zalo-mini/testing/mock-sdk";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderStaffApp } from "../test/render-app";
import type { StaffAccount, StaffAccountFactory } from "./account";

function primaryActions(): HTMLElement[] {
	return screen
		.queryAllByRole("button")
		.filter((button) => button.dataset.action === "primary");
}

async function onNotice(title = STAND_IN_NOTICE.title) {
	return screen.findByRole("heading", { level: 1, name: title });
}

async function continueToNotice() {
	fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
	await onNotice();
}

async function agreeAndPair(code: string) {
	fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
	const input = await screen.findByLabelText("Mã ghép nối");
	fireEvent.change(input, { target: { value: code } });
	fireEvent.click(screen.getByRole("button", { name: "Ghép nối" }));
	return input;
}

function fakeAccount(overrides: Partial<StaffAccount> = {}): {
	readonly factory: StaffAccountFactory;
	readonly calls: string[];
} {
	const calls: string[] = [];
	const account: StaffAccount = {
		noticeCheck: async () => {
			calls.push("noticeCheck");
			return { consent: "current", notice: STAND_IN_NOTICE };
		},
		acceptNotice: async (acceptance) => {
			calls.push(`acceptNotice ${acceptance.version}`);
		},
		withdraw: async () => {
			calls.push("withdraw");
		},
		linkPhone: async () => "…789",
		legalDocuments: async () => STAND_IN_LEGAL_DOCUMENTS,
		...overrides,
	};
	return { factory: () => account, calls };
}

beforeEach(() => {
	resetMockSdk();
});

describe("the staff app's entry", () => {
	it("new: shows onboarding before any Zalo identity call, with one primary action and no tabs", async () => {
		renderStaffApp({ scenario: "unpaired" });
		expect(
			await screen.findByRole("heading", {
				level: 1,
				name: "Ứng dụng nội bộ cho nhân viên",
			}),
		).toBeInTheDocument();
		const entry = screen.getByTestId("entry");
		expect(entry).toHaveTextContent(
			`${config.app.title} là ứng dụng nội bộ dành cho nhân viên cửa hàng`,
		);
		expect(entry).toHaveTextContent("Vì sao cần đăng nhập bằng Zalo");
		expect(entry).toHaveTextContent(
			"Mã định danh Zalo của bạn trong ứng dụng này và tên hiển thị trên Zalo.",
		);
		expect(entry).toHaveTextContent(
			"Số điện thoại chỉ khi sau này bạn tự liên kết trong mục Cá nhân.",
		);
		expect(primaryActions().map((button) => button.textContent)).toEqual([
			"Tiếp tục",
		]);
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
		expect(mockSdkCalls().map((call) => call.api)).toEqual([]);
		await continueToNotice();
		expect(mockSdkCalls().map((call) => call.api)).toEqual(["getAccessToken"]);
	});

	it("opens Privacy and Terms from onboarding as popups with the published texts", async () => {
		renderStaffApp({ scenario: "unpaired" });
		fireEvent.click(
			await screen.findByRole("button", { name: "Quyền riêng tư" }),
		);
		const privacy = await screen.findByRole("dialog", {
			name: "Chính sách quyền riêng tư (bản thử)",
		});
		expect(within(privacy).getByTestId("legal-version")).toHaveTextContent(
			"Phiên bản stand-in-privacy-1 · công bố ngày",
		);
		expect(within(privacy).queryByRole("link")).not.toBeInTheDocument();
		fireEvent.click(within(privacy).getByRole("button", { name: "Đóng" }));
		fireEvent.click(screen.getByRole("button", { name: "Điều khoản sử dụng" }));
		expect(
			await screen.findByRole("dialog", {
				name: "Điều khoản sử dụng (bản thử)",
			}),
		).toBeInTheDocument();
		expect(mockSdkCalls()).toEqual([]);
	});

	it("notice and refused: declining shows the contact instructions and leads back to the notice", async () => {
		renderStaffApp({ scenario: "unpaired" });
		await continueToNotice();
		expect(screen.getByTestId("staff-notice")).toHaveTextContent(
			STAND_IN_NOTICE.bodyMarkdown,
		);
		expect(screen.getByTestId("notice-hint")).toHaveTextContent(
			"Hãy đọc thông báo dưới đây. Bạn chỉ dùng được ứng dụng sau khi đồng ý.",
		);
		expect(primaryActions().map((button) => button.textContent)).toEqual([
			"Đồng ý",
		]);
		fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
		expect(
			await screen.findByRole("heading", { level: 1, name: "Bạn đã từ chối" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("refusal-contact")).toHaveTextContent(
			STAND_IN_CONTACT,
		);
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Xem lại thông báo" }));
		await onNotice();
	});

	it("pairing: a wrong or expired code gets one message, and too many attempts a wait", async () => {
		renderStaffApp({ scenario: "unpaired" });
		await continueToNotice();
		const input = await agreeAndPair(STAND_IN_REJECTED_CODE);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Mã không đúng hoặc đã hết hạn. Hãy kiểm tra lại hoặc nhờ quản lý cấp mã mới.",
		);
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAttribute("inputmode", "numeric");
		expect(input).toHaveAttribute("autocomplete", "one-time-code");
		fireEvent.change(input, { target: { value: STAND_IN_WAIT_CODE } });
		fireEvent.click(screen.getByRole("button", { name: "Ghép nối" }));
		await waitFor(() =>
			expect(screen.getByRole("timer")).toHaveTextContent(
				/^Bạn đã nhập sai nhiều lần\. Hãy thử lại sau (15:00|14:5\d)\.$/,
			),
		);
		expect(screen.getByRole("button", { name: "Ghép nối" })).toBeDisabled();
	});

	it("paired: shows loading at once, a result modal for 1.5 s, then the home with its tabs", async () => {
		renderStaffApp({ scenario: "unpaired", delayMs: 400 });
		await continueToNotice();
		await agreeAndPair("123456");
		const busy = screen.getByRole("button", { name: "Đang ghép nối…" });
		expect(busy).toHaveAttribute("aria-busy", "true");
		const modal = await screen.findByTestId("result-modal", undefined, {
			timeout: 3000,
		});
		const shown = Date.now();
		expect(modal).toHaveTextContent("Ghép nối thành công");
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
		await waitFor(
			() =>
				expect(screen.queryByTestId("result-modal")).not.toBeInTheDocument(),
			{ timeout: RESULT_MODAL_MS + 1500 },
		);
		expect(Date.now() - shown).toBeGreaterThanOrEqual(RESULT_MODAL_MS - 100);
		expect(screen.getByRole("navigation")).toBeInTheDocument();
	});

	it("notice outdated while pairing: shows the new version and pairs with the code kept", async () => {
		renderStaffApp({ scenario: "unpaired", noticeChange: true });
		await continueToNotice();
		await agreeAndPair("123456");
		await onNotice(STAND_IN_NEW_NOTICE.title);
		expect(screen.getByTestId("notice-hint")).toHaveTextContent(
			"Thông báo cho nhân viên vừa có phiên bản mới. Hãy đọc lại trước khi đồng ý.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
		expect(await screen.findByLabelText("Mã ghép nối")).toHaveValue("123456");
		fireEvent.click(screen.getByRole("button", { name: "Ghép nối" }));
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
	});

	it("never shows the new notice with the old hint, not even for one render", async () => {
		renderStaffApp({ scenario: "unpaired", noticeChange: true });
		await continueToNotice();
		fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
		fireEvent.change(await screen.findByLabelText("Mã ghép nối"), {
			target: { value: "123456" },
		});
		const hintsWithNewNotice: string[] = [];
		const observer = new MutationObserver(() => {
			const title =
				screen.queryByRole("heading", { level: 1 })?.textContent ?? "";
			if (title === STAND_IN_NEW_NOTICE.title) {
				hintsWithNewNotice.push(
					screen.queryByTestId("notice-hint")?.textContent ?? "",
				);
			}
		});
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Ghép nối" }));
		await onNotice(STAND_IN_NEW_NOTICE.title);
		observer.disconnect();
		expect(hintsWithNewNotice.length).toBeGreaterThan(0);
		expect(new Set(hintsWithNewNotice)).toEqual(
			new Set([
				"Thông báo cho nhân viên vừa có phiên bản mới. Hãy đọc lại trước khi đồng ý.",
			]),
		);
	});

	it("notice outdated after pairing: zalo-session asks again and the agreement signs in", async () => {
		renderStaffApp({ scenario: "notice" });
		await onNotice();
		expect(screen.getByTestId("notice-hint")).toHaveTextContent(
			"Hãy đọc và đồng ý với thông báo này để tiếp tục dùng ứng dụng.",
		);
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã ghi nhận đồng ý",
		);
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
	});

	it("notice outdated with a stored session: my_staff_notice asks before anything else", async () => {
		let consent: "outdated" | "current" = "outdated";
		const { factory, calls } = fakeAccount({
			noticeCheck: async () => ({ consent, notice: STAND_IN_NEW_NOTICE }),
			acceptNotice: async (acceptance) => {
				calls.push(`acceptNotice ${acceptance.version}`);
				consent = "current";
			},
		});
		renderStaffApp({ scenario: "bound", accountFor: factory });
		await onNotice(STAND_IN_NEW_NOTICE.title);
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(screen.queryByTestId("home")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã ghi nhận đồng ý",
		);
		expect(await screen.findByTestId("home")).toBeInTheDocument();
		expect(calls).toEqual([`acceptNotice ${STAND_IN_NEW_NOTICE.version}`]);
	});

	it("a refused session at the notice check goes back to the start instead of an error", async () => {
		let refusals = 0;
		const { factory } = fakeAccount({
			noticeCheck: async () => {
				refusals += 1;
				throw new RestError(403);
			},
		});
		renderStaffApp({ scenario: "bound", accountFor: factory });
		await onNotice();
		expect(refusals).toBe(1);
		expect(screen.getByRole("button", { name: "Đồng ý" })).toBeEnabled();
	});

	it("lets the person in when the notice check cannot answer", async () => {
		const { factory } = fakeAccount({
			noticeCheck: async () => {
				throw new RestError(0);
			},
		});
		renderStaffApp({ scenario: "bound", accountFor: factory });
		expect(await screen.findByTestId("home")).toBeInTheDocument();
	});

	it("says whom to tell when no notice is published, and retries a lost connection", async () => {
		renderStaffApp({
			scenario: "unpaired",
			client: (client) => ({
				...client,
				start: async () => ({ status: "unpaired", codeRejected: false }),
			}),
		});
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		expect(
			await screen.findByRole("heading", {
				level: 1,
				name: "Chưa có thông báo cho nhân viên",
			}),
		).toBeInTheDocument();
		expect(primaryActions().map((button) => button.textContent)).toEqual([
			"Thử lại",
		]);
	});

	it("offers one retry after a failed connection", async () => {
		renderStaffApp({ scenario: "failed" });
		expect(
			await screen.findByRole("heading", {
				level: 1,
				name: "Chưa kết nối được",
			}),
		).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "Thử lại" })).toHaveLength(1);
	});

	it("speaks English with the same keys", async () => {
		renderStaffApp({ scenario: "unpaired", language: "en" });
		expect(
			await screen.findByRole("heading", {
				level: 1,
				name: "An internal app for staff",
			}),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await onNotice();
		fireEvent.click(screen.getByRole("button", { name: "Decline" }));
		expect(
			await screen.findByRole("heading", { level: 1, name: "You declined" }),
		).toBeInTheDocument();
	});
});
