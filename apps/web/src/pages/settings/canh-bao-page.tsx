import { useT } from "../../i18n";
import { settingsAccess } from "../../settings/access";
import { Note } from "../../settings/notify/common";
import { DestinationsSection } from "../../settings/notify/destinations-section";
import { useInstantFormatter } from "../../settings/notify/format";
import { HistorySection } from "../../settings/notify/history-section";
import { PoliciesSection } from "../../settings/notify/policies-section";
import {
	useNotifyOverview,
	useNotifySource,
	useRuleCatalogue,
} from "../../settings/notify/queries";
import { RulesSection } from "../../settings/notify/rules-section";
import { StatusSection } from "../../settings/notify/status-section";
import { useMembership, useStoreProfiles } from "../../settings/queries";
import { useRetrySettingsSource } from "../../settings/settings-source-context";
import { useReadyTenantScope } from "../../state/tenant-scope";

function CanhBaoBody() {
	const t = useT();
	const { tenant, stores } = useReadyTenantScope();
	const { source, failed } = useNotifySource();
	const retrySource = useRetrySettingsSource();
	const membership = useMembership();
	const member = membership.status === "success" ? membership.data : undefined;
	const overview = useNotifyOverview(source);
	const catalogue = useRuleCatalogue(source);
	const profiles = useStoreProfiles();
	const formatInstant = useInstantFormatter(tenant.timeZone);
	const rulesAccess = settingsAccess("alertRules", member);
	const unlimitedOwner = rulesAccess.canWrite;
	const unlimitedManager =
		member != null &&
		(member.role === "owner" || member.role === "manager") &&
		member.storeIds === null;
	const retry = () => {
		if (failed) retrySource();
		void overview.refetch();
	};
	const myDestination =
		overview.data?.destinations.find(
			(row) => row.mine && row.status !== "disabled",
		) ?? null;
	const storesWithoutHours =
		profiles.data?.some((profile) => profile.openingHours === null) ?? false;
	const ruleKeys = catalogue.data?.map((rule) => rule.ruleKey) ?? [];
	const publisher = member?.role === "publisher";
	return (
		<div className="min-w-0 space-y-6" data-testid="canh-bao-page">
			<p className="text-sm text-ink-muted">{t("settings.notify.intro")}</p>
			{source?.kind === "demo" ? (
				<Note testId="notify-demo">{t("settings.notify.demo")}</Note>
			) : null}
			{publisher ? (
				<Note testId="notify-publisher">
					{t("settings.notify.error.forbidden")}
				</Note>
			) : (
				<>
					<StatusSection
						overview={overview.data}
						failed={failed || overview.isError}
						onRetry={retry}
						now={Date.now()}
					/>
					<DestinationsSection
						source={source}
						overview={overview.data}
						failed={failed || overview.isError}
						onRetry={retry}
						unlimitedOwner={unlimitedOwner}
						unlimitedManager={unlimitedManager}
						tenantName={tenant.name}
						formatTime={formatInstant}
						ruleKeys={ruleKeys}
					/>
					{member != null &&
					(member.role === "owner" || member.role === "manager") ? (
						<>
							<RulesSection
								source={source}
								failed={failed}
								onRetry={retry}
								canEdit={unlimitedOwner}
								stores={stores}
								storesWithoutHours={storesWithoutHours}
								myDestination={myDestination}
							/>
							<PoliciesSection
								source={source}
								failed={failed}
								onRetry={retry}
								canEdit={unlimitedOwner}
							/>
							<HistorySection
								source={source}
								stores={stores}
								unlimitedManager={unlimitedManager}
								formatInstant={formatInstant}
							/>
						</>
					) : null}
				</>
			)}
		</div>
	);
}

export default function CanhBaoPage() {
	const { tenant } = useReadyTenantScope();
	return <CanhBaoBody key={tenant.id} />;
}
