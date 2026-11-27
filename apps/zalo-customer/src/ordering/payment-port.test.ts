import {
	type CheckoutParams,
	type TransferQr,
	vietQrPayload,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it, vi } from "vitest";
import {
	hintOfResultCode,
	sdkCheckoutPort,
	standInCheckoutPort,
	ZALO_TOO_OLD,
	type ZaloCheckoutSdk,
} from "./payment-port";

// Test design (ISTQB) for the seam between the payment step and Zalo's Checkout SDK:
// - the real port over a fake SDK: createOrder gets the server's parameters exactly (nothing added, nothing priced),
//   an error -1404 (an old Zalo) means no SDK here, another error a failed opening, a malformed Zalo order id a failed
//   one; the end of the sheet is heard even when it comes before the screen asks; checkTransaction's codes 1, 0, -1,
//   -2 and others (equivalence partitions) and a failing check; the QR popup's pay, close and an error (-1404 → the
//   app shows the QR itself);
// - the browser's stand-in: the sheet opens with the amount, "Thanh toán thử" asks the gateway and claims success,
//   `claimOnly` claims without the gateway (the case where only the server can say paid), "Hủy" leaves, a choice made
//   before the screen asks is kept, and leaving the screen closes the sheet.

const PARAMS: CheckoutParams = {
	amount: 58000,
	desc: "Cửa hàng Mẫu 1 - Đơn trực tuyến",
	item: [{ id: "item-1", amount: 58000 }],
	extradata: '{"o":"order","v":1}',
	method: null,
	mac: "ab".repeat(32),
};

const QR: TransferQr = {
	payload: vietQrPayload({
		bankBin: "970400",
		accountNumber: "0123456789",
		amount: 58000,
		reference: "FNB12345678",
	}),
	bankBin: "970400",
	bankName: "Ngân hàng Mẫu",
	accountNumber: "0123456789",
	accountName: "CUA HANG MAU",
	amount: 58000,
	reference: "FNB12345678",
	popupMethod: "BANK_SANDBOX",
};

