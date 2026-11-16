import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import type { PaymentMethodEntry } from "../source";
import {
	PaymentKindsForm,
	type PaymentKindsFormProps,
} from "./payment-kinds-form";

function method(
	account: string,
	id: string,
	name: string,
	posKind: PaymentMethodEntry["posKind"],
	overrideKind: PaymentMethodEntry["overrideKind"] = null,
): PaymentMethodEntry {
	return {
		posAccountId: account,
		posAccountName: account === "A" ? "POS trà" : "POS cà phê",
		externalId: id,
		name,
		posKind,
		overrideKind,
		kind: overrideKind ?? posKind,
		audit:
			overrideKind === null
				? null
				: { changedAt: "2026-11-10T03:00:00Z", author: { kind: "you" } },
	};
}

const ENTRIES: readonly PaymentMethodEntry[] = [
	method("A", "CASH", "Tiền mặt", "cash"),
	method("A", "WALLET", "Ví QR", "other", "ewallet"),
	method("B", "BANK", "Chuyển khoản", "bank_transfer"),
];

function propsWith(
	overrides: Partial<PaymentKindsFormProps> = {},
): PaymentKindsFormProps {
	return {
		entries: ENTRIES,
		formatters: vndFormatters(),
		timeZone: "Asia/Ho_Chi_Minh",
		canWrite: true,
		saving: false,
		outcome: { kind: "idle" },
		onSave: vi.fn(),
		onRetry: vi.fn(),
		onEdit: vi.fn(),
		...overrides,
	};
}

function renderForm(overrides: Partial<PaymentKindsFormProps> = {}) {
	const props = propsWith(overrides);
	return { props, ...renderWithLanguage(<PaymentKindsForm {...props} />) };
}

function select(name: string): HTMLElement {
	return screen.getByRole("combobox", { name });
}

describe("PaymentKindsForm", () => {
	it("lists every method under its POS account with the POS kind, the override and the kind in effect", () => {
		renderForm();
		const tea = screen.getByRole("region", { name: "POS trà" });
		expect(within(tea).getAllByTestId("payment-kind-row")).toHaveLength(2);
		expect(select("Tiền mặt")).toHaveValue("");
		expect(select("Tiền mặt")).toHaveAccessibleDescription(
			"Trên POS: Tiền mặt · Đang tính là: Tiền mặt",
		);
		expect(select("Ví QR")).toHaveValue("ewallet");
		expect(select("Ví QR")).toHaveAccessibleDescription(
			"Trên POS: Khác · Đang tính là: Ví điện tử",
		);
		expect(
			within(select("Ví QR"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"Theo POS",
			"Tiền mặt",
			"Ví điện tử",
			"Chuyển khoản",
			"Thẻ",
			"Voucher",
			"Khác",
		]);
		expect(screen.getAllByTestId("settings-audit-line")).toHaveLength(1);
		expect(screen.getByRole("region", { name: "POS cà phê" })).toBeVisible();
	});

	it("says that past shifts' expected cash follows only after those days are synced again", () => {
		renderForm();
		expect(screen.getByRole("note")).toHaveTextContent(
			"Tiền mặt dự kiến trong két của các ca đã qua chỉ đổi theo loại mới sau khi đồng bộ lại những ngày đó.",
		);
	});

	it("saves only the changed methods, with As in the POS sent as a deleted override", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await user.selectOptions(select("Ví QR"), "Theo POS");
		await user.selectOptions(select("Chuyển khoản"), "Thẻ");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"2 thay đổi chưa lưu",
		);
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith([
			{ posAccountId: "A", paymentMethodExternalId: "WALLET", kind: null },
			{ posAccountId: "B", paymentMethodExternalId: "BANK", kind: "card" },
		]);
	});

	it("discards the pending changes back to the saved kinds", async () => {
		const user = userEvent.setup();
		renderForm();
		await user.selectOptions(select("Tiền mặt"), "Khác");
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(select("Tiền mặt")).toHaveValue("");
	});

	it("keeps a method being edited when the saved kinds are read again, and takes the others", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderForm();
		await user.selectOptions(select("Tiền mặt"), "Khác");
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<PaymentKindsForm
					{...props}
					entries={[
						ENTRIES[0] as PaymentMethodEntry,
						method("A", "WALLET", "Ví QR", "other", "card"),
						ENTRIES[2] as PaymentMethodEntry,
					]}
				/>
			</I18nProvider>,
		);
		expect(select("Tiền mặt")).toHaveValue("other");
		expect(select("Ví QR")).toHaveValue("card");
	});

	it("says it is saved once the saved kinds come back", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderForm();
		await user.selectOptions(select("Chuyển khoản"), "Thẻ");
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<PaymentKindsForm
					{...props}
					entries={[
						ENTRIES[0] as PaymentMethodEntry,
						ENTRIES[1] as PaymentMethodEntry,
						method("B", "BANK", "Chuyển khoản", "bank_transfer", "card"),
					]}
					outcome={{ kind: "saved" }}
				/>
			</I18nProvider>,
		);
		expect(select("Chuyển khoản")).toHaveAccessibleDescription(
			"Trên POS: Chuyển khoản · Đang tính là: Thẻ",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		);
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
	});

	it("shows the refusal's message from its key and offers a retry after a lost connection", async () => {
		const user = userEvent.setup();
		const { props } = renderForm({
			outcome: {
				kind: "refused",
				messageKey: "settings.error.network",
				canRetry: true,
			},
		});
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"mất kết nối",
		);
		await user.click(screen.getByRole("button", { name: "Thử lại" }));
		expect(props.onRetry).toHaveBeenCalledOnce();
	});

	it("shows the kinds as text with no save bar to a member who may not write", () => {
		renderForm({ canWrite: false });
		expect(screen.getByRole("textbox", { name: "Ví QR" })).toHaveValue(
			"Ví điện tử",
		);
		expect(screen.getByRole("textbox", { name: "Tiền mặt" })).toHaveValue(
			"Theo POS",
		);
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("says where methods come from when there are none", () => {
		renderForm({ entries: [] });
		expect(screen.getByTestId("payment-kinds-empty")).toHaveTextContent(
			"sau lần đồng bộ đầu tiên",
		);
	});
});
