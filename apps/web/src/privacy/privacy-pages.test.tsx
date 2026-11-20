import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { CustomerSource } from "../loyalty/source";
import { PrivacyLookupPage } from "../pages/loyalty/privacy-lookup-page";
import { PrivacyRequestsPage } from "../pages/loyalty/privacy-requests-page";
import { createDemoSettingsSource } from "../settings/demo-settings-source";
import type {
	Membership,
	SettingsSource,
	TenantRole,
} from "../settings/source";
import { SettingsWriteError } from "../settings/source";
import {
	consent,
	createFakePrivacy,
	type FakePrivacy,
	type FakePrivacyOptions,
	FULL_PHONE,
	LOCAL_PHONE,
	request,
	subject,
	TENANT_ID,
} from "./testing";

const current = vi.hoisted(() => ({ state: { status: "loading" } as unknown }));
const downloads = vi.hoisted(() => ({
	files: [] as { name: string; content: string }[],
}));

vi.mock("../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: {
			id: "33333333-3333-4333-8333-333333333333",
			name: "Quán mẫu",
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
			countryCode: "VN",
		},
		stores: [],
		selectedStores: [],
		allStoresSelected: true,
		selectStores: () => undefined,
	}),
}));

vi.mock("../settings/settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("../lib/csv", async (importOriginal) => ({
	...(await importOriginal<typeof import("../lib/csv")>()),
	downloadTextFile: (name: string, content: string) => {
		downloads.files.push({ name, content });
	},
}));

function LocationProbe() {
	const location = useLocation();
	return <p data-testid="probe">{`${location.pathname}${location.search}`}</p>;
}

interface Rendered {
	readonly privacy: FakePrivacy;
	readonly consoleLines: string[];
}

function renderPage(
	page: ReactElement,
	path: string,
	{
		role = "owner" as TenantRole,
		storeIds = null as readonly string[] | null,
		privacy = createFakePrivacy(),
	}: {
		role?: TenantRole;
		storeIds?: readonly string[] | null;
		privacy?: FakePrivacy;
	} = {},
): Rendered {
	const membership: Membership = { role, storeIds };
	const source: SettingsSource = {
		...createDemoSettingsSource(new DemoSettingsStore()),
		membership: async () => membership,
	};
	const customers = { kind: "supabase", privacy } as unknown as CustomerSource;
	current.state = { status: "ready", source, customers };
	const consoleLines: string[] = [];
	for (const method of ["log", "info", "warn", "error"] as const) {
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			consoleLines.push(args.map(String).join(" "));
		});
	}
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<MemoryRouter initialEntries={[path]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={client}>
					<Routes>
						<Route path={path} element={page} />
					</Routes>
					<LocationProbe />
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>,
	);
	return { privacy, consoleLines };
}

beforeEach(() => {
	Element.prototype.scrollIntoView = () => undefined;
	downloads.files = [];
});

afterEach(() => {
	current.state = { status: "loading" };
	vi.restoreAllMocks();
});

function expectNoFullPhone(rendered: Rendered) {
	const text = `${document.body.textContent ?? ""} ${document.title} ${screen.getByTestId("probe").textContent}`;
	for (const phone of [FULL_PHONE, LOCAL_PHONE, FULL_PHONE.slice(3)]) {
		expect(text).not.toContain(phone);
		expect(rendered.consoleLines.join("\n")).not.toContain(phone);
	}
}

const LOOKUP_PATH = "/khach-hang/tra-cuu-du-lieu";
const REQUESTS_PATH = "/khach-hang/yeu-cau-du-lieu";

async function lookUp(
	user: ReturnType<typeof userEvent.setup>,
	phone = LOCAL_PHONE,
) {
	await user.type(await screen.findByTestId("privacy-lookup-input"), phone);
	await user.click(screen.getByTestId("privacy-lookup-submit"));
}

