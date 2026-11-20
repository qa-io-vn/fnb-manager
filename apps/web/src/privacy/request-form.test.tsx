import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { RequestForm } from "./request-form";

function renderForm(onSubmit = vi.fn(), subjectId: string | null = null) {
	render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<RequestForm subjectId={subjectId} busy={false} onSubmit={onSubmit} />
		</I18nProvider>,
	);
	return onSubmit;
}

describe("the request form", () => {
	it("refuses an empty contact and submits nothing", async () => {
		const user = userEvent.setup();
		const onSubmit = renderForm();
		await user.click(screen.getByTestId("privacy-form-submit"));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByText("Nhập cách liên hệ với khách.")).toBeVisible();
		expect(screen.getByTestId("privacy-form-contact")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
	});

	it("submits a trimmed request with the chosen type and processor flag", async () => {
		const user = userEvent.setup();
		const onSubmit = renderForm(vi.fn(), "c1");
		await user.selectOptions(
			screen.getByTestId("privacy-form-type"),
			"deletion",
		);
		await user.type(
			screen.getByTestId("privacy-form-contact"),
			"  khach@example.com ",
		);
		await user.click(screen.getByTestId("privacy-form-processor"));
		await user.type(screen.getByTestId("privacy-form-notes"), "ghi chú");
		await user.click(screen.getByTestId("privacy-form-submit"));
		expect(onSubmit).toHaveBeenCalledWith({
			requestType: "deletion",
			subjectId: "c1",
			contact: "khach@example.com",
			usesProcessor: true,
			notes: "ghi chú",
		});
	});

	it("offers the six request types", () => {
		renderForm();
		expect(
			screen.getByTestId("privacy-form-type").querySelectorAll("option"),
		).toHaveLength(6);
	});

	it("refuses a contact over 200 characters and clears the message once fixed", async () => {
		const user = userEvent.setup();
		const onSubmit = renderForm();
		const contact = screen.getByTestId("privacy-form-contact");
		await user.click(contact);
		await user.paste("a".repeat(201));
		await user.click(screen.getByTestId("privacy-form-submit"));
		expect(screen.getByText("Cách liên hệ tối đa 200 ký tự.")).toBeVisible();
		await user.clear(contact);
		await user.type(contact, "ok");
		await user.click(screen.getByTestId("privacy-form-submit"));
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("Cách liên hệ tối đa 200 ký tự.")).toBeNull();
	});

	it("tells whether the request is linked to a customer", () => {
		renderForm(vi.fn(), "c1");
		expect(
			screen.getByText("Yêu cầu sẽ gắn với khách vừa tra cứu."),
		).toBeVisible();
	});

	it("warns that an unlinked request cannot be exported, corrected or deleted", () => {
		renderForm();
		expect(screen.getByText(/Yêu cầu chưa gắn với khách nào/)).toBeVisible();
	});
});
