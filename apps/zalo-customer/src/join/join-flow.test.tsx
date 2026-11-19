import { mockSdkCalls } from "@fnb/zalo-mini/testing/mock-sdk";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { nativeStorage } from "zmp-sdk";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { JoinFlow } from "./join-flow";
import { initialJoinState, joinReducer, problemOf } from "./model";

afterEach(() => setSearch(""));

function joinBodies(fetches: readonly string[]): Record<string, unknown>[] {
	return fetches
		.map((body) => JSON.parse(body) as Record<string, unknown>)
		.filter((body) => body.join !== undefined)
		.map((body) => body.join as Record<string, unknown>);
}

function storedCustomerId(): unknown {
	const raw = nativeStorage.getItem("fnb.customer-session");
	return raw === "" ? undefined : JSON.parse(raw).customer.customerId;
}

async function openConsent() {
	await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
	fireEvent.click(screen.getByRole("button", { name: "Tham gia thành viên" }));
	expect(
		await screen.findByRole("heading", { name: "Tham gia thành viên" }),
	).toBeInTheDocument();
	expect(
		screen.getByText(/Số điện thoại Zalo, tên hiển thị/),
	).toBeInTheDocument();
	expect(mockSdkCalls().map((call) => call.api)).not.toContain(
		"getPhoneNumber",
	);
	fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
	expect(
		await screen.findByRole("heading", { name: "Đồng ý tham gia" }),
	).toBeInTheDocument();
}

describe("the join model", () => {
	it("starts every consent unticked and needs the loyalty consent to submit", () => {
		const consent = joinReducer(initialJoinState, { type: "continue", at: 1 });
		expect(consent).toMatchObject({
			step: "consent",
			loyalty: false,
			marketing: false,
		});
		expect(joinReducer(consent, { type: "submit" })).toBe(consent);
		const ticked = joinReducer(consent, { type: "loyalty", value: true });
		expect(joinReducer(ticked, { type: "submit" })).toMatchObject({
			busy: true,
		});
	});

	it("maps each refusal to what the person reads", () => {
		expect(problemOf("phone_token_used")).toBe("phone-expired");
		expect(problemOf("phone_token_refused")).toBe("phone-expired");
		expect(problemOf("policy_outdated")).toBe("policy-outdated");
		expect(problemOf("network")).toBe("network");
		expect(problemOf("refused")).toBe("unknown");
	});
});