describe("access to the privacy pages (decision table by role)", () => {
	const cases: ReadonlyArray<[TenantRole, readonly string[] | null, boolean]> =
		[
			["owner", null, true],
			["manager", null, true],
			["owner", ["s1"], false],
			["manager", ["s1"], false],
			["viewer", null, false],
			["staff", null, false],
			["publisher", null, false],
		];
	for (const [role, storeIds, allowed] of cases) {
		const label = `${role}${storeIds === null ? "" : " of one store"}`;
		it(`${allowed ? "opens" : "refuses"} both pages for ${label}`, async () => {
			for (const [page, path, marker] of [
				[<PrivacyLookupPage key="l" />, LOOKUP_PATH, "privacy-lookup"],
				[<PrivacyRequestsPage key="r" />, REQUESTS_PATH, "privacy-queue"],
			] as const) {
				const privacy = createFakePrivacy({ requests: [request()] });
				const view = renderPage(page, path, { role, storeIds, privacy });
				if (allowed) {
					expect(await screen.findByTestId(marker)).toBeVisible();
				} else if (role === "viewer") {
					await screen.findByTestId("loyalty-page");
					expect(await screen.findByTestId("privacy-no-access")).toBeVisible();
				} else {
					await screen.findByTestId("loyalty-page");
					await waitFor(() =>
						expect(
							screen.queryByTestId("privacy-no-access") ??
								screen.queryByTestId("loyalty-no-access"),
						).not.toBeNull(),
					);
				}
				if (!allowed) {
					expect(screen.queryByTestId(marker)).toBeNull();
					expect(view.privacy.calls).toEqual([]);
				}
				document.body.innerHTML = "";
			}
		});
	}

	it("shows the privacy tabs to an owner", async () => {
		renderPage(<PrivacyLookupPage />, LOOKUP_PATH);
		const tabs = await screen.findByTestId("loyalty-tabs");
		expect(await within(tabs).findByText("Tra cứu dữ liệu")).toBeVisible();
		expect(within(tabs).getByText("Yêu cầu về dữ liệu")).toBeVisible();
	});

	it("hides the privacy tabs from a viewer", async () => {
		renderPage(<PrivacyLookupPage />, LOOKUP_PATH, { role: "viewer" });
		const tabs = await screen.findByTestId("loyalty-tabs");
		await screen.findByTestId("privacy-no-access");
		expect(within(tabs).queryByText("Tra cứu dữ liệu")).toBeNull();
		expect(within(tabs).queryByText("Yêu cầu về dữ liệu")).toBeNull();
	});
});

