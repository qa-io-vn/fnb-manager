import { emitMockOpenApp } from "@fnb/zalo-mini/testing/mock-sdk";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	storeLinkFrom,
	storeLinkFromEvent,
	storeLinkFromPath,
} from "../data/store-link";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { looksLikePrice, menuAt } from "./model";

afterEach(() => setSearch(""));

describe("store links", () => {
	it("read the store and the source from the route parameters", () => {
		expect(storeLinkFrom({ store: "mau-2", src: "qr" })).toEqual({
			store: "mau-2",
			source: "qr",
		});
		expect(storeLinkFrom({ store: "MAU-1", src: "flyer" })).toEqual({
			store: "mau-1",
			source: null,
		});
		expect(storeLinkFrom({ store: "../x" })).toBeNull();
		expect(storeLinkFrom({})).toBeNull();
		expect(storeLinkFromPath("/?store=mau-1&src=standee")).toEqual({
			store: "mau-1",
			source: "standee",
		});
		expect(storeLinkFromEvent({ path: "/?store=mau-2&src=receipt" })).toEqual({
			store: "mau-2",
			source: "receipt",
		});
		expect(storeLinkFromEvent({ params: { store: "mau-1" } })).toEqual({
			store: "mau-1",
			source: null,
		});
		expect(storeLinkFromEvent(null)).toBeNull();
	});
});

describe("browse-first home", () => {
	it("shows the programme, the stores and the menu without any permission", async () => {
		renderCustomerApp();
		expect(
			await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" }),
		).toBeInTheDocument();
		const stores = within(screen.getByTestId("store-list"));
		expect(stores.getByText("Cửa hàng Mẫu 1")).toBeInTheDocument();
		expect(stores.getByText("Cửa hàng Mẫu 2")).toBeInTheDocument();
		const items = screen.getAllByTestId("menu-item");
		expect(items.length).toBe(4);
		for (const item of items) {
			expect(within(item).getByTestId("menu-at-counter")).toHaveTextContent(
				"Xem tại quầy",
			);
		}
		expect(looksLikePrice(document.body.textContent ?? "")).toBe(false);
		expect(
			screen.getByRole("button", { name: "Tham gia thành viên" }),
		).toBeInTheDocument();
	});

	it("opens a store's page from its deep link", async () => {
		renderCustomerApp({ search: "?store=mau-2&src=qr" });
		expect(
			await screen.findByRole("heading", { name: "Cửa hàng Mẫu 2" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("store-address")).toHaveTextContent(
			"34 Đường Số 2",
		);
		expect(screen.getAllByTestId("menu-item").length).toBe(3);
	});

	it("opens another store's page when the app comes back with a new link", async () => {
		renderCustomerApp();
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		act(() => emitMockOpenApp("/?store=mau-1&src=standee"));
		expect(
			await screen.findByRole("heading", { name: "Cửa hàng Mẫu 1" }),
		).toBeInTheDocument();
		expect(screen.getAllByTestId("menu-item").length).toBe(4);
	});

	it("says when a linked store no longer exists", async () => {
		renderCustomerApp({ search: "?store=mau-9" });
		expect(
			await screen.findByRole("heading", { name: "Không tìm thấy cửa hàng" }),
		).toBeInTheDocument();
	});

	it("shows the privacy and terms popups titled with the Mini App's name", async () => {
		renderCustomerApp();
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByRole("button", { name: "Chính sách bảo mật" }));
		const privacy = await screen.findByRole("dialog");
		expect(privacy).toHaveAccessibleName(
			"Chính sách bảo mật Mini App Thành viên Quán Mẫu Một",
		);
		expect(within(privacy).getByTestId("legal-entity")).toHaveTextContent(
			"Đơn vị chịu trách nhiệm: Hộ kinh doanh Quán Mẫu Một",
		);
		expect(within(privacy).getByTestId("legal-version")).toHaveTextContent(
			"Phiên bản privacy-demo-1",
		);
		fireEvent.click(within(privacy).getByRole("button", { name: "Đóng" }));
		fireEvent.click(screen.getByRole("button", { name: "Điều khoản sử dụng" }));
		expect(await screen.findByRole("dialog")).toHaveAccessibleName(
			"Điều khoản sử dụng Mini App Thành viên Quán Mẫu Một",
		);
	});

	it("keeps menu items to the stores that serve them", () => {
		const menu = [
			{
				id: "a",
				name: "A",
				description: null,
				category: null,
				storeCodes: null,
			},
			{
				id: "b",
				name: "B",
				description: null,
				category: null,
				storeCodes: ["mau-1"],
			},
		];
		expect(menuAt(menu, "mau-2").map((item) => item.id)).toEqual(["a"]);
		expect(menuAt(menu, "mau-1").map((item) => item.id)).toEqual(["a", "b"]);
		expect(menuAt(menu, null).map((item) => item.id)).toEqual(["a", "b"]);
	});

	it("recognises prices and leaves other numbers alone", () => {
		expect(looksLikePrice("Cà phê 25.000 ₫")).toBe(true);
		expect(looksLikePrice("25.000đ")).toBe(true);
		expect(looksLikePrice("45 000 VND")).toBe(true);
		expect(looksLikePrice("₫25000")).toBe(true);
		expect(looksLikePrice("3/10 dấu, +45 điểm, 2 đơn")).toBe(false);
		expect(looksLikePrice("Tổng tiền trên hóa đơn (đồng)")).toBe(false);
	});
});
