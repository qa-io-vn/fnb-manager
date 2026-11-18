import { checkMiniAppScreen } from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page } from "@playwright/test";
import { expectOnePrimaryAction } from "./entry-checks";
import {
	CHECKLIST_TITLE,
	EXPECTED_CASH,
	type OpsFixture,
	type OpsState,
	SECOND_ITEMS,
} from "./ops-fixture";
import {
	jpegSize,
	MAX_LONG_SIDE,
	MAX_PHOTO_BYTES,
	type SyntheticPhoto,
	takePhotoWith,
} from "./photo-fixture";

export const HANDOVER_NOTE = "Máy pha đã vệ sinh. Còn 3 hộp sữa trong kho.";
const INCIDENT_TEXT = "Vòi nước bồn rửa ly bị rò rỉ.";

export interface OpsRun {
	readonly uploadRequests: number;
	readonly uploads: number;
	readonly uploadBytesMax: number;
	readonly uploadLongSideMax: number;
	readonly secondRunVersion: number;
	readonly staffSawDifference: boolean;
	readonly ownerCountState: string;
	readonly ownerVariance: number | null;
	readonly incidentStatusAfterAcknowledgement: string;
	readonly state: OpsState;
}

export function opsSummary(run: OpsRun): string {
	return JSON.stringify(run);
}

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

const TAB_SCREENS: Readonly<Record<string, string>> = {
	"Trang chủ": "home",
	"Ca làm": "shift-board",
};

async function tab(page: Page, name: string): Promise<void> {
	await expect(page.getByTestId("result-modal")).toHaveCount(0);
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name })
		.click();
	const screen = TAB_SCREENS[name];
	if (screen !== undefined)
		await expect(page.getByTestId(screen)).toBeVisible();
	if (name === "Trang chủ")
		await expect(page.getByTestId("shift-board")).toHaveCount(0);
}

