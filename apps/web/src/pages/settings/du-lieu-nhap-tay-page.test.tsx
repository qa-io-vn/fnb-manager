import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import DuLieuNhapTayPage, { manualTabOf } from "./du-lieu-nhap-tay-page";

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: {
			id: "tenant-1",
			name: "Quán mẫu",
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
			countryCode: "VN",
		},
		stores: [],
	}),
}));

vi.mock("../../settings/manual/costs-tab", () => ({
	CostsTab: () => <p data-testid="costs-tab-stub" />,
}));

vi.mock("../../settings/manual/targets-tab", () => ({
	TargetsTab: () => <p data-testid="targets-tab-stub" />,
}));

vi.mock("../../settings/fees/fees-tab", () => ({
	FeesTab: () => <p data-testid="fees-tab-stub" />,
}));

function renderPage(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<DuLieuNhapTayPage />
			</I18nProvider>
		</MemoryRouter>,
	);
}

describe("the Dữ liệu nhập tay page", () => {
	it("opens on Giá vốn and switches to the targets and the fees", async () => {
		const user = userEvent.setup();
		renderPage("/cai-dat/du-lieu-nhap-tay");
		expect(screen.getByTestId("costs-tab-stub")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Giá vốn" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		await user.click(screen.getByRole("link", { name: "Mục tiêu" }));
		expect(screen.getByTestId("targets-tab-stub")).toBeInTheDocument();
		expect(screen.queryByTestId("costs-tab-stub")).toBeNull();
		await user.click(screen.getByRole("link", { name: "Phí thanh toán" }));
		expect(screen.getByTestId("fees-tab-stub")).toBeInTheDocument();
		expect(screen.queryByTestId("targets-tab-stub")).toBeNull();
		expect(
			screen.getByRole("link", { name: "Phí thanh toán" }),
		).toHaveAttribute("aria-current", "page");
	});

	it("lands the reports' links on their tab and an unknown tab on Giá vốn", () => {
		renderPage("/cai-dat/du-lieu-nhap-tay?tab=phi");
		expect(screen.getByTestId("fees-tab-stub")).toBeInTheDocument();
		expect(manualTabOf("gia-von").slug).toBe("gia-von");
		expect(manualTabOf("muc-tieu").slug).toBe("muc-tieu");
		expect(manualTabOf("khong-co").slug).toBe("gia-von");
		expect(manualTabOf(null).slug).toBe("gia-von");
	});
});