describe("the lookup page", () => {
	it("shows the customer masked with counts, consents per purpose and no phone anywhere", async () => {
		const user = userEvent.setup();
		const view = renderPage(<PrivacyLookupPage />, LOOKUP_PATH, {
			privacy: createFakePrivacy({ subjects: [subject()] }),
		});
		await lookUp(user);
		expect(
			await screen.findByTestId("privacy-subject-phone"),
		).toHaveTextContent("•••• ••• 101");
		expect(screen.getByTestId("privacy-subject-counts")).toHaveTextContent(
			"1 thành viên · 4 dòng sổ · 5 tem · 120 điểm · 2 tin nhắn · 1 yêu cầu đang mở",
		);
		expect(screen.getAllByTestId("privacy-consent")).toHaveLength(2);
		expect(view.privacy.lookupSubjects).toHaveBeenCalledWith(LOCAL_PHONE);
		expectNoFullPhone(view);
	});

	it("says so when nobody has the phone", async () => {
		const user = userEvent.setup();
		renderPage(<PrivacyLookupPage />, LOOKUP_PATH);
		await lookUp(user, "0900016999");
		expect(await screen.findByTestId("privacy-lookup-none")).toBeVisible();
	});

	it("refuses an unreadable phone without calling the database (equivalence)", async () => {
		const user = userEvent.setup();
		const view = renderPage(<PrivacyLookupPage />, LOOKUP_PATH);
		for (const bad of ["abc", "12", "'; drop table customers; --"]) {
			await user.clear(await screen.findByTestId("privacy-lookup-input"));
			await user.type(screen.getByTestId("privacy-lookup-input"), bad);
			await user.click(screen.getByTestId("privacy-lookup-submit"));
			expect(
				await screen.findByText("Không đọc được số điện thoại này."),
			).toBeVisible();
		}
		expect(view.privacy.lookupSubjects).not.toHaveBeenCalled();
	});

	it("shows a failure message and keeps the phone out of it", async () => {
		const user = userEvent.setup();
		const view = renderPage(<PrivacyLookupPage />, LOOKUP_PATH, {
			privacy: createFakePrivacy({
				subjects: [subject()],
				failWith: new SettingsWriteError("network"),
			}),
		});
		await lookUp(user);
		expect(
			await screen.findByText("Không tra cứu được. Thử lại sau."),
		).toBeVisible();
		expectNoFullPhone(view);
	});

	it("withdraws marketing consent after a confirmation, and offers no button for a withdrawn or staff consent (state transition)", async () => {
		const user = userEvent.setup();
		const privacy = createFakePrivacy({
			subjects: [
				subject({
					consents: [
						consent({ id: "k-loyalty", purpose: "loyalty" }),
						consent({
							id: "k-old",
							purpose: "marketing",
							active: false,
							revokedAt: "2026-11-05T02:00:00Z",
						}),
						consent({ id: "k-marketing", purpose: "marketing" }),
						consent({ id: "k-staff", purpose: "staff_ops" }),
					],
				}),
			],
		});
		const view = renderPage(<PrivacyLookupPage />, LOOKUP_PATH, { privacy });
		await lookUp(user);
		await screen.findByTestId("privacy-subject");
		expect(screen.getAllByTestId("privacy-revoke")).toHaveLength(2);
		const marketing = screen
			.getAllByTestId("privacy-consent")
			.find(
				(row) =>
					row.dataset.purpose === "marketing" && row.dataset.active === "true",
			) as HTMLElement;
		await user.click(within(marketing).getByTestId("privacy-revoke"));
		expect(
			within(marketing).getByTestId("privacy-revoke-confirm"),
		).toBeVisible();
		expect(privacy.revokeConsent).not.toHaveBeenCalled();
		await user.click(within(marketing).getByTestId("privacy-revoke-yes"));
		await waitFor(() =>
			expect(privacy.revokeConsent).toHaveBeenCalledWith("k-marketing"),
		);
		expect(await screen.findByTestId("privacy-revoke-done")).toHaveTextContent(
			"Đã rút đồng ý Tin khuyến mại.",
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("privacy-revoke")).toHaveLength(1),
		);
		expectNoFullPhone(view);
	});

	it("keeps the consent when the confirmation is cancelled", async () => {
		const user = userEvent.setup();
		const privacy = createFakePrivacy({ subjects: [subject()] });
		renderPage(<PrivacyLookupPage />, LOOKUP_PATH, { privacy });
		await lookUp(user);
		const [first] = await screen.findAllByTestId("privacy-revoke");
		await user.click(first as HTMLElement);
		await user.click(screen.getByText("Quay lại"));
		expect(privacy.revokeConsent).not.toHaveBeenCalled();
		expect(screen.queryByTestId("privacy-revoke-confirm")).toBeNull();
	});

	it("shows a refusal when the database refuses the withdrawal", async () => {
		const user = userEvent.setup();
		const privacy = createFakePrivacy({ subjects: [subject()] });
		(privacy.revokeConsent as ReturnType<typeof vi.fn>).mockRejectedValue(
			new SettingsWriteError("forbidden"),
		);
		renderPage(<PrivacyLookupPage />, LOOKUP_PATH, { privacy });
		await lookUp(user);
		const [first] = await screen.findAllByTestId("privacy-revoke");
		await user.click(first as HTMLElement);
		await user.click(screen.getByTestId("privacy-revoke-yes"));
		expect(await screen.findByTestId("privacy-revoke-error")).toHaveTextContent(
			"Bạn không có quyền thực hiện thao tác này.",
		);
	});

	it("records a request linked to the customer", async () => {
		const user = userEvent.setup();
		const privacy = createFakePrivacy({ subjects: [subject()] });
		renderPage(<PrivacyLookupPage />, LOOKUP_PATH, { privacy });
		await lookUp(user);
		await user.selectOptions(
			await screen.findByTestId("privacy-form-type"),
			"export",
		);
		await user.type(
			screen.getByTestId("privacy-form-contact"),
			"khach@example.com",
		);
		await user.click(screen.getByTestId("privacy-form-submit"));
		await waitFor(() =>
			expect(privacy.recordRequest).toHaveBeenCalledWith(TENANT_ID, {
				requestType: "export",
				subjectId: subject().customerId,
				contact: "khach@example.com",
				usesProcessor: false,
				notes: null,
			}),
		);
		expect(await screen.findByTestId("privacy-record-done")).toBeVisible();
	});

	it("never writes the phone into the address", async () => {
		const user = userEvent.setup();
		const view = renderPage(<PrivacyLookupPage />, LOOKUP_PATH, {
			privacy: createFakePrivacy({ subjects: [subject()] }),
		});
		await lookUp(user);
		await screen.findByTestId("privacy-subject");
		expect(screen.getByTestId("probe")).toHaveTextContent(LOOKUP_PATH);
		expectNoFullPhone(view);
	});
});

