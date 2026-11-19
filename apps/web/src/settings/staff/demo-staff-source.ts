import {
	currentDemoAsOf,
	type DemoSettingsStore,
	demoStoreIds,
} from "@fnb/demo-analytics";
import { addDays, type IsoDate } from "../../lib/business-dates";
import { demoAuditOf, demoRowId, markDemoSaved } from "../demo-writes";
import { SettingsWriteError } from "../source";
import {
	DEFAULT_STAFF_REVENUE_VISIBILITY,
	PAIRING_CODE_TTL_MS,
	type PairingCode,
	STAFF_REVENUE_VISIBILITIES,
	type StaffChange,
	type StaffMember,
	type StaffRevenueVisibility,
	type StaffSettingsSource,
	type StaffStatus,
} from "./source";
import { normalisedContact, staffContactIssue } from "./staff-contact-rules";
import { staffChangeProblem } from "./staff-rules";

export const DEMO_STAFF_CONTACT =
	"Gặp quản lý ca tại quầy để nhận mã ghép nối. Ngoài giờ làm, nhắn quản lý qua Zalo.";

interface DemoStaffRow extends StaffChange {
	readonly id: string;
	readonly status: StaffStatus;
	readonly paired: boolean;
	readonly pairedAt: string | null;
	readonly phoneHint: string | null;
	readonly deactivatedAt: string | null;
}

interface DemoStaffState {
	rows: DemoStaffRow[];
	visibility: StaffRevenueVisibility;
	contact: string | null;
	next: number;
}

const states = new WeakMap<DemoSettingsStore, DemoStaffState>();

function morningOf(asOf: IsoDate, daysBack: number): string {
	return `${addDays(asOf, -daysBack)}T02:30:00.000Z`;
}

export function demoStaffRows(asOf: IsoDate): DemoStaffRow[] {
	const [first = "", second = first] = demoStoreIds();
	return [
		{
			id: "demo-staff-1",
			displayName: "Nhân viên 1",
			role: "staff",
			storeIds: [first],
			status: "active",
			paired: true,
			pairedAt: morningOf(asOf, 21),
			phoneHint: "…204",
			deactivatedAt: null,
		},
		{
			id: "demo-staff-2",
			displayName: "Nhân viên 2",
			role: "staff",
			storeIds: [second],
			status: "invited",
			paired: false,
			pairedAt: null,
			phoneHint: null,
			deactivatedAt: null,
		},
		{
			id: "demo-staff-3",
			displayName: "Quản lý 1",
			role: "manager",
			storeIds: [first, second],
			status: "active",
			paired: true,
			pairedAt: morningOf(asOf, 40),
			phoneHint: null,
			deactivatedAt: null,
		},
		{
			id: "demo-staff-4",
			displayName: "Nhân viên 3",
			role: "staff",
			storeIds: [first],
			status: "inactive",
			paired: false,
			pairedAt: morningOf(asOf, 60),
			phoneHint: null,
			deactivatedAt: morningOf(asOf, 9),
		},
	];
}

function stateOf(store: DemoSettingsStore): DemoStaffState {
	let state = states.get(store);
	if (state === undefined) {
		const rows = demoStaffRows(currentDemoAsOf());
		state = {
			rows,
			visibility: DEFAULT_STAFF_REVENUE_VISIBILITY,
			contact: DEMO_STAFF_CONTACT,
			next: rows.length + 1,
		};
		states.set(store, state);
	}
	return state;
}

function auditKey(id: string): string {
	return demoRowId("staff", id);
}

function checked(change: StaffChange): StaffChange {
	const problem = staffChangeProblem(change, new Set(demoStoreIds()));
	if (problem !== null) throw new SettingsWriteError("invalid", problem);
	return {
		displayName: change.displayName,
		role: change.role,
		storeIds: change.storeIds === null ? null : [...change.storeIds],
	};
}

function replaced(
	store: DemoSettingsStore,
	rosterId: string,
	change: (row: DemoStaffRow) => DemoStaffRow | null,
): void {
	const state = stateOf(store);
	const row = state.rows.find((candidate) => candidate.id === rosterId);
	if (row === undefined) throw new SettingsWriteError("forbidden");
	const next = change(row);
	if (next === null) return;
	state.rows = state.rows.map((candidate) =>
		candidate.id === rosterId ? next : candidate,
	);
	markDemoSaved(store, [auditKey(rosterId)]);
}

export function randomPairingCode(): string {
	const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
	return String(value % 1_000_000).padStart(6, "0");
}

function byName(left: DemoStaffRow, right: DemoStaffRow): number {
	if (left.displayName !== right.displayName) {
		return left.displayName < right.displayName ? -1 : 1;
	}
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function createDemoStaffSource(
	store: DemoSettingsStore,
): StaffSettingsSource {
	return {
		kind: "demo",

		async roster(): Promise<StaffMember[]> {
			return [...stateOf(store).rows].sort(byName).map((row) => ({
				...row,
				audit: demoAuditOf(store, auditKey(row.id)),
			}));
		},

		async addStaff(_tenantId, change): Promise<string> {
			const valid = checked(change);
			const state = stateOf(store);
			const id = `demo-staff-${state.next}`;
			state.next += 1;
			state.rows = [
				...state.rows,
				{
					...valid,
					id,
					status: "invited",
					paired: false,
					pairedAt: null,
					phoneHint: null,
					deactivatedAt: null,
				},
			];
			markDemoSaved(store, [auditKey(id)]);
			return id;
		},

		async updateStaff(_tenantId, rosterId, change) {
			const valid = checked(change);
			replaced(store, rosterId, (row) => ({ ...row, ...valid }));
		},

		async deactivateStaff(_tenantId, rosterId) {
			replaced(store, rosterId, (row) =>
				row.status === "inactive"
					? null
					: {
							...row,
							status: "inactive",
							paired: false,
							phoneHint: null,
							deactivatedAt: new Date().toISOString(),
						},
			);
		},

		async reactivateStaff(_tenantId, rosterId) {
			replaced(store, rosterId, (row) =>
				row.status !== "inactive"
					? null
					: {
							...row,
							status: "invited",
							pairedAt: null,
							deactivatedAt: null,
						},
			);
		},

		async staffRevenueVisibility(): Promise<StaffRevenueVisibility> {
			return stateOf(store).visibility;
		},

		async setStaffRevenueVisibility(_tenantId, visibility) {
			if (!STAFF_REVENUE_VISIBILITIES.includes(visibility)) {
				throw new SettingsWriteError("invalid", "visibility");
			}
			stateOf(store).visibility = visibility;
			return visibility;
		},

		async staffApps() {
			return [];
		},

		async staffContact() {
			return stateOf(store).contact;
		},

		async setStaffContact(_tenantId, text) {
			if (text !== null && staffContactIssue(text) !== null) {
				throw new SettingsWriteError("invalid", "staff_contact_instructions");
			}
			const stored = text === null ? null : normalisedContact(text);
			stateOf(store).contact = stored;
			return stored;
		},

		async issuePairingCode(_tenantId, rosterId): Promise<PairingCode> {
			const row = stateOf(store).rows.find(
				(candidate) => candidate.id === rosterId,
			);
			if (row === undefined) throw new SettingsWriteError("forbidden");
			if (row.status === "inactive") {
				throw new SettingsWriteError("invalid");
			}
			return {
				rosterId,
				code: randomPairingCode(),
				expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString(),
			};
		},
	};
}
