import { useT } from "../../i18n";
import type { StaffApp, StaffMember } from "./source";
import { brandsOfScope, crossesBrands } from "./staff-rules";

/**
 * One line of a roster row (ADR-049, G-105): the brands the login's stores belong to, and a flag when a staff
 * (cashier) login spans more than one. The scope belongs to the login, not to the app, so the owner reads it here.
 * Shown only for a tenant with two brands or more; with one there is nothing to tell apart.
 */
export function BrandsFact({
	member,
	apps,
}: {
	readonly member: Pick<StaffMember, "role" | "storeIds">;
	readonly apps: readonly StaffApp[] | undefined;
}) {
	const t = useT();
	if (apps === undefined || apps.length < 2) return null;
	const scope = brandsOfScope(member.storeIds, apps);
	const flagged = crossesBrands(member, apps);
	return (
		<>
			<dt className="text-ink-muted">{t("settings.staff.field.brands")}</dt>
			<dd className="break-words" data-testid="staff-brands">
				{scope.all
					? t("settings.staff.brands.all")
					: scope.titles.length === 0
						? t("settings.staff.brands.none")
						: scope.titles.join(", ")}
				{flagged ? (
					<span
						className="mt-1 block rounded-md border border-warning bg-warning-soft px-2 py-1"
						data-testid="staff-brands-flag"
						role="note"
					>
						{t("settings.staff.brands.flag", { count: scope.titles.length })}
					</span>
				) : null}
			</dd>
		</>
	);
}
