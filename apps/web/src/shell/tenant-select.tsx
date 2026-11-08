import { useId } from "react";
import type { TenantRow } from "../data/row-source";
import { useT } from "../i18n";

export function TenantSelect({
	tenants,
	tenant,
	onChange,
}: {
	tenants: readonly TenantRow[];
	tenant: TenantRow;
	onChange: (tenantId: string) => void;
}) {
	const t = useT();
	const id = useId();
	if (tenants.length < 2) return null;
	return (
		<div className="flex items-center gap-2">
			<label htmlFor={id} className="text-sm text-ink-muted">
				{t("shell.tenant")}
			</label>
			<select
				id={id}
				value={tenant.id}
				onChange={(event) => onChange(event.target.value)}
				className="min-h-11 max-w-48 rounded-lg border border-line bg-surface-raised px-2 text-sm"
			>
				{tenants.map((option) => (
					<option key={option.id} value={option.id}>
						{option.name}
					</option>
				))}
			</select>
		</div>
	);
}
