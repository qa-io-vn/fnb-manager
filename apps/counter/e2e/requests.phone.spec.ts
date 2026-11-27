import { randomUUID } from "node:crypto";
import { vietnamInstant } from "../src/manager/requests";
import {
	expect,
	expectNoHorizontalScroll,
	nav,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/requests (M01 on a manager's phone; native-till.md 16.8):
// - the unread count on the manager's tab, on Quản lý and in the inbox; opening a request records the first reader
//   and the unread mark goes (state transition new·unread → new·read);
// - "Đề xuất giờ khác" (state transitions new → proposed → confirmed): the time starts from the one asked and is
//   refused while it is that time (BVA on the client; the server checks again), a message is required, the reply to
//   copy names both times; the customer's agreement confirms the booking at the new time;
// - security: staff cannot read a request, propose a time or answer (manager-only functions).

const HOUR = 3_600_000;

function tomorrowDate(): string {
	return new Date(Date.now() + 24 * HOUR + 7 * HOUR).toISOString().slice(0, 10);
}

test.beforeEach(async ({ db, seeded }) => {
	await db`delete from public.store_requests where tenant_id = ${seeded.tenantId}`;
});

test("M01: the unread count, mark as read on open, then another time proposed and confirmed once the customer agrees", async ({
	page,
	seeded,
	db,
}) => {
	const day = tomorrowDate();
	const asked = vietnamInstant(day, "19:00") ?? "";
	const [submitted] = await db<
		{ r: { state: string; request: { id: string } } }[]
	>`
		select app.web_submit_request(${seeded.brandId}::uuid, ${`synthetic-client-${randomUUID()}`}, ${db.json(
			{
				request_id: randomUUID(),
				store: seeded.storeCodeA,
				kind: "booking",
				name: "Khách Đề Xuất",
				phone: "0900000004",
				party_size: 4,
				at: asked,
			} as never,
		)}::jsonb, now()) as r`;
	expect(submitted?.r.state).toBe("submitted");
	const id = submitted?.r.request.id ?? "";

	await signIn(page, seeded.people.manager);
	// the manager's tab carries the unread count (a number drawn, words for screen readers)
	await expect(nav(page, "manager")).toContainText("1");
	await nav(page, "manager").click();
	await expect(page.getByTestId("manager-requests-unread")).toHaveText(
		"1 chưa đọc",
	);
	await page.getByTestId("manager-requests").click();
	await expect(page.getByTestId("requests-unread")).toHaveText("1 chưa đọc");
	const row = page
		.getByTestId("request-row")
		.filter({ hasText: "Khách Đề Xuất" });
	await expect(row).toHaveAttribute("data-unread", "true");
	await expect(row.getByTestId("request-unread")).toHaveText("chưa đọc");
	await expectNoHorizontalScroll(page);

	await row.click();
	await expect(page.getByTestId("request-dialog")).toBeVisible();
	await expect
		.poll(async () => {
			const [read] = await db<{ read_by: string | null }[]>`
				select read_by::text from public.store_requests where id = ${id}`;
			return read?.read_by ?? null;
		})
		.toBe(seeded.people.manager.id);
	await page
		.getByTestId("request-dialog")
		.getByRole("button", { name: "Đóng" })
		.first()
		.click();
	await expect(page.getByTestId("requests-unread")).toHaveText("0 chưa đọc");
	await expect(row).toHaveAttribute("data-unread", "false");

	await row.click();
	await page.getByTestId("answer-proposed").click();
	await expect(page.getByTestId("propose-date")).toHaveValue(day);
	await expect(page.getByTestId("propose-clock")).toHaveValue("19:00");
	await expect(page.getByTestId("propose-hint")).toContainText(
		"Đây là giờ khách đã hỏi",
	);
	await expect(page.getByTestId("answer-submit")).toBeDisabled();
	await page.getByTestId("propose-clock").fill("19:30");
	await expect(page.getByTestId("propose-hint")).toContainText(
		"Từ 30 phút đến 60 ngày tới",
	);
	// a proposal needs a message for the customer
	await expect(page.getByTestId("answer-submit")).toBeDisabled();
	await page
		.getByTestId("answer-message")
		.fill("Giờ đó đã kín bàn, quán còn chỗ lúc 19:30.");
	await expectNoHorizontalScroll(page);
	await page.getByTestId("answer-submit").click();
	const reply = page.getByTestId("reply-text");
	await expect(reply).toContainText("Khách Đề Xuất");
	await expect(reply).toContainText("lúc 19:00");
	await expect(reply).toContainText("đề xuất 19:30");
	await expect(reply).toContainText("4 người");
	const [proposed] = await db<{ status: string; proposed_for: Date }[]>`
		select status, proposed_for from public.store_requests where id = ${id}`;
	expect(proposed?.status).toBe("proposed");
	expect(proposed?.proposed_for.toISOString()).toBe(
		vietnamInstant(day, "19:30"),
	);

	await page
		.getByTestId("request-dialog")
		.getByRole("button", { name: "Đóng" })
		.first()
		.click();
	const waiting = page
		.getByTestId("request-row")
		.filter({ hasText: "Khách Đề Xuất" });
	await expect(waiting).toHaveAttribute("data-status", "proposed");
	await expect(waiting).toContainText("Chờ khách trả lời");
	await waiting.click();
	await expect(page.getByTestId("request-awaiting-customer")).toBeVisible();
	await expect(page.getByTestId("request-proposed-for")).toContainText("19:30");
	await page.getByTestId("answer-confirmed").click();
	await expect(page.getByTestId("answer-confirmed")).toHaveText(
		"Khách đồng ý giờ mới",
	);
	await page.getByTestId("answer-submit").click();
	await expect(page.getByTestId("reply-text")).toContainText("19:30");
	const [confirmed] = await db<{ status: string; requested_for: Date }[]>`
		select status, requested_for from public.store_requests where id = ${id}`;
	expect(confirmed?.status).toBe("confirmed");
	expect(confirmed?.requested_for.toISOString()).toBe(
		vietnamInstant(day, "19:30"),
	);
});

test("security: staff cannot read a request, propose another time or answer it", async ({
	seeded,
	db,
}) => {
	const [submitted] = await db<{ r: { request: { id: string } } }[]>`
		select app.web_submit_request(${seeded.brandId}::uuid, ${`synthetic-client-${randomUUID()}`}, ${db.json(
			{
				request_id: randomUUID(),
				store: seeded.storeCodeA,
				kind: "booking",
				name: "Khách Bảo Mật",
				phone: "0900000005",
				party_size: 2,
				at: vietnamInstant(tomorrowDate(), "18:00"),
			} as never,
		)}::jsonb, now()) as r`;
	const id = submitted?.r.request.id ?? "";
	const staff = seeded.people.staff.id;
	expect(
		await refusalOf(
			db,
			staff,
			(tx) => tx`select public.manager_request_read(${id}::uuid)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			staff,
			(tx) =>
				tx`select public.manager_answer_request(${id}::uuid, 'proposed', 'Giờ khác', 1, ${vietnamInstant(tomorrowDate(), "18:30")}::timestamptz)`,
		),
	).toBe("42501");
	const [row] = await db<{ status: string; read_at: Date | null }[]>`
		select status, read_at from public.store_requests where id = ${id}`;
	expect(row).toEqual({ status: "new", read_at: null });
});
