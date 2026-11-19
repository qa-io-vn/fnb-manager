import { useT } from "../../i18n";
import { useOperationsSource } from "../../operations/queries";
import { staffPageAccess } from "../../settings/access";
import { ChecklistSettings } from "../../settings/checklists/checklist-list";
import { useMembership } from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import { useReadyTenantScope } from "../../state/tenant-scope";

function ChecklistBody() {
	const t = useT();
	const operations = useOperationsSource();
	const membership = useMembership();
	const member = membership.status === "success" ? membership.data : undefined;
	const access =
		membership.status === "error"
			? { canWrite: false, reason: "unavailable" as const }
			: staffPageAccess(member);
	if (operations.status === "unavailable") {
		return (
			<div className="space-y-4" data-testid="checklist-page">
				<p
					role="note"
					className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="checklist-demo"
				>
					{t("settings.checklists.demo")}
				</p>
			</div>
		);
	}
	return (
		<div className="space-y-4" data-testid="checklist-page">
			<p className="text-sm text-ink-muted" data-testid="checklist-intro">
				{t("settings.checklists.intro")}
			</p>
			<ReadOnlyNotice
				access={access}
				messages={{ role: "settings.checklists.readOnly.role" }}
			/>
			{access.canWrite ? <ChecklistSettings /> : null}
		</div>
	);
}

export default function ChecklistPage() {
	const { tenant } = useReadyTenantScope();
	return <ChecklistBody key={tenant.id} />;
}
