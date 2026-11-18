import {
	type CashCountRecord,
	type CashCountRow,
	type ChecklistItem,
	type ChecklistRun,
	type DueChecklist,
	type Handover,
	type Incident,
	type IncidentCategory,
	type IncidentStatus,
	type MemberRole,
	type OpsClient,
	REFUSAL,
	RestError,
	type ShiftPhase,
} from "@fnb/zalo-mini";
import {
	DEFAULT_REVENUE_VISIBILITY,
	isRevenueVisibility,
	type RevenueVisibility,
	revenueAccess,
	storeDays,
} from "../home/model";
import {
	SAMPLE_CURRENCY,
	SAMPLE_STORES,
	SAMPLE_TIME_ZONE,
} from "../home/sample";
import { canManage, isoDateShift, seesDifference } from "./model";
import type { ShiftContext, ShiftQuery, ShiftSource } from "./source";
import { shiftStore } from "./source";

export const SAMPLE_TENANT_ID = "00000000-0000-4000-8000-0000000000a0";
export const SAMPLE_MEMBER_ID = "00000000-0000-4000-8000-00000000a001";
export const SAMPLE_OTHER_MEMBER_ID = "00000000-0000-4000-8000-00000000a002";
export const SAMPLE_BUCKET = "ops-brand-1";
export const SAMPLE_EXPECTED_CASH = 2_500_000;
export const SAMPLE_CASH_THRESHOLD = 50_000;
const MAX_SAMPLE_DELAY_MS = 10_000;

export interface ShiftSampleSettings {
	readonly visibility: RevenueVisibility;
	readonly delayMs: number;
	readonly failFirstUpload: boolean;
	readonly checklistTaken: boolean;
	readonly unmatchedCount: boolean;
}

export function shiftSampleSettingsFrom(search: string): ShiftSampleSettings {
	const params = new URLSearchParams(search);
	const visibility = params.get("revenue");
	const delay = Number(params.get("dataDelay") ?? "0");
	return {
		visibility: isRevenueVisibility(visibility)
			? visibility
			: DEFAULT_REVENUE_VISIBILITY,
		delayMs:
			Number.isInteger(delay) && delay > 0
				? Math.min(delay, MAX_SAMPLE_DELAY_MS)
				: 0,
		failFirstUpload: params.get("upload") === "fail-once",
		checklistTaken: params.get("checklist") === "taken",
		unmatchedCount: params.get("count") === "unmatched",
	};
}

interface SampleItem {
	readonly label: string;
	readonly requiresPhoto?: boolean;
	readonly numberUnit?: string;
}

interface SampleTemplate {
	readonly key: string;
	readonly title: string;
	readonly phase: ShiftPhase;
	version: number;
	items: readonly SampleItem[];
}

export const SAMPLE_CATEGORIES: readonly IncidentCategory[] = [
	{ key: "thiet_bi", label: "Thiết bị", active: true },
	{ key: "ve_sinh", label: "Vệ sinh", active: true },
	{ key: "khach_hang", label: "Khách hàng", active: true },
	{ key: "nhan_su", label: "Nhân sự", active: true },
	{ key: "khac", label: "Khác", active: true },
];

function sampleTemplates(): SampleTemplate[] {
	return [
		{
			key: "1",
			title: "Mở ca",
			phase: "opening",
			version: 1,
			items: [
				{ label: "Bật máy pha cà phê và kiểm tra áp suất" },
				{ label: "Lau quầy, bàn ghế khu khách", requiresPhoto: true },
				{ label: "Nhiệt độ tủ mát", numberUnit: "°C" },
				{ label: "Chụp ảnh quầy đã sẵn sàng", requiresPhoto: true },
			],
		},
		{
			key: "2",
			title: "Vệ sinh giữa ca",
			phase: "midshift",
			version: 1,
			items: [
				{ label: "Dọn nhà vệ sinh", requiresPhoto: true },
				{ label: "Đổ rác và thay túi" },
			],
		},
		{
			key: "3",
			title: "Đóng ca",
			phase: "closing",
			version: 1,
			items: [
				{ label: "Vệ sinh máy pha và vòi đánh sữa", requiresPhoto: true },
				{ label: "Cất nguyên liệu vào tủ" },
				{ label: "Nhiệt độ tủ đông", numberUnit: "°C" },
				{ label: "Khóa cửa sau" },
			],
		},
	];
}

