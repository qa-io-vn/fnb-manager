import { expect, signIn, test } from "./support/fixtures";

// counter:e2e/vietqr (Q01 "Thu tiền", the VietQR tab) on the real stack: a walk-in order, "Thu tiền" → VietQR, the QR
// from the real checkout-order (`for: "counter"`), a bank notification of the exact amount through bank-webhook with
// the seedable mock bank provider, the dialog turning to "Đã nhận tiền" within a poll and the order paid in the queue;
// another amount leaves it waiting (a manager's queue); closing the dialog leaves the attempt to expire.
//
// Skipped until the server side exists locally: checkout-order and bank-webhook as Edge Functions with a seedable mock
// bank provider (a store whose ordering state lists vietqr, the bank's notification sent by the test). The component
// suite (src/orders/vietqr.test.tsx) covers the tab against a stubbed checkout-order meanwhile. To run it then:
// serve the two functions like counter-session in e2e/support/global-setup.ts (VITE_CHECKOUT_ORDER_URL names
// checkout-order's address; the build's CSP allows its origin), seed the provider, and remove the skip.

test.skip(
	true,
	"waits for checkout-order and bank-webhook with a seedable mock bank provider on the local stack",
);

test("VietQR at the counter: the code, the exact transfer, Đã nhận tiền and the order paid", async ({
	page,
	seeded,
}) => {
	await signIn(page, seeded.people.staff);
	await page.getByTestId("new-counter-order").click();
	await page
		.locator('[data-testid="menu-tile"][data-item="Bánh chuối"]')
		.click();
	await page.getByTestId("create-pay").click();
	await page.getByTestId("pay-vietqr").click();
	await expect(page.getByTestId("vietqr-code")).toHaveAttribute(
		"data-payload",
		/^000201/,
	);
	await expect(page.getByTestId("vietqr-waiting")).toHaveText(
		"Chờ khách chuyển khoản…",
	);
	// the mock bank reports the exact amount with the reference (to wire: the seeded provider's notification)
	await expect(page.getByTestId("vietqr-paid")).toBeVisible({
		timeout: 10_000,
	});
	await expect(page.getByTestId("create-done")).toBeVisible();
});