export async function runShiftOnTheLocalStack(
	page: Page,
	fixture: OpsFixture,
	entryUrl: string,
	photo: SyntheticPhoto,
): Promise<OpsRun> {
	let uploadRequests = 0;
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname.startsWith("/supabase/storage/v1/object/")
		) {
			uploadRequests += 1;
		}
	});

	await page.goto(entryUrl);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await page.getByRole("button", { name: "Đồng ý" }).click();
	await page.getByLabel("Mã ghép nối").fill(await fixture.issueCode());
	await page.getByRole("button", { name: "Ghép nối" }).click();
	await expect(
		page.getByRole("heading", { name: `Xin chào, ${fixture.mockName}` }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText("Nhân viên");
	await expect(page.getByTestId("home-close-state")).toHaveText(
		"Chưa đếm tiền hôm nay.",
	);
	await checkMiniAppScreen(page);

	await tab(page, "Ca làm");
	const card = page
		.getByTestId("checklist-card")
		.filter({ hasText: CHECKLIST_TITLE });
	await expect(card).toContainText("3 việc · 1 cần ảnh");
	await checkScreen(page);
	await card
		.getByRole("button", { name: `Bắt đầu: ${CHECKLIST_TITLE}` })
		.click();
	const state = page.getByTestId("checklist-run-state");
	await expect(state).toHaveAttribute("data-version", "1");
	await expect(state).toHaveAttribute("data-access", "edit");
	await checkScreen(page);
	const counter = page
		.getByTestId("checklist-item")
		.filter({ hasText: "Lau quầy" });
	await counter.getByRole("checkbox").click();
	await expect(counter.getByTestId("item-block")).toBeVisible();
	await takePhotoWith(
		page,
		counter.getByRole("button", { name: "Chụp ảnh" }),
		photo,
	);
	await expect(counter.getByRole("checkbox")).toBeChecked({ timeout: 60_000 });
	const fridge = page
		.getByTestId("checklist-item")
		.filter({ hasText: "Nhiệt độ tủ mát" });
	await fridge.getByLabel("Số đo (°C)").fill("4");
	await fridge.getByRole("checkbox").click();
	await expect(fridge.getByRole("checkbox")).toBeChecked();
	await expect(page.getByTestId("checklist-progress")).toContainText(
		"Đã xong 2/3 việc",
	);
	await checkScreen(page);
	await page.getByRole("button", { name: "Hoàn thành" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Vẫn hoàn thành" })
		.click();
	await expect(page.getByTestId("result-modal")).toContainText(
		"Đã hoàn thành danh sách",
	);
	await expect(card.getByTestId("checklist-state")).toHaveText(
		/^Đã xong lúc \d{2}:\d{2}$/,
	);

	const version = await fixture.reviseTemplate();
	await tab(page, "Trang chủ");
	await tab(page, "Ca làm");
	await expect(card).toContainText("2 việc · 1 cần ảnh");
	await card.getByRole("button", { name: "Làm lượt mới" }).click();
	await expect(state).toHaveAttribute("data-version", String(version));
	await expect(page.getByTestId("checklist-item")).toHaveText(
		SECOND_ITEMS.map((item) => new RegExp(item.label)),
	);
	await checkScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();

	await page.getByTestId("open-close").click();
	await expect(page.getByTestId("close-count")).toBeVisible();
	await checkScreen(page);
	await page.getByRole("button", { name: "Nhập tổng" }).click();
	await page
		.getByTestId("count-total")
		.fill(EXPECTED_CASH.toLocaleString("vi-VN"));
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await checkScreen(page);
	await page.getByRole("button", { name: "Xác nhận" }).click();
	const outcome = page.getByTestId("count-outcome");
	await expect(outcome).toContainText("Đã ghi nhận");
	const staffSawDifference =
		(await page.getByTestId("count-difference").count()) > 0 ||
		/₫|Chênh lệch/.test((await outcome.textContent()) ?? "");
	await checkScreen(page);
	await page.getByTestId("handover-note").fill(HANDOVER_NOTE);
	await page.getByRole("button", { name: "Gửi bàn giao" }).click();
	await expect(page.getByTestId("result-modal")).toContainText("Đã đóng ca");
	await expect(page.getByTestId("handover-state")).toHaveText(
		"Đã gửi bàn giao",
	);
	await checkScreen(page);
	await page.getByRole("button", { name: "Về Ca làm" }).click();
	await expect(page.getByTestId("close-counted")).toHaveText(
		/^Đã đếm tiền lúc \d{2}:\d{2}$/,
	);

	await page.getByRole("button", { name: "Báo sự cố" }).click();
	await expect(page.getByTestId("privacy-reminder")).toBeVisible();
	await page.getByTestId("report-description").fill(INCIDENT_TEXT);
	await takePhotoWith(
		page,
		page.getByRole("button", { name: "Thêm ảnh" }),
		photo,
	);
	await expect(page.getByTestId("photo-preview")).toBeVisible();
	await checkScreen(page);
	await page.getByRole("button", { name: "Gửi báo cáo" }).click();
	await expect(page.getByTestId("result-modal")).toContainText(
		"Đã gửi báo cáo",
		{
			timeout: 60_000,
		},
	);
	const report = page
		.getByTestId("incident")
		.filter({ hasText: INCIDENT_TEXT });
	await expect(report).toContainText("Của bạn");
	await expect(report).toContainText("Mới");
	await checkScreen(page);

	const acknowledged = await fixture.acknowledgeIncident(
		await fixture.staffIncidentId(),
	);
	await tab(page, "Trang chủ");
	await tab(page, "Ca làm");
	await expect(report).toContainText("Đã xem");
	await checkMiniAppScreen(page);

	const owner = await fixture.ownerCountState();
	const uploads = await fixture.storedPhotos();
	const sizes = uploads.map((body) => jpegSize(body));
	return {
		uploadRequests,
		uploads: uploads.length,
		uploadBytesMax: Math.max(0, ...uploads.map((body) => body.length)),
		uploadLongSideMax: Math.max(
			0,
			...sizes.map((size) =>
				size === null
					? Number.POSITIVE_INFINITY
					: Math.max(size.width, size.height),
			),
		),
		secondRunVersion: version,
		staffSawDifference,
		ownerCountState: owner.state,
		ownerVariance: owner.variance,
		incidentStatusAfterAcknowledgement: acknowledged,
		state: await fixture.opsState(HANDOVER_NOTE),
	};
}

export function expectOpsRun(run: OpsRun): void {
	expect(run.uploadRequests).toBe(2);
	expect(run.uploads).toBe(2);
	expect(run.uploadBytesMax).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
	expect(run.uploadLongSideMax).toBe(MAX_LONG_SIDE);
	expect(run.secondRunVersion).toBe(2);
	expect(run.staffSawDifference).toBe(false);
	expect(run.ownerCountState).toBe("within");
	expect(run.ownerVariance).toBe(0);
	expect(run.incidentStatusAfterAcknowledgement).toBe("seen");
	expect(run.state).toEqual({
		runs: 2,
		finishedRuns: 1,
		runsByStaff: 2,
		latestRunVersion: 2,
		answersDone: 2,
		photoAnswers: 1,
		photoObjects: 2,
		photoObjectsJpeg: 2,
		largestPhotoBytes: run.state.largestPhotoBytes,
		counts: 1,
		matchedCounts: 1,
		countsByStaff: 1,
		handovers: 1,
		handoverNoteMatches: true,
		incidents: 1,
		incidentPhotos: 1,
		incidentsSeen: 1,
	});
	expect(run.state.largestPhotoBytes).toBeGreaterThan(0);
	expect(run.state.largestPhotoBytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
}
