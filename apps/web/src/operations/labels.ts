import type { MessageKey, Translate } from "../i18n";
import type { Formatters } from "../lib/format";
import type { TenantRole } from "../settings/source";
import type { ComplianceStatus } from "./compliance";
import type {
	Actors,
	CashCountRow,
	CashCountState,
	IncidentKind,
	ReportStatus,
	ShiftPhase,
} from "./source";

export const PHASE_LABEL_KEYS: Readonly<Record<ShiftPhase, MessageKey>> = {
	opening: "operations.phase.opening",
	midshift: "operations.phase.midshift",
	closing: "operations.phase.closing",
};

export const COMPLIANCE_LABEL_KEYS: Readonly<
	Record<ComplianceStatus, MessageKey>
> = {
	done: "operations.compliance.done",
	late: "operations.compliance.late",
	inProgress: "operations.compliance.inProgress",
	due: "operations.compliance.due",
	missing: "operations.compliance.missing",
};

export const CASH_STATE_KEYS: Readonly<Record<CashCountState, MessageKey>> = {
	no_count: "operations.cashState.no_count",
	unmatched: "operations.cashState.unmatched",
	recorded: "operations.cashState.recorded",
	no_reference: "operations.cashState.no_reference",
	over: "operations.cashState.over",
	within: "operations.cashState.within",
};

export type LogKind = IncidentKind | "handover";

export const LOG_KIND_KEYS: Readonly<Record<LogKind, MessageKey>> = {
	incident: "operations.kind.incident",
	stock_out: "operations.kind.stock_out",
	handover: "operations.kind.handover",
};

export const STATUS_KEYS: Readonly<Record<ReportStatus, MessageKey>> = {
	open: "operations.status.open",
	seen: "operations.status.seen",
	resolved: "operations.status.resolved",
};

const ROLE_KEYS: Readonly<Record<TenantRole, MessageKey>> = {
	owner: "operations.actor.owner",
	manager: "operations.actor.manager",
	staff: "operations.actor.staff",
	viewer: "operations.actor.viewer",
	publisher: "operations.actor.publisher",
};

export function shiftLabel(t: Translate, shiftNumber: number | null): string {
	return shiftNumber === null
		? t("operations.shift.unmatched")
		: t("operations.shift", { number: shiftNumber });
}

export function actorName(
	t: Translate,
	actors: Actors | undefined,
	userId: string | null,
): string | null {
	if (userId === null) return null;
	if (actors === undefined) return t("operations.actor.unknown");
	if (userId === actors.currentUserId) return t("operations.actor.you");
	const actor = actors.byId.get(userId);
	if (actor?.name) return actor.name;
	if (actor?.role) return t(ROLE_KEYS[actor.role]);
	return t("operations.actor.unknown");
}

export function moment(
	formatters: Formatters,
	instant: string | null,
	timeZone: string,
): string | null {
	if (instant === null) return null;
	const date = new Date(instant);
	const day = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
	return `${formatters.date(day)} ${formatters.time(date)}`;
}

export function cashReasons(t: Translate, row: CashCountRow): string | null {
	const reasons = [
		row.overAbs ? t("operations.cashReason.absolute") : null,
		row.overRel ? t("operations.cashReason.relative") : null,
		row.overZ ? t("operations.cashReason.zScore") : null,
	].filter((reason) => reason !== null);
	return reasons.length === 0 ? null : reasons.join(", ");
}

export function storeNameOf(
	stores: readonly { readonly id: string; readonly name: string }[],
	storeId: string,
): string {
	return stores.find((store) => store.id === storeId)?.name ?? storeId;
}

export function slugText(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function operationsCsvName(
	page: string,
	card: string,
	from: string,
	to: string,
): string {
	return `${slugText(`${page}-${card}-${from}_${to}`)}.csv`;
}