function fakeSdk(overrides: Partial<ZaloCheckoutSdk> = {}) {
	const listeners = new Set<() => void>();
	const sdk: ZaloCheckoutSdk = {
		createOrder: vi.fn(async () => ({ orderId: "zp-123" })),
		checkTransaction: vi.fn(async () => ({ resultCode: 1 })),
		openCheckoutPopup: vi.fn(async () => ({
			status: "pay",
			orderId: "zp-qr-1",
		})),
		onPaymentEnd(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		...overrides,
	};
	return {
		sdk,
		end: () => {
			for (const listener of [...listeners]) listener();
		},
		listening: () => listeners.size,
	};
}

describe("checkTransaction's result codes", () => {
	it.each([
		[1, "paid"],
		[0, "processing"],
		[-1, "failed"],
		[-2, "left"],
		[2, "unknown"],
		["1", "unknown"],
		[undefined, "unknown"],
	])("%s reads %s", (code, hint) => {
		expect(hintOfResultCode(code)).toBe(hint);
	});
});

describe("the real port over Zalo's SDK", () => {
	it("hands createOrder the server's parameters exactly and answers Zalo's order id", async () => {
		const { sdk } = fakeSdk();
		const port = sdkCheckoutPort(async () => sdk);
		expect(await port.openWallet("order-1", PARAMS)).toEqual({
			kind: "opened",
			platformOrderId: "zp-123",
		});
		expect(sdk.createOrder).toHaveBeenCalledWith(PARAMS);
	});

	it("waits for the end of the sheet, even one heard before the screen asks, then reads the result", async () => {
		const { sdk, end, listening } = fakeSdk({
			checkTransaction: vi.fn(async () => ({ resultCode: -2 })),
		});
		const port = sdkCheckoutPort(async () => sdk);
		await port.openWallet("order-1", PARAMS);
		expect(listening()).toBe(1);
		end();
		expect(
			await port.walletResult("zp-123", new AbortController().signal),
		).toBe("left");
		expect(sdk.checkTransaction).toHaveBeenCalledWith("zp-123");
		expect(listening()).toBe(0);
	});

	it("answers unknown when the screen leaves before the sheet ends, or the check fails", async () => {
		const { sdk } = fakeSdk({
			checkTransaction: vi.fn(async () => {
				throw new Error("no network");
			}),
		});
		const port = sdkCheckoutPort(async () => sdk);
		await port.openWallet("order-1", PARAMS);
		const leaving = new AbortController();
		const pending = port.walletResult("zp-123", leaving.signal);
		leaving.abort();
		expect(await pending).toBe("unknown");
		expect(
			await port.walletResult("zp-unknown", new AbortController().signal),
		).toBe("unknown");
	});

	it.each([
		[{ code: ZALO_TOO_OLD }, { kind: "unavailable" }],
		[{ code: -1001 }, { kind: "failed", code: -1001 }],
		[new Error("boom"), { kind: "failed", code: null }],
	])("reads a createOrder error %j", async (error, expected) => {
		const { sdk, listening } = fakeSdk({
			createOrder: vi.fn(async () => {
				throw error;
			}),
		});
		expect(
			await sdkCheckoutPort(async () => sdk).openWallet("o", PARAMS),
		).toEqual(expected);
		expect(listening()).toBe(0);
	});

	it("refuses a Zalo order id the link would not take, and a missing SDK", async () => {
		const { sdk } = fakeSdk({
			createOrder: vi.fn(async () => ({ orderId: "a b/c" })),
		});
		expect(
			await sdkCheckoutPort(async () => sdk).openWallet("o", PARAMS),
		).toEqual({
			kind: "failed",
			code: null,
		});
		expect(
			await sdkCheckoutPort(async () => {
				throw new Error("not inside Zalo");
			}).openWallet("o", PARAMS),
		).toEqual({ kind: "unavailable" });
	});

	it("opens the QR popup with the payload, the amount and the method, and reads pay, close and an error", async () => {
		const { sdk } = fakeSdk();
		const port = sdkCheckoutPort(async () => sdk);
		expect(await port.openTransfer("o", QR)).toEqual({
			kind: "paid",
			platformOrderId: "zp-qr-1",
		});
		expect(sdk.openCheckoutPopup).toHaveBeenCalledWith({
			amount: 58000,
			orderDescription: "FNB12345678",
			qrContent: QR.payload,
			method: "BANK_SANDBOX",
		});
		const closed = fakeSdk({
			openCheckoutPopup: vi.fn(async () => ({ status: "close" })),
		});
		expect(
			await sdkCheckoutPort(async () => closed.sdk).openTransfer("o", QR),
		).toEqual({
			kind: "closed",
			platformOrderId: null,
		});
		const old = fakeSdk({
			openCheckoutPopup: vi.fn(async () => {
				throw { code: ZALO_TOO_OLD };
			}),
		});
		expect(
			await sdkCheckoutPort(async () => old.sdk).openTransfer("o", QR),
		).toEqual({
			kind: "unavailable",
		});
	});
});

describe("the browser's stand-in", () => {
	it("opens a sheet; Thanh toán thử asks the gateway, then claims success", async () => {
		const gateway = vi.fn();
		const port = standInCheckoutPort({
			gateway,
			claimOnly: false,
			transfer: "unavailable",
		});
		const seen: unknown[] = [];
		port.subscribe(() => seen.push(port.sheet()));
		const open = await port.openWallet("order-1", PARAMS);
		expect(open).toEqual({ kind: "opened", platformOrderId: "standin-1" });
		expect(port.sheet()).toMatchObject({ orderId: "order-1", amount: 58000 });
		const result = port.walletResult("standin-1", new AbortController().signal);
		port.choose("pay");
		expect(await result).toBe("paid");
		expect(gateway).toHaveBeenCalledWith("order-1", "paid");
		expect(port.sheet()).toBeNull();
		expect(seen.at(-1)).toBeNull();
		expect(port.calls()).toEqual([{ api: "createOrder", params: PARAMS }]);
	});

	it("with claimOnly tells the app it was paid while the gateway hears nothing", async () => {
		const gateway = vi.fn();
		const port = standInCheckoutPort({
			gateway,
			claimOnly: true,
			transfer: "unavailable",
		});
		await port.openWallet("order-1", PARAMS);
		port.choose("pay");
		expect(
			await port.walletResult("standin-1", new AbortController().signal),
		).toBe("paid");
		expect(gateway).not.toHaveBeenCalled();
	});

	it("Hủy leaves, and a sheet closes when the screen goes", async () => {
		const port = standInCheckoutPort({
			gateway: null,
			claimOnly: false,
			transfer: "unavailable",
		});
		await port.openWallet("order-1", PARAMS);
		const result = port.walletResult("standin-1", new AbortController().signal);
		port.choose("cancel");
		expect(await result).toBe("left");
		await port.openWallet("order-1", PARAMS);
		const leaving = new AbortController();
		const pending = port.walletResult("standin-2", leaving.signal);
		leaving.abort();
		expect(await pending).toBe("unknown");
		expect(port.sheet()).toBeNull();
		port.choose("pay");
	});

	it("answers the QR popup as configured: none outside Zalo, or pay, or close", async () => {
		const outside = standInCheckoutPort({
			gateway: null,
			claimOnly: false,
			transfer: "unavailable",
		});
		expect(await outside.openTransfer("o", QR)).toEqual({
			kind: "unavailable",
		});
		const paid = standInCheckoutPort({
			gateway: null,
			claimOnly: false,
			transfer: "pay",
		});
		expect(await paid.openTransfer("o", QR)).toEqual({
			kind: "paid",
			platformOrderId: null,
		});
		const closed = standInCheckoutPort({
			gateway: null,
			claimOnly: false,
			transfer: "close",
		});
		expect(await closed.openTransfer("o", QR)).toEqual({
			kind: "closed",
			platformOrderId: null,
		});
	});
});
