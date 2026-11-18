import { useId } from "react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import { useStaffApps, useStoreProfiles } from "../queries";
import { SectionLoadState, useSectionLoad } from "../section-load";
import { QrImage } from "./qr-image";
import { type StoreStaffApps, staffAppsByStore } from "./staff-app-links";

function StoreApps({ entry }: { readonly entry: StoreStaffApps }) {
	const t = useT();
	const { store, entries } = entry;
	return (
		<li
			className="min-w-0 space-y-3 rounded-lg border border-line p-3 print:break-inside-avoid"
			data-testid="staff-app-store"
			data-store-id={store.storeId}
		>
			<h4 className="font-semibold">{store.name}</h4>
			{entries.length === 0 ? (
				<p className="text-sm text-ink-muted" data-testid="staff-app-none">
					{t("settings.staff.app.noApp")}
				</p>
			) : null}
			{entries.map(({ app, link }) => (
				<div
					key={app.brandId}
					className="space-y-2"
					data-testid="staff-app-entry"
					data-mini-app={app.miniAppId}
				>
					<p className="text-sm" data-testid="staff-app-title">
						{t("settings.staff.app.appTitle", { title: app.title })}
					</p>
					{link === null ? (
						<p className="text-sm" data-testid="staff-app-no-code">
							{t("settings.staff.app.noCode")}{" "}
							<TextLink to="/cai-dat/cua-hang" className="print:hidden">
								{t("settings.staff.app.setCode")}
							</TextLink>
						</p>
					) : (
						<>
							<QrImage
								text={link}
								label={t("settings.staff.app.qrLabel", { store: store.name })}
								testId="staff-app-qr"
							/>
							<p
								className="break-all font-mono text-xs"
								data-testid="staff-app-link"
							>
								{link}
							</p>
						</>
					)}
				</div>
			))}
		</li>
	);
}

export function StaffAppSection() {
	const t = useT();
	const headingId = useId();
	const apps = useStaffApps();
	const profiles = useStoreProfiles();
	const load = useSectionLoad([apps, profiles]);
	const byStore =
		apps.data === undefined || profiles.data === undefined
			? undefined
			: staffAppsByStore(profiles.data, apps.data);
	const printable =
		byStore?.some((entry) =>
			entry.entries.some((candidate) => candidate.link !== null),
		) === true;
	return (
		<section
			aria-labelledby={headingId}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised px-4 py-3"
			data-testid="staff-app"
		>
			<h3 id={headingId} className="text-base font-semibold">
				{t("settings.staff.app.title")}
			</h3>
			<p className="text-sm text-ink-muted" data-testid="staff-app-note">
				{t("settings.staff.app.note")}
			</p>
			{byStore === undefined ? (
				<SectionLoadState load={load} failedTestId="staff-app-load-failed" />
			) : apps.data?.length === 0 ? (
				<p className="text-ink-muted" data-testid="staff-app-empty">
					{t("settings.staff.app.empty")}
				</p>
			) : (
				<>
					{printable ? (
						<Button
							tone="secondary"
							size="compact"
							className="print:hidden"
							onClick={() => window.print()}
							data-testid="staff-app-print"
						>
							{t("settings.staff.app.print")}
						</Button>
					) : null}
					<ul
						className="grid gap-3 sm:grid-cols-2"
						data-testid="staff-app-stores"
					>
						{byStore.map((entry) => (
							<StoreApps key={entry.store.storeId} entry={entry} />
						))}
					</ul>
				</>
			)}
		</section>
	);
}
