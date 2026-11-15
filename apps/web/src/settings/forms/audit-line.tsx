import { type MessageKey, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import type { TenantRole } from "../source";

export type AuditAuthor =
	| { readonly kind: "you" }
	| { readonly kind: "member"; readonly role: TenantRole }
	| { readonly kind: "unknown" };

export interface AuditEntry {
	readonly changedAt: string;
	readonly author: AuditAuthor;
}

export interface MemberRoleRow {
	readonly userId: string;
	readonly role: TenantRole;
}

export const ROLE_KEYS: Readonly<Record<TenantRole, MessageKey>> = {
	owner: "settings.role.owner",
	manager: "settings.role.manager",
	staff: "settings.role.staff",
	viewer: "settings.role.viewer",
	publisher: "settings.role.publisher",
};

export function auditAuthorOf(
	updatedBy: string | null,
	currentUserId: string | null,
	members: readonly MemberRoleRow[],
): AuditAuthor {
	if (updatedBy === null) return { kind: "unknown" };
	if (updatedBy === currentUserId) return { kind: "you" };
	const member = members.find((row) => row.userId === updatedBy);
	return member === undefined
		? { kind: "unknown" }
		: { kind: "member", role: member.role };
}

export interface AuditLineProps {
	readonly entry: AuditEntry | null;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly neverText?: string;
}

export function AuditLine({
	entry,
	formatters,
	timeZone,
	neverText,
}: AuditLineProps) {
	const t = useT();
	let text: string;
	if (entry === null) {
		text = neverText ?? t("settings.audit.never");
	} else {
		const instant = new Date(entry.changedAt);
		const when = t("settings.audit.when", {
			date: formatters.date(todayIn(timeZone, instant)),
			time: formatters.time(instant),
		});
		const { author } = entry;
		if (author.kind === "you") {
			text = t("settings.audit.byYou", { when });
		} else if (author.kind === "member") {
			text = t("settings.audit.byRole", {
				when,
				role: t(ROLE_KEYS[author.role]),
			});
		} else {
			text = t("settings.audit.at", { when });
		}
	}
	return (
		<p className="text-xs text-ink-muted" data-testid="settings-audit-line">
			{text}
		</p>
	);
}
