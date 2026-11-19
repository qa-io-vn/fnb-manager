import type { DeletionRequest } from "@fnb/zalo-mini/loyalty";
import { I18nProvider } from "@fnb/zalo-mini/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_DELETION_REQUEST_ID } from "../demo/world";
import { catalogs } from "../i18n/catalog";
import { renderCustomerApp, setSearch } from "../test/render-app";
import {
	DeletionState,
	deletionOpen,
	deletionReference,
} from "./settings-screen";

afterEach(() => setSearch(""));

async function openAccount() {
	await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
	fireEvent.click(screen.getByText("Tài khoản"));
	return within(await screen.findByTestId("settings-delete"));
}

const REQUEST: DeletionRequest = {
	requestId: "aaaaaaaa-0000-4000-8000-000000000001",
	status: "received",
	requestedAt: "2026-11-19T03:00:00.000Z",
};

function renderState(request: DeletionRequest, language: "vi" | "en" = "vi") {
	render(
		<I18nProvider language={language} catalogs={catalogs}>
			<DeletionState request={request} />
		</I18nProvider>,
	);
	return within(screen.getByTestId("deletion-state"));
}

describe("Xóa dữ liệu của tôi", () => {
	it("asks for a clear confirmation with the legal deadlines before anything is sent", async () => {
		const app = renderCustomerApp({ settings: { member: true } });
		const card = await openAccount();
		expect(card.getByRole("heading")).toHaveTextContent("Xóa dữ liệu của tôi");
		fireEvent.click(card.getByRole("button", { name: "Xóa dữ liệu của tôi" }));
		const dialog = within(
			await screen.findByRole("dialog", { name: "Xóa dữ liệu của bạn?" }),
		);
		expect(dialog.getByText(/xóa vĩnh viễn/)).toBeInTheDocument();
		expect(
			dialog.getByText(
				"Chủ quán thực hiện yêu cầu trong thời hạn pháp luật quy định: phản hồi trong 2 ngày làm việc và xóa xong trong 20 ngày (30 ngày nếu có bên xử lý dữ liệu tham gia).",
			),
		).toBeInTheDocument();
		const send = dialog.getByRole("button", { name: "Gửi yêu cầu xóa" });
		const understood = dialog.getByRole("checkbox", {
			name: "Tôi hiểu dấu, điểm và ưu đãi chưa dùng sẽ mất.",
		});
		expect(understood).not.toBeChecked();
		expect(send).toBeDisabled();
		fireEvent.click(dialog.getByRole("button", { name: "Giữ nguyên" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(app.world.deletionRequested()).toBe(false);
		fireEvent.click(card.getByRole("button", { name: "Xóa dữ liệu của tôi" }));
		const again = within(await screen.findByRole("dialog"));
		expect(again.getByRole("checkbox")).not.toBeChecked();
		expect(
			again.getByRole("button", { name: "Gửi yêu cầu xóa" }),
		).toBeDisabled();
	});

	it("sends the request once ticked and shows its state, kept across tabs", async () => {
		const app = renderCustomerApp({ settings: { member: true } });
		const card = await openAccount();
		fireEvent.click(card.getByRole("button", { name: "Xóa dữ liệu của tôi" }));
		const dialog = within(await screen.findByRole("dialog"));
		fireEvent.click(dialog.getByRole("checkbox"));
		fireEvent.click(dialog.getByRole("button", { name: "Gửi yêu cầu xóa" }));
		expect(
			await screen.findByText("Đã gửi yêu cầu xóa dữ liệu"),
		).toBeInTheDocument();
		expect(app.world.deletionRequested()).toBe(true);
		const state = within(await screen.findByTestId("deletion-state"));
		expect(state.getByTestId("deletion-status")).toHaveTextContent(
			"Chủ quán đã nhận yêu cầu",
		);
		expect(state.getByTestId("deletion-requested")).toHaveTextContent(
			`Gửi lúc`,
		);
		expect(state.getByTestId("deletion-requested")).toHaveTextContent(
			`Mã yêu cầu ${DEMO_DELETION_REQUEST_ID.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
		);
		expect(state.getByTestId("deletion-deadline")).toHaveTextContent(
			"phản hồi trong 2 ngày làm việc",
		);
		expect(
			screen.queryByRole("button", { name: "Xóa dữ liệu của tôi" }),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("Trang chủ"));
		await screen.findByTestId("home");
		fireEvent.click(screen.getByText("Tài khoản"));
		expect(await screen.findByTestId("deletion-status")).toHaveAttribute(
			"data-status",
			"received",
		);
	});

	it("keeps the confirmation open with the reason when the request cannot be sent", async () => {
		const app = renderCustomerApp({ settings: { member: true } });
		const card = await openAccount();
		fireEvent.click(card.getByRole("button", { name: "Xóa dữ liệu của tôi" }));
		const dialog = within(await screen.findByRole("dialog"));
		fireEvent.click(dialog.getByRole("checkbox"));
		app.world.setOffline(true);
		fireEvent.click(dialog.getByRole("button", { name: "Gửi yêu cầu xóa" }));
		expect(await dialog.findByRole("alert")).toHaveTextContent(
			"Mất kết nối mạng",
		);
		expect(app.world.deletionRequested()).toBe(false);
		expect(screen.queryByTestId("deletion-state")).not.toBeInTheDocument();
	});

	it("speaks English with the same deadlines", async () => {
		renderCustomerApp({ settings: { member: true }, language: "en" });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByText("Account"));
		const card = within(await screen.findByTestId("settings-delete"));
		fireEvent.click(card.getByRole("button", { name: "Delete my data" }));
		const dialog = within(
			await screen.findByRole("dialog", { name: "Delete your data?" }),
		);
		expect(
			dialog.getByText(
				/a reply within 2 working days and the deletion within 20 days/,
			),
		).toBeInTheDocument();
		expect(
			dialog.getByRole("button", { name: "Send the deletion request" }),
		).toBeDisabled();
	});

	it("words every state of the request", () => {
		expect(deletionReference(REQUEST)).toBe("AAAAAAAA");
		expect(deletionOpen(REQUEST)).toBe(true);
		expect(deletionOpen({ ...REQUEST, status: "in_progress" })).toBe(true);
		expect(deletionOpen({ ...REQUEST, status: "completed" })).toBe(false);
		expect(deletionOpen({ ...REQUEST, status: "rejected" })).toBe(false);
		const progress = renderState({ ...REQUEST, status: "in_progress" });
		expect(progress.getByTestId("deletion-status")).toHaveTextContent(
			"Chủ quán đang xử lý",
		);
		expect(progress.getByTestId("deletion-requested")).toHaveTextContent(
			"Gửi lúc 10:00 19/11/2026",
		);
		expect(progress.getByTestId("deletion-deadline")).toBeInTheDocument();
	});

	it("says when the data is deleted", () => {
		const done = renderState({ ...REQUEST, status: "completed" }, "en");
		expect(done.getByTestId("deletion-status")).toHaveTextContent("Deleted");
		expect(done.getByText("Your member data has been deleted.")).toBeVisible();
		expect(done.queryByTestId("deletion-deadline")).toBeNull();
	});

	it("says when the owner did not carry it out", () => {
		const refused = renderState({ ...REQUEST, status: "rejected" });
		expect(refused.getByTestId("deletion-status")).toHaveTextContent(
			"Yêu cầu không được thực hiện",
		);
		expect(refused.getByText(/Hãy hỏi nhân viên tại quầy/)).toBeVisible();
	});
});

describe("the account tab", () => {
	it("shows the loading state while the session starts and the error when it cannot", async () => {
		renderCustomerApp({ settings: { sessionFailure: true } });
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Mất kết nối mạng");
		fireEvent.click(screen.getByText("Tài khoản"));
		const settings = within(await screen.findByTestId("settings"));
		expect(settings.getByRole("alert")).toHaveTextContent("Mất kết nối mạng");
		expect(
			settings.getByRole("button", { name: "Thử lại" }),
		).toBeInTheDocument();
		expect(
			settings.getByRole("button", { name: "Chính sách bảo mật" }),
		).toBeInTheDocument();
	});
});