const NOW = new Date("2026-11-20T03:00:00Z");
const DAY = 86_400_000;
const due = (days: number) =>
	new Date(NOW.getTime() + days * DAY).toISOString();

describe("the requests page", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function queue(): FakePrivacyOptions {
		return {
			requests: [
				request({
					id: "r-overdue",
					requestType: "access",
					firstResponseDueAt: due(-5),
					completionDueAt: due(-1),
				}),
				request({
					id: "r-soon",
					requestType: "export",
					status: "in_progress",
					respondedAt: due(-10),
					firstResponseDueAt: due(-9),
					completionDueAt: due(2),
				}),
				request({
					id: "r-track",
					requestType: "correction",
					firstResponseDueAt: due(5),
					completionDueAt: due(15),
				}),
				request({
					id: "r-delete",
					requestType: "deletion",
					firstResponseDueAt: due(5),
					completionDueAt: due(15),
				}),
				request({
					id: "r-done",
					requestType: "access",
					status: "completed",
					respondedAt: due(-20),
					completedAt: due(-15),
					firstResponseDueAt: due(-25),
					completionDueAt: due(-5),
				}),
				request({
					id: "r-unlinked",
					requestType: "objection",
					subjectId: null,
					firstResponseDueAt: due(5),
					completionDueAt: due(15),
				}),
			],
			due: [
				{
					requestId: "r-overdue",
					requestType: "access",
					firstResponseState: "overdue",
					completionState: "overdue",
				},
				{
					requestId: "r-soon",
					requestType: "export",
					firstResponseState: "done",
					completionState: "due_soon",
				},
			],
		};
	}

	const row = (id: string) =>
		screen
			.getAllByTestId("privacy-request")
			.find((item) => item.dataset.request === id) as HTMLElement;

	it("colours each deadline by its state and says how many requests are overdue or due soon", async () => {
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, {
			privacy: createFakePrivacy(queue()),
		});
		await screen.findByTestId("privacy-requests");
		const state = (id: string, which: "response" | "completion") =>
			within(row(id)).getByTestId(`privacy-deadline-${which}`).dataset.state;
		expect(state("r-overdue", "response")).toBe("overdue");
		expect(state("r-overdue", "completion")).toBe("overdue");
		expect(state("r-soon", "response")).toBe("done");
		expect(state("r-soon", "completion")).toBe("due_soon");
		expect(state("r-track", "response")).toBe("on_track");
		expect(state("r-track", "completion")).toBe("on_track");
		expect(state("r-done", "completion")).toBe("done");
		expect(
			within(row("r-overdue")).getByTestId("privacy-deadline-completion"),
		).toHaveTextContent("quá hạn 1 ngày");
		expect(
			within(row("r-soon")).getByTestId("privacy-deadline-completion"),
		).toHaveTextContent("còn 2 ngày");
		const banner = await screen.findByTestId("privacy-due-banner");
		expect(banner).toHaveTextContent(
			"1 yêu cầu quá hạn, 1 yêu cầu sắp đến hạn trong 3 ngày.",
		);
		expect(banner.dataset.overdue).toBe("1");
		expect(banner.dataset.soon).toBe("1");
	});

	it("says nothing is due when the rule finds nothing", async () => {
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, {
			privacy: createFakePrivacy({ requests: [request()], due: [] }),
		});
		expect(await screen.findByTestId("privacy-due-banner")).toHaveTextContent(
			"Không có yêu cầu nào quá hạn hoặc sắp đến hạn trong 3 ngày.",
		);
	});

	it("shows an empty queue", async () => {
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH);
		expect(await screen.findByTestId("privacy-queue-none")).toBeVisible();
	});

	it("shows a load failure", async () => {
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, {
			privacy: createFakePrivacy({
				failWith: new SettingsWriteError("network"),
			}),
		});
		expect(
			await screen.findByText("Không tải được hàng đợi. Thử lại sau."),
		).toBeVisible();
	});

	it("offers actions only on open requests and only those the type allows (decision table)", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, {
			privacy: createFakePrivacy(queue()),
		});
		await screen.findByTestId("privacy-requests");
		expect(
			within(row("r-done")).queryByTestId("privacy-request-toggle"),
		).toBeNull();
		for (const [id, expected] of [
			["r-overdue", { export: true, correct: false, del: false }],
			["r-track", { export: true, correct: true, del: false }],
			["r-delete", { export: true, correct: false, del: true }],
			["r-unlinked", { export: false, correct: false, del: false }],
		] as const) {
			await user.click(within(row(id)).getByTestId("privacy-request-toggle"));
			const scope = within(row(id));
			expect(scope.queryByTestId("privacy-export") !== null).toBe(
				expected.export,
			);
			expect(scope.queryByTestId("privacy-correct") !== null).toBe(
				expected.correct,
			);
			expect(scope.queryByTestId("privacy-delete") !== null).toBe(expected.del);
			expect(scope.getByTestId("privacy-close")).toBeVisible();
		}
	});

	it("exports the data as a private file with no phone in its name", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		const view = renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, {
			privacy,
		});
		await screen.findByTestId("privacy-requests");
		await user.click(
			within(row("r-overdue")).getByTestId("privacy-request-toggle"),
		);
		await user.click(within(row("r-overdue")).getByTestId("privacy-export"));
		await waitFor(() => expect(downloads.files).toHaveLength(1));
		expect(downloads.files[0]?.name).toMatch(
			/^yeu-cau-[0-9a-z-]{1,8}-du-lieu\.json$/,
		);
		expect(downloads.files[0]?.name).not.toContain("84");
		expect(await screen.findByTestId("privacy-export-done")).toHaveTextContent(
			"Đã tải tệp dữ liệu riêng tư gồm 8 dòng.",
		);
		expectNoFullPhone(view);
	});

	it("corrects the name, refusing an empty or over-long name before calling the database", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, { privacy });
		await screen.findByTestId("privacy-requests");
		await user.click(
			within(row("r-track")).getByTestId("privacy-request-toggle"),
		);
		await user.click(
			within(row("r-track")).getByTestId("privacy-correct-save"),
		);
		expect(screen.getByText("Nhập tên đã sửa.")).toBeVisible();
		await user.click(
			within(row("r-track")).getByTestId("privacy-correct-input"),
		);
		await user.paste("a".repeat(121));
		await user.click(
			within(row("r-track")).getByTestId("privacy-correct-save"),
		);
		expect(screen.getByText("Tên tối đa 120 ký tự.")).toBeVisible();
		expect(privacy.correctName).not.toHaveBeenCalled();
		await user.clear(
			within(row("r-track")).getByTestId("privacy-correct-input"),
		);
		await user.type(
			within(row("r-track")).getByTestId("privacy-correct-input"),
			"Tên mới",
		);
		await user.click(
			within(row("r-track")).getByTestId("privacy-correct-save"),
		);
		await waitFor(() =>
			expect(privacy.correctName).toHaveBeenCalledWith("r-track", "Tên mới"),
		);
		expect(await screen.findByTestId("privacy-correct-done")).toHaveTextContent(
			"Đã sửa tên",
		);
	});

	it("deletes only after a confirmation that lists the counts, and shows the counts removed", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, { privacy });
		await screen.findByTestId("privacy-requests");
		await user.click(
			within(row("r-delete")).getByTestId("privacy-request-toggle"),
		);
		await user.click(
			within(row("r-delete")).getByTestId("privacy-delete-start"),
		);
		const confirm = await screen.findByTestId("privacy-delete-confirm");
		expect(privacy.deleteSubject).not.toHaveBeenCalled();
		const counts = within(confirm).getByTestId("privacy-delete-counts");
		expect(counts).toHaveTextContent("Thành viên: 1");
		expect(counts).toHaveTextContent("Dòng sổ điểm: 4");
		expect(counts).toHaveTextContent("Hóa đơn gỡ liên kết: 3");
		await user.click(within(confirm).getByTestId("privacy-delete-yes"));
		await waitFor(() =>
			expect(privacy.deleteSubject).toHaveBeenCalledWith("r-delete"),
		);
		const deleted = await screen.findByTestId("privacy-deleted");
		expect(deleted).toHaveTextContent("Khách hàng: 1");
		expect(deleted).toHaveTextContent("Đúng hạn: trả lời có, hoàn tất có.");
	});

	it("keeps everything when the deletion is cancelled", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, { privacy });
		await screen.findByTestId("privacy-requests");
		await user.click(
			within(row("r-delete")).getByTestId("privacy-request-toggle"),
		);
		await user.click(
			within(row("r-delete")).getByTestId("privacy-delete-start"),
		);
		await user.click(
			within(await screen.findByTestId("privacy-delete-confirm")).getByText(
				"Quay lại",
			),
		);
		expect(privacy.deleteSubject).not.toHaveBeenCalled();
		expect(screen.queryByTestId("privacy-delete-confirm")).toBeNull();
	});

	it("shows the managers a deletion request but no delete button", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, {
			role: "manager",
			privacy,
		});
		await screen.findByTestId("privacy-requests");
		await user.click(
			within(row("r-delete")).getByTestId("privacy-request-toggle"),
		);
		expect(
			within(row("r-delete")).getByTestId("privacy-no-delete"),
		).toHaveTextContent("Chỉ chủ quán xóa được khách.");
		expect(
			within(row("r-delete")).queryByTestId("privacy-delete-start"),
		).toBeNull();
		expect(privacy.deletionPreview).not.toHaveBeenCalled();
	});

	it("shows the database refusal when a deletion is refused", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		(privacy.deleteSubject as ReturnType<typeof vi.fn>).mockRejectedValue(
			new SettingsWriteError("forbidden"),
		);
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, { privacy });
		await screen.findByTestId("privacy-requests");
		await user.click(
			within(row("r-delete")).getByTestId("privacy-request-toggle"),
		);
		await user.click(
			within(row("r-delete")).getByTestId("privacy-delete-start"),
		);
		await user.click(await screen.findByTestId("privacy-delete-yes"));
		expect(await screen.findByTestId("privacy-delete-error")).toHaveTextContent(
			"Bạn không có quyền thực hiện thao tác này.",
		);
	});

	it("closes a request with notes as completed or rejected", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, { privacy });
		await screen.findByTestId("privacy-requests");
		await user.click(
			within(row("r-track")).getByTestId("privacy-request-toggle"),
		);
		await user.type(
			within(row("r-track")).getByTestId("privacy-close-notes"),
			"đã xử lý",
		);
		await user.click(within(row("r-track")).getByTestId("privacy-complete"));
		await waitFor(() =>
			expect(privacy.closeRequest).toHaveBeenCalledWith({
				requestId: "r-track",
				status: "completed",
				notes: "đã xử lý",
			}),
		);
		await waitFor(() =>
			expect(row("r-track").dataset.status).toBe("completed"),
		);
		await user.click(
			within(row("r-unlinked")).getByTestId("privacy-request-toggle"),
		);
		await user.click(within(row("r-unlinked")).getByTestId("privacy-reject"));
		await waitFor(() =>
			expect(row("r-unlinked").dataset.status).toBe("rejected"),
		);
	});

	it("records a request not linked to a customer", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const privacy = createFakePrivacy(queue());
		renderPage(<PrivacyRequestsPage />, REQUESTS_PATH, { privacy });
		const form = await screen.findByTestId("privacy-record");
		await user.type(
			within(form).getByTestId("privacy-form-contact"),
			"zalo: khach",
		);
		await user.click(within(form).getByTestId("privacy-form-submit"));
		await waitFor(() =>
			expect(privacy.recordRequest).toHaveBeenCalledWith(TENANT_ID, {
				requestType: "access",
				subjectId: null,
				contact: "zalo: khach",
				usesProcessor: false,
				notes: null,
			}),
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("privacy-request")).toHaveLength(7),
		);
	});
});