describe("joining", () => {
	it("shows the purpose, then the consents unticked, then joins with the welcome stamps and the follow-OA step", async () => {
		const app = renderCustomerApp();
		await openConsent();
		const loyalty = screen.getByTestId("consent-loyalty");
		const marketing = screen.getByRole("switch");
		expect(loyalty).not.toBeChecked();
		expect(marketing).not.toBeChecked();
		expect(screen.getByTestId("policy-version")).toHaveTextContent(
			"privacy-demo-1",
		);
		const join = screen.getByRole("button", { name: "Tham gia" });
		expect(join).toBeDisabled();
		fireEvent.click(loyalty);
		expect(join).toBeEnabled();
		fireEvent.click(join);
		expect(
			await screen.findByRole("heading", { name: "Chào mừng bạn!" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("welcome-stamps")).toHaveTextContent(
			"Bạn nhận được 1 dấu chào mừng.",
		);
		expect(joinBodies(app.fetches())).toEqual([
			{
				phone_token: "mock-phone-token",
				loyalty_consent: true,
				marketing_consent: false,
				policy_version: "privacy-demo-1",
				screen_version: "join-1",
				store: null,
				shown_at: expect.any(String),
			},
		]);
		expect(app.world.marketing()).toBe(false);
		expect(storedCustomerId()).toBe("00000000-0000-4000-8000-0000000000c2");
		fireEvent.click(screen.getByRole("button", { name: "Quan tâm" }));
		expect(await screen.findByTestId("follow-done")).toBeInTheDocument();
		expect(
			mockSdkCalls().find((call) => call.api === "followOA")?.args,
		).toEqual({
			id: "mock-oa-1",
		});
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		expect(await screen.findByTestId("member-card")).toBeInTheDocument();
		expect(screen.getByTestId("stamp-count")).toHaveTextContent("1/10 dấu");
	});

	it("records the marketing consent only when its toggle was ticked, with the linked store", async () => {
		const app = renderCustomerApp({ search: "?store=mau-2&src=qr" });
		await screen.findByRole("heading", { name: "Cửa hàng Mẫu 2" });
		fireEvent.click(
			screen.getByRole("button", { name: "Tham gia thành viên" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		fireEvent.click(await screen.findByTestId("consent-loyalty"));
		fireEvent.click(screen.getByRole("switch"));
		fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
		await screen.findByRole("heading", { name: "Chào mừng bạn!" });
		expect(joinBodies(app.fetches())[0]).toMatchObject({
			marketing_consent: true,
			store: "mau-2",
		});
		expect(app.world.marketing()).toBe(true);
	});

	it("goes back to browsing and stores nothing when the purpose is declined", async () => {
		const app = renderCustomerApp();
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(
			screen.getByRole("button", { name: "Tham gia thành viên" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Để sau" }));
		expect(await screen.findByTestId("declined-notice")).toHaveTextContent(
			"Bạn chưa tham gia",
		);
		expect(joinBodies(app.fetches())).toEqual([]);
		expect(storedCustomerId()).toBeNull();
		expect(app.storedKeys()).toEqual(["fnb.customer-session"]);
		expect(screen.getAllByTestId("menu-item").length).toBe(4);
	});

	it("goes back to browsing and stores nothing when Zalo's phone permission is refused", async () => {
		const app = renderCustomerApp({ search: "?phone=refused" });
		await openConsent();
		fireEvent.click(screen.getByTestId("consent-loyalty"));
		fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
		expect(await screen.findByTestId("declined-notice")).toHaveTextContent(
			"Bạn chưa chia sẻ số điện thoại",
		);
		expect(mockSdkCalls().map((call) => call.api)).toContain("getPhoneNumber");
		expect(joinBodies(app.fetches())).toEqual([]);
		expect(storedCustomerId()).toBeNull();
		expect(app.world.joined()).toBe(false);
		fireEvent.click(screen.getByText("Thẻ thành viên"));
		expect(
			await screen.findByRole("heading", { name: "Bạn chưa là thành viên" }),
		).toBeInTheDocument();
	});

	it("never asks for the phone when the consent is cancelled", async () => {
		const app = renderCustomerApp();
		await openConsent();
		fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
		expect(await screen.findByTestId("declined-notice")).toHaveTextContent(
			"Không có thông tin nào được lưu",
		);
		expect(mockSdkCalls().map((call) => call.api)).not.toContain(
			"getPhoneNumber",
		);
		expect(joinBodies(app.fetches())).toEqual([]);
	});

	it("asks again when the phone confirmation has expired", async () => {
		renderCustomerApp({
			routes: [
				{
					path: "/",
					element: (
						<JoinFlow requestPhone={async () => ({ token: "spent-token" })} />
					),
				},
			],
		});
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		fireEvent.click(await screen.findByTestId("consent-loyalty"));
		fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
		expect(await screen.findByTestId("join-problem")).toHaveTextContent(
			"Xác nhận số điện thoại đã hết hạn",
		);
		expect(screen.getByRole("button", { name: "Tham gia" })).toBeEnabled();
		expect(storedCustomerId()).toBeNull();
	});

	it("leads a visitor who wants to claim a receipt through joining to the claim form", async () => {
		renderCustomerApp();
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(
			screen.getByRole("button", { name: "Nhận điểm từ hóa đơn" }),
		);
		expect(
			await screen.findByRole("heading", { name: "Nhận điểm từ hóa đơn" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		fireEvent.click(await screen.findByTestId("consent-loyalty"));
		fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
		fireEvent.click(await screen.findByRole("button", { name: "Bỏ qua" }));
		expect(await screen.findByTestId("claim-form")).toBeInTheDocument();
	});
});