function sampleId(kind: string, n: number): string {
	return `00000000-0000-4000-8000-${kind}${String(n).padStart(12 - kind.length, "0")}`;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function refuse(code: string, status = 400): never {
	throw new RestError(status, code);
}

interface SampleRun {
	run: ChecklistRun;
}

interface SampleCount extends CashCountRecord {
	readonly amount: number;
	readonly shiftNumber: number | null;
}

interface SampleState {
	templates: SampleTemplate[];
	runs: SampleRun[];
	photos: Map<string, Blob>;
	handovers: Handover[];
	incidents: Incident[];
	counts: SampleCount[];
	uploads: number;
	sequence: number;
}

export interface SampleShiftSource extends ShiftSource {
	reviseTemplate(phase: ShiftPhase, items: readonly SampleItem[]): void;
}

export function createSampleShiftSource(
	settings: ShiftSampleSettings,
	clock: () => Date = () => new Date(),
): SampleShiftSource {
	let role: MemberRole = "manager";
	const pause = () =>
		settings.delayMs > 0 ? wait(settings.delayMs) : Promise.resolve();
	const today = (storeId: string) => {
		const store =
			SAMPLE_STORES.find((candidate) => candidate.id === storeId) ??
			SAMPLE_STORES[0];
		return store === undefined
			? clock().toISOString().slice(0, 10)
			: storeDays(clock(), store).today;
	};
	const minutesAgo = (minutes: number) =>
		new Date(clock().getTime() - minutes * 60_000).toISOString();
	const state: SampleState = {
		templates: sampleTemplates(),
		runs: [],
		photos: new Map(),
		handovers: [],
		incidents: [],
		counts: [],
		uploads: 0,
		sequence: 0,
	};
	const next = (kind: string) => {
		state.sequence += 1;
		return sampleId(kind, state.sequence);
	};
	for (const store of SAMPLE_STORES) {
		const day = today(store.id);
		state.handovers.push({
			id: next("b"),
			storeId: store.id,
			businessDate: day,
			fromShift: 1,
			toShift: 2,
			note: "Máy xay đá kêu to, đã báo kỹ thuật. Còn 2 thùng sữa trong kho.",
			createdBy: SAMPLE_OTHER_MEMBER_ID,
			createdAt: minutesAgo(95),
			acknowledgedAt: null,
		});
		state.incidents.push(
			{
				id: next("c"),
				storeId: store.id,
				businessDate: day,
				occurredAt: minutesAgo(50),
				kind: "incident",
				categoryKey: "thiet_bi",
				description: "Vòi nước bồn rửa ly bị rò rỉ.",
				itemLabel: null,
				photoBucket: SAMPLE_BUCKET,
				photoPaths: [],
				status: "open",
				createdBy: SAMPLE_OTHER_MEMBER_ID,
				createdAt: minutesAgo(48),
			},
			{
				id: next("c"),
				storeId: store.id,
				businessDate: day,
				occurredAt: minutesAgo(140),
				kind: "stock_out",
				categoryKey: "khac",
				description: "Hết từ trưa, cần nhập thêm.",
				itemLabel: "Sữa tươi 1 lít",
				photoBucket: SAMPLE_BUCKET,
				photoPaths: [],
				status: "seen",
				createdBy: SAMPLE_OTHER_MEMBER_ID,
				createdAt: minutesAgo(138),
			},
		);
	}

	const templateId = (template: SampleTemplate, storeId: string) =>
		`${template.key}0000000-0000-4000-8000-${storeId.slice(-12)}`;
	const findTemplate = (id: string, storeId: string) =>
		state.templates.find((template) => templateId(template, storeId) === id);
	const runOf = (runId: string) =>
		state.runs.find((entry) => entry.run.runId === runId);

	function seedTakenRun(storeId: string): void {
		const template = state.templates[0];
		if (template === undefined || !settings.checklistTaken) return;
		if (state.runs.some((entry) => entry.run.storeId === storeId)) return;
		state.runs.push({
			run: buildRun(template, storeId, SAMPLE_OTHER_MEMBER_ID),
		});
	}

	function buildRun(
		template: SampleTemplate,
		storeId: string,
		actor: string,
	): ChecklistRun {
		const runId = next("a");
		const items: ChecklistItem[] = template.items.map((item, index) => ({
			answerId: next("d"),
			itemId: next("e"),
			position: index + 1,
			label: item.label,
			requiresPhoto: item.requiresPhoto === true,
			numberUnit: item.numberUnit ?? null,
			done: false,
			numberValue: null,
			photoPath: null,
			photoRemoved: false,
			answeredBy: null,
			answeredAt: null,
		}));
		return {
			runId,
			storeId,
			templateId: templateId(template, storeId),
			templateVersion: template.version,
			title: template.title,
			shiftPhase: template.phase,
			businessDate: today(storeId),
			status: "open",
			startedBy: actor,
			startedAt: clock().toISOString(),
			finishedAt: null,
			photo: {
				bucket: SAMPLE_BUCKET,
				prefix: `${SAMPLE_TENANT_ID}/${storeId}/run/${runId}/`,
			},
			itemsTotal: items.length,
			itemsDone: 0,
			items,
		};
	}

	function withItems(run: ChecklistRun, items: ChecklistItem[]): ChecklistRun {
		return {
			...run,
			items,
			itemsDone: items.filter((item) => item.done).length,
		};
	}

	function reviewRows(
		storeId: string,
		from: string,
		to: string,
	): CashCountRow[] {
		const day = today(storeId);
		const visible = seesDifference(
			role,
			revenueAccess(role, settings.visibility),
		);
		const rows: CashCountRow[] = [];
		const shift = (
			date: string,
			number: number,
			expected: number,
			count: { id: string; amount: number; at: string; by: string } | null,
		): CashCountRow => {
			const variance = count === null ? null : count.amount - expected;
			const over =
				variance !== null && Math.abs(variance) > SAMPLE_CASH_THRESHOLD;
			return {
				storeId,
				businessDate: date,
				shiftId: visible
					? `sample-shift-${storeId.slice(-3)}-${date}-${number}`
					: null,
				shiftNumber: visible ? number : null,
				openedAt: null,
				closedAt: null,
				cashCountId: count?.id ?? null,
				countedAmount: count?.amount ?? null,
				countedBy: count?.by ?? null,
				countedAt: count?.at ?? null,
				recounts: 0,
				expectedCash: visible ? expected : null,
				variance: visible ? variance : null,
				overAbs: visible && over,
				overRel: false,
				overZ: false,
				state:
					count === null
						? "no_count"
						: !visible
							? "recorded"
							: over
								? "over"
								: "within",
			};
		};
		const yesterday = isoDateShift(day, -1);
		if (yesterday >= from && yesterday <= to && visible) {
			rows.push(
				shift(yesterday, 1, 2_000_000, {
					id: sampleId("f", 901),
					amount: 1_980_000,
					at: minutesAgo(1500),
					by: SAMPLE_OTHER_MEMBER_ID,
				}),
				shift(yesterday, 2, 3_150_000, {
					id: sampleId("f", 902),
					amount: 3_050_000,
					at: minutesAgo(1100),
					by: SAMPLE_OTHER_MEMBER_ID,
				}),
			);
		}
		if (day >= from && day <= to) {
			const active = state.counts.find(
				(count) =>
					count.storeId === storeId &&
					count.status === "active" &&
					count.shiftNumber === 1,
			);
			if (visible || active !== undefined) {
				rows.push(
					shift(
						day,
						1,
						SAMPLE_EXPECTED_CASH,
						active === undefined
							? null
							: {
									id: active.id,
									amount: active.amount,
									at: active.countedAt,
									by: active.createdBy ?? SAMPLE_MEMBER_ID,
								},
					),
				);
			}
			for (const count of state.counts) {
				if (
					count.storeId === storeId &&
					count.status === "active" &&
					count.shiftNumber === null
				) {
					rows.push({
						...shift(day, 0, 0, {
							id: count.id,
							amount: count.amount,
							at: count.countedAt,
							by: count.createdBy ?? SAMPLE_MEMBER_ID,
						}),
						shiftId: null,
						shiftNumber: null,
						expectedCash: null,
						variance: null,
						overAbs: false,
						state: "unmatched",
					});
				}
			}
		}
		return rows;
	}

	const ops: OpsClient = {
		memberId: SAMPLE_MEMBER_ID,
		async dueChecklists(storeId) {
			await pause();
			seedTakenRun(storeId);
			return state.templates.map((template): DueChecklist => {
				const id = templateId(template, storeId);
				const runs = state.runs
					.map((entry) => entry.run)
					.filter((run) => run.templateId === id && run.storeId === storeId);
				const run =
					runs.find((candidate) => candidate.status === "open") ??
					runs[runs.length - 1];
				return {
					templateId: id,
					title: template.title,
					shiftPhase: template.phase,
					templateVersion: template.version,
					everyStore: false,
					items: template.items.length,
					photoItems: template.items.filter((item) => item.requiresPhoto)
						.length,
					businessDate: today(storeId),
					run:
						run === undefined
							? null
							: {
									id: run.runId,
									status: run.status,
									startedBy: run.startedBy,
									startedAt: run.startedAt,
									finishedAt: run.finishedAt,
								},
				};
			});
		},
		async startChecklistRun(id, storeId) {
			await pause();
			const template = findTemplate(id, storeId);
			if (template === undefined) refuse(REFUSAL.notAllowed, 403);
			const open = state.runs.find(
				(entry) =>
					entry.run.templateId === id &&
					entry.run.storeId === storeId &&
					entry.run.status === "open",
			);
			if (open !== undefined) {
				if (open.run.startedBy !== SAMPLE_MEMBER_ID)
					refuse(REFUSAL.duplicate, 409);
				return open.run;
			}
			const entry = { run: buildRun(template, storeId, SAMPLE_MEMBER_ID) };
			state.runs.push(entry);
			return entry.run;
		},
		async checklistRun(runId) {
			await pause();
			return runOf(runId)?.run ?? null;
		},
		async saveChecklistAnswer(change) {
			await pause();
			const entry = state.runs.find((candidate) =>
				candidate.run.items.some((item) => item.answerId === change.answerId),
			);
			if (entry === undefined) refuse(REFUSAL.notAllowed, 403);
			const run = entry.run;
			if (run.status === "finished" && !canManage(role))
				refuse(REFUSAL.state, 500);
			if (run.startedBy !== SAMPLE_MEMBER_ID && !canManage(role))
				refuse(REFUSAL.notAllowed, 403);
			const item = run.items.find(
				(candidate) => candidate.answerId === change.answerId,
			);
			if (item === undefined) refuse(REFUSAL.notAllowed, 403);
			if (change.photoPath !== null && !state.photos.has(change.photoPath))
				refuse(REFUSAL.invalid);
			if (change.numberValue !== null && item.numberUnit === null)
				refuse(REFUSAL.check);
			if (change.done && item.requiresPhoto && change.photoPath === null)
				refuse(REFUSAL.check);
			if (
				change.done &&
				item.numberUnit !== null &&
				change.numberValue === null
			)
				refuse(REFUSAL.check);
			const saved: ChecklistItem = {
				...item,
				done: change.done,
				numberValue: change.numberValue,
				photoPath: change.photoPath,
				answeredBy: SAMPLE_MEMBER_ID,
				answeredAt: clock().toISOString(),
			};
			entry.run = withItems(
				run,
				run.items.map((candidate) =>
					candidate.answerId === saved.answerId ? saved : candidate,
				),
			);
			return { ...saved, runId: run.runId };
		},
		async finishChecklistRun(runId) {
			await pause();
			const entry = runOf(runId);
			if (entry === undefined) refuse(REFUSAL.notAllowed, 403);
			if (entry.run.status === "finished") return entry.run;
			if (entry.run.startedBy !== SAMPLE_MEMBER_ID)
				refuse(REFUSAL.notAllowed, 403);
			entry.run = {
				...entry.run,
				status: "finished",
				finishedAt: clock().toISOString(),
			};
			return entry.run;
		},
		async uploadPhoto(target, photo, onProgress) {
			onProgress?.(0.3);
			await wait(Math.max(60, settings.delayMs));
			state.uploads += 1;
			if (settings.failFirstUpload && state.uploads === 1)
				throw new RestError(0);
			onProgress?.(1);
			const path = `${target.prefix}p-${state.uploads}.jpg`;
			state.photos.set(path, photo);
			return path;
		},
		async photo(_bucket, path) {
			await pause();
			const blob = state.photos.get(path);
			if (blob === undefined) throw new RestError(404);
			return blob;
		},
		async recordCashCount(input) {
			await pause();
			const storeId = input.storeId;
			let shiftNumber: number | null = null;
			if (input.replacesId !== null) {
				const replaced = state.counts.find(
					(count) => count.id === input.replacesId,
				);
				if (replaced === undefined || replaced.status !== "reopened")
					refuse(REFUSAL.invalid);
				if (state.counts.some((count) => count.replacesId === input.replacesId))
					refuse(REFUSAL.duplicate, 409);
				shiftNumber = replaced.shiftNumber;
			} else if (
				!settings.unmatchedCount &&
				!state.counts.some(
					(count) =>
						count.storeId === storeId &&
						count.status === "active" &&
						count.shiftNumber === 1,
				)
			) {
				shiftNumber = 1;
			}
			const count: SampleCount = {
				id: next("f"),
				storeId,
				businessDate: today(storeId),
				countedAt: clock().toISOString(),
				status: "active",
				replacesId: input.replacesId,
				reopenedAt: null,
				createdBy: SAMPLE_MEMBER_ID,
				amount: input.amount,
				shiftNumber,
			};
			state.counts.push(count);
			return {
				cashCountId: count.id,
				businessDate: count.businessDate,
				countedAt: count.countedAt,
				matched: shiftNumber !== null,
			};
		},
		async cashCountReview(storeIds, from, to) {
			await pause();
			return storeIds.flatMap((storeId) => reviewRows(storeId, from, to));
		},
		async cashCounts(storeId, since) {
			await pause();
			return state.counts
				.filter(
					(count) => count.storeId === storeId && count.businessDate >= since,
				)
				.map(
					(count): CashCountRecord => ({
						id: count.id,
						storeId: count.storeId,
						businessDate: count.businessDate,
						countedAt: count.countedAt,
						status: count.status,
						replacesId: count.replacesId,
						reopenedAt: count.reopenedAt,
						createdBy: count.createdBy,
					}),
				);
		},
		async reopenCashCount(id) {
			await pause();
			if (!canManage(role)) refuse(REFUSAL.notAllowed, 403);
			state.counts = state.counts.map((count) =>
				count.id === id && count.status === "active"
					? { ...count, status: "reopened", reopenedAt: clock().toISOString() }
					: count,
			);
		},
		async writeHandover(input) {
			await pause();
			const handover: Handover = {
				id: next("b"),
				storeId: input.storeId,
				businessDate: today(input.storeId),
				fromShift: input.fromShift,
				toShift: input.toShift,
				note: input.note,
				createdBy: SAMPLE_MEMBER_ID,
				createdAt: clock().toISOString(),
				acknowledgedAt: null,
			};
			state.handovers.unshift(handover);
			return { handoverId: handover.id, businessDate: handover.businessDate };
		},
		async updateHandover(id, input) {
			await pause();
			const handover = state.handovers.find((candidate) => candidate.id === id);
			if (handover === undefined || handover.createdBy !== SAMPLE_MEMBER_ID)
				refuse(REFUSAL.notAllowed, 403);
			if (handover.acknowledgedAt !== null) refuse(REFUSAL.state, 500);
			state.handovers = state.handovers.map((candidate) =>
				candidate.id === id ? { ...candidate, ...input } : candidate,
			);
			return { handoverId: id, businessDate: handover.businessDate };
		},
		async acknowledgeHandover(id) {
			await pause();
			const handover = state.handovers.find((candidate) => candidate.id === id);
			if (
				handover === undefined ||
				!canManage(role) ||
				handover.createdBy === SAMPLE_MEMBER_ID
			)
				refuse(REFUSAL.notAllowed, 403);
			state.handovers = state.handovers.map((candidate) =>
				candidate.id === id && candidate.acknowledgedAt === null
					? { ...candidate, acknowledgedAt: clock().toISOString() }
					: candidate,
			);
		},
		async handovers(storeIds, since) {
			await pause();
			return state.handovers.filter(
				(handover) =>
					storeIds.includes(handover.storeId) && handover.businessDate >= since,
			);
		},
		async reportIncident(input) {
			await pause();
			const id = next("c");
			state.incidents.unshift({
				id,
				storeId: input.storeId,
				businessDate: today(input.storeId),
				occurredAt: clock().toISOString(),
				kind: input.kind,
				categoryKey: input.categoryKey,
				description: input.description,
				itemLabel: input.itemLabel,
				photoBucket: SAMPLE_BUCKET,
				photoPaths: [],
				status: "open",
				createdBy: SAMPLE_MEMBER_ID,
				createdAt: clock().toISOString(),
			});
			return {
				incidentId: id,
				businessDate: today(input.storeId),
				photo: {
					bucket: SAMPLE_BUCKET,
					prefix: `${SAMPLE_TENANT_ID}/${input.storeId}/incident/${id}/`,
				},
			};
		},
		async updateIncident(change) {
			await pause();
			const incident = state.incidents.find(
				(candidate) => candidate.id === change.incidentId,
			);
			if (incident === undefined || incident.createdBy !== SAMPLE_MEMBER_ID)
				refuse(REFUSAL.notAllowed, 403);
			if (incident.status !== "open") refuse(REFUSAL.state, 500);
			if (change.photoPaths.some((path) => !state.photos.has(path)))
				refuse(REFUSAL.invalid);
			state.incidents = state.incidents.map((candidate) =>
				candidate.id === change.incidentId
					? {
							...candidate,
							categoryKey: change.categoryKey,
							description: change.description,
							itemLabel: change.itemLabel,
							photoPaths: change.photoPaths,
						}
					: candidate,
			);
		},
		async acknowledgeIncident(id) {
			return moveIncident(id, "seen");
		},
		async resolveIncident(id) {
			return moveIncident(id, "resolved");
		},
		async incidents(storeIds) {
			await pause();
			return state.incidents.filter(
				(incident) =>
					storeIds.includes(incident.storeId) && incident.status !== "resolved",
			);
		},
		async incidentCategories() {
			await pause();
			return [...SAMPLE_CATEGORIES];
		},
	};

	async function moveIncident(
		id: string,
		status: IncidentStatus,
	): Promise<IncidentStatus> {
		await pause();
		const incident = state.incidents.find((candidate) => candidate.id === id);
		if (incident === undefined || !canManage(role))
			refuse(REFUSAL.notAllowed, 403);
		if (incident.status === "open" && incident.createdBy === SAMPLE_MEMBER_ID)
			refuse(REFUSAL.notAllowed, 403);
		const moved: IncidentStatus =
			incident.status === "resolved" ||
			(status === "seen" && incident.status === "seen")
				? incident.status
				: status;
		state.incidents = state.incidents.map((candidate) =>
			candidate.id === id ? { ...candidate, status: moved } : candidate,
		);
		return moved;
	}

	return {
		ops,
		async context(query: ShiftQuery, now: Date): Promise<ShiftContext> {
			await pause();
			role = query.role;
			const wanted = (store: { readonly id: string; readonly name: string }) =>
				query.storeIds === null
					? query.storeNames.includes(store.name)
					: query.storeIds.includes(store.id);
			return {
				tenantId: SAMPLE_TENANT_ID,
				role: query.role,
				access: revenueAccess(query.role, settings.visibility),
				currencyCode: SAMPLE_CURRENCY,
				timeZone: SAMPLE_TIME_ZONE,
				stores: SAMPLE_STORES.filter(wanted).map((store) =>
					shiftStore(
						{
							id: store.id,
							name: store.name,
							timeZone: store.timeZone,
							businessDayStartMinutes: store.businessDayStartMinutes,
							openingHours: store.openingHours,
						},
						now,
					),
				),
			};
		},
		reviseTemplate(phase, items) {
			state.templates = state.templates.map((template) =>
				template.phase === phase
					? { ...template, version: template.version + 1, items }
					: template,
			);
		},
	};
}
