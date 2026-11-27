import { randomUUID } from "node:crypto";
import {
	chooseZaloPerson,
	expect,
	nav,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/sign-in (ADR-066, acceptance criterion 5): through the built app, the real counter-session function and
// the mock Zalo. Use cases: a staff member and a manager sign in (each sees their sections); a person not on the list
// is blocked and recorded; a person with a manager's pairing code and the notice accepted gets in; a forged return
// (CSRF) is refused before anything is sent; a staff member cannot open a manager page; signing out ends the session.

test("a staff member signs in with Zalo and sees the four counter sections, not Quản lý", async ({
	page,
	seeded,
}) => {
	await signIn(page, seeded.people.staff);
	for (const section of ["orders", "tables", "menu", "shift"]) {
		await expect(nav(page, section)).toBeVisible();
	}
	await expect(nav(page, "manager")).toHaveCount(0);
	await expect(page.getByTestId("account")).toContainText(
		seeded.people.staff.name,
	);
});

test("a manager also sees Quản lý", async ({ page, seeded }) => {
	await signIn(page, seeded.people.manager);
	await expect(nav(page, "manager")).toBeVisible();
});

test("acceptance criterion 5: a person not on the list is blocked, gets no session and is recorded for M02", async ({
	page,
	seeded,
	db,
}) => {
	const stranger = {
		zaloId: `${seeded.slug}-stranger-${randomUUID().slice(0, 8)}`,
		name: "Người lạ thử",
	};
	await chooseZaloPerson(page, stranger);
	await page.goto("/");
	await page.getByTestId("sign-in-zalo").click();
	await expect(page.getByTestId("blocked")).toBeVisible();
	await expect(page.getByText("Tài khoản chưa được cấp quyền")).toBeVisible();
	await expect(page.getByTestId("account")).toHaveCount(0);
	const stored = await page.evaluate(() =>
		window.localStorage.getItem("fnb-counter-auth"),
	);
	expect(stored).toBeNull();
	const rows = await db<{ display_name: string; attempts: number }[]>`
		select display_name, attempts from app.blocked_signins where tenant_id = ${seeded.tenantId} and zalo_user_id = ${stranger.zaloId}`;
	expect(rows).toEqual([{ display_name: "Người lạ thử", attempts: 1 }]);
	// a wrong code is refused without saying why
	await page.getByTestId("pairing-code").fill("000000");
	await page.getByTestId("notice-accept").check();
	await page.getByTestId("pair-submit").click();
	await expect(page.getByTestId("blocked-reason")).toContainText(
		"Mã không đúng",
	);
	await expect(page.getByTestId("account")).toHaveCount(0);
});

test("a person the manager added pairs with the six-digit code, accepts the notice and gets in", async ({
	page,
	seeded,
	db,
}) => {
	const person = {
		zaloId: `${seeded.slug}-new-${randomUUID().slice(0, 8)}`,
		name: "Nhân viên mới",
	};
	const [roster] = await db<{ id: string }[]>`
		insert into public.staff_roster (tenant_id, display_name, role, store_ids)
		values (${seeded.tenantId}, 'Nhân viên mới', 'staff', array[${seeded.storeA}::uuid]) returning id`;
	const code = "482913";
	await db`insert into app.staff_pairing_codes (tenant_id, roster_id, code_sha256, issued_by, issued_at, expires_at)
		values (${seeded.tenantId}, ${roster?.id ?? ""}, app.staff_pairing_code_hash(${seeded.tenantId}::uuid, ${code}), ${seeded.people.manager.id}, now(), now() + interval '10 minutes')`;
	await chooseZaloPerson(page, person);
	await page.goto("/");
	await page.getByTestId("sign-in-zalo").click();
	await expect(page.getByTestId("blocked")).toBeVisible();
	await page.getByTestId("pairing-code").fill(code);
	await expect(page.getByTestId("pair-submit")).toBeDisabled();
	await page.getByTestId("notice-accept").check();
	await page.getByTestId("pair-submit").click();
	await expect(page.getByTestId("account")).toContainText("Nhân viên mới");
	const [member] = await db<{ role: string }[]>`
		select m.role::text as role from public.tenant_members m join public.staff_roster r on r.user_id = m.user_id
		where r.id = ${roster?.id ?? ""}`;
	expect(member?.role).toBe("staff");
});

test("CSRF: a return to the app that this tab did not start is refused and sends nothing", async ({
	page,
}) => {
	const calls: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST") calls.push(request.url());
	});
	await page.goto(
		"/?code=forged-code&state=forged-state-0000000000000000000000000000000000000",
	);
	await expect(page.getByTestId("sign-in-error")).toContainText("không khớp");
	await expect(page.getByTestId("account")).toHaveCount(0);
	expect(calls).toEqual([]);
	await expect(page).toHaveURL(/\/$|\/#\/?$/);
});

test("security: a staff member cannot open a manager page", async ({
	page,
	seeded,
}) => {
	await signIn(page, seeded.people.staff);
	await page.goto("/#/quan-ly");
	await expect(page.getByTestId("managers-only")).toBeVisible();
});

test("signing out ends the session on this device", async ({
	page,
	seeded,
}) => {
	await signIn(page, seeded.people.staff2);
	await page.getByTestId("account").click();
	await page.getByTestId("sign-out").click();
	await expect(page.getByTestId("sign-in-zalo")).toBeVisible();
	await page.reload();
	await expect(page.getByTestId("sign-in-zalo")).toBeVisible();
});
