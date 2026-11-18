import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Membership, StoreProfile } from "../source";
import type { StaffMember } from "./source";
import { StaffForm } from "./staff-form";
import { staffStoreChoices } from "./staff-rules";

const STORE_1 = "11111111-1111-4111-8111-111111111111";
const STORE_2 = "22222222-2222-4222-8222-222222222222";

function profile(storeId: string, name: string): StoreProfile {
	return {
		storeId,
		posAccountId: "account",
		name,
		address: null,
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
		code: null,
		openingHours: null,
		seatCount: null,
		openedOn: null,
		eInvoiceStatus: "unknown",
		tranNoResetPeriod: "unknown",
		memberCaptureStatus: "unknown",
		audit: null,
	} as StoreProfile;
}

const PROFILES = [
	profile(STORE_1, "Cửa hàng thử 1"),
	profile(STORE_2, "Cửa hàng thử 2"),
];

function renderForm(
	membership: Membership,
	member: StaffMember | null = null,
	onSubmit = vi.fn(),
) {
	const onClose = vi.fn();
	render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<StaffForm
				member={member}
				choices={staffStoreChoices(membership, PROFILES)}
				busy={false}
				status={null}
				onRetry={null}
				onSubmit={onSubmit}
				onEdit={() => undefined}
				onClose={onClose}
			/>
		</I18nProvider>,
	);
	return { onSubmit, onClose, form: screen.getByTestId("staff-form") };
}

describe("StaffForm", () => {
	it("checks the name and the stores before sending anything", async () => {
		const user = userEvent.setup();
		const { onSubmit, form } = renderForm({ role: "owner", storeIds: null });
		expect(within(form).getByLabelText("Tên hiển thị")).toHaveFocus();
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(within(form).getByText("Ô này không được để trống.")).toBeVisible();
		expect(within(form).getByText("Chọn ít nhất một cửa hàng.")).toBeVisible();
		const name = within(form).getByLabelText("Tên hiển thị");
		await user.type(name, "x".repeat(101));
		expect(within(form).getByText("Nhập tối đa 100 ký tự.")).toBeVisible();
		await user.clear(name);
		await user.type(name, "  Nhân viên 4  ");
		await user.click(within(form).getByLabelText("Cửa hàng thử 2"));
		await user.selectOptions(within(form).getByLabelText("Vai trò"), "manager");
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		expect(onSubmit).toHaveBeenCalledWith({
			displayName: "Nhân viên 4",
			role: "manager",
			storeIds: [STORE_2],
		});
	});

	it("lets a member with every store grant all stores, including those opened later", async () => {
		const user = userEvent.setup();
		const { onSubmit, form } = renderForm({ role: "manager", storeIds: null });
		await user.type(within(form).getByLabelText("Tên hiển thị"), "Nhân viên 4");
		await user.click(
			within(form).getByLabelText("Tất cả cửa hàng, cả cửa hàng mở sau này"),
		);
		expect(within(form).queryByLabelText("Cửa hàng thử 1")).toBeNull();
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		expect(onSubmit).toHaveBeenCalledWith({
			displayName: "Nhân viên 4",
			role: "staff",
			storeIds: null,
		});
	});

	it("offers a store-limited manager only their own store, already chosen, and never all stores", async () => {
		const user = userEvent.setup();
		const { onSubmit, form } = renderForm({
			role: "manager",
			storeIds: [STORE_1],
		});
		const stores = within(form).getByTestId("staff-form-stores");
		expect(within(stores).getAllByRole("checkbox")).toHaveLength(1);
		expect(within(stores).getByLabelText("Cửa hàng thử 1")).toBeChecked();
		expect(within(stores).queryByLabelText("Cửa hàng thử 2")).toBeNull();
		expect(
			within(stores).queryByLabelText(
				"Tất cả cửa hàng, cả cửa hàng mở sau này",
			),
		).toBeNull();
		await user.type(within(form).getByLabelText("Tên hiển thị"), "Nhân viên 4");
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		expect(onSubmit).toHaveBeenCalledWith({
			displayName: "Nhân viên 4",
			role: "staff",
			storeIds: [STORE_1],
		});
	});

	it("opens an edit on the person's values, sends nothing while they are unchanged and closes on Escape", async () => {
		const user = userEvent.setup();
		const member: StaffMember = {
			id: "row-1",
			displayName: "Nhân viên 1",
			role: "staff",
			storeIds: [STORE_1, STORE_2],
			status: "active",
			paired: true,
			pairedAt: "2026-11-01T02:00:00Z",
			phoneHint: null,
			deactivatedAt: null,
			audit: null,
		};
		const { onSubmit, onClose, form } = renderForm(
			{ role: "owner", storeIds: null },
			member,
		);
		expect(within(form).getByRole("heading")).toHaveTextContent(
			"Sửa Nhân viên 1",
		);
		expect(within(form).getByLabelText("Tên hiển thị")).toHaveValue(
			"Nhân viên 1",
		);
		expect(within(form).getByLabelText("Cửa hàng thử 1")).toBeChecked();
		expect(within(form).getByLabelText("Cửa hàng thử 2")).toBeChecked();
		const save = within(form).getByRole("button", { name: "Lưu" });
		expect(save).toHaveAttribute("aria-disabled", "true");
		expect(within(form).getByRole("status")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
		await user.click(save);
		expect(onSubmit).not.toHaveBeenCalled();
		await user.click(within(form).getByLabelText("Cửa hàng thử 2"));
		expect(save).not.toHaveAttribute("aria-disabled");
		await user.click(save);
		expect(onSubmit).toHaveBeenCalledWith({
			displayName: "Nhân viên 1",
			role: "staff",
			storeIds: [STORE_1],
		});
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("refuses a name with a control character", async () => {
		const user = userEvent.setup();
		const { onSubmit, form } = renderForm({ role: "owner", storeIds: null });
		const name = within(form).getByLabelText("Tên hiển thị");
		await user.click(name);
		await user.paste("Nhân\u0007viên");
		await user.click(within(form).getByLabelText("Cửa hàng thử 1"));
		await user.click(within(form).getByRole("button", { name: "Thêm" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(
			within(form).getByText("Tên không được chứa ký tự điều khiển."),
		).toBeVisible();
	});
});
