import { normalizeLoyaltyPhone } from "@fnb/core";
import { type ReactNode, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	csvOfRows,
	displayCell,
} from "../../components/report-card/data-table";
import { TableScroller } from "../../components/report-card/table-scroller";
import type { TableColumn, TableRow } from "../../components/report-card/types";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { textLinkClass } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { downloadTextFile } from "../../lib/csv";
import type { LoyaltyAccess } from "../../loyalty/access";
import {
	lookupPhoneText,
	loyaltyCsvName,
	MEMBERSHIP_STATUS_KEYS,
	memberColumns,
	memberTableRows,
} from "../../loyalty/models";
import { useMemberLookup, useMemberPages } from "../../loyalty/queries";
import { memberHref } from "../../loyalty/route";
import type { MemberRow } from "../../loyalty/source";
import { controlClass, Field } from "../../settings/forms/field";
import { useCsvDialect } from "../../state/csv-dialect";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { CustomersLayout } from "./customers-layout";

function MetricsSlot() {
	const t = useT();
	return (
		<div
			className="space-y-1 rounded-xl border border-dashed border-line bg-surface-raised p-4"
			data-testid="loyalty-metrics-slot"
		>
			<p className="font-medium">{t("loyalty.metrics.slot.title")}</p>
			<p className="text-sm text-ink-muted">{t("loyalty.metrics.slot.body")}</p>
		</div>
	);
}

function LookupResult({ rows }: { readonly rows: readonly MemberRow[] }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	if (rows.length === 0) {
		return (
			<p className="text-sm" data-testid="loyalty-lookup-none">
				{t("loyalty.lookup.none")}
			</p>
		);
	}
	return (
		<ul className="divide-y divide-line" data-testid="loyalty-lookup-results">
			{rows.map((row) => (
				<li
					key={row.membershipId}
					className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
					data-testid="loyalty-lookup-result"
				>
					<span
						className="font-medium tabular-nums"
						data-testid="loyalty-lookup-phone"
					>
						{lookupPhoneText(t, row)}
					</span>
					<span className="text-sm text-ink-muted">
						{t("loyalty.lookup.joined", {
							date: formatters.date(
								todayIn(tenant.timeZone, new Date(row.joinedAt)),
							),
							status: t(MEMBERSHIP_STATUS_KEYS[row.status]),
						})}
					</span>
					<Link
						to={memberHref(row.membershipId)}
						className={cn(textLinkClass, "text-sm")}
						data-testid="loyalty-lookup-open"
					>
						{t("loyalty.lookup.open")}
					</Link>
				</li>
			))}
		</ul>
	);
}

function Lookup({ access }: { readonly access: LoyaltyAccess }) {
	const t = useT();
	const ids = useId();
	const lookup = useMemberLookup();
	const [phone, setPhone] = useState("");
	const [invalid, setInvalid] = useState(false);
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4 print:hidden"
			data-testid="loyalty-lookup"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("loyalty.lookup.title")}
			</h2>
			<p className="text-sm text-ink-muted">
				{t(
					access.seesFullPhone
						? "loyalty.lookup.hintOwner"
						: "loyalty.lookup.hint",
				)}
			</p>
			<form
				className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
				onSubmit={(event) => {
					event.preventDefault();
					const ok = normalizeLoyaltyPhone(phone) !== null;
					setInvalid(!ok);
					if (!ok) {
						lookup.reset();
						return;
					}
					lookup.mutate(phone);
				}}
			>
				<Field
					id={`${ids}-phone`}
					label={t("loyalty.lookup.phone")}
					error={invalid ? t("loyalty.lookup.invalid") : null}
				>
					{(control) => (
						<input
							{...control}
							type="tel"
							inputMode="tel"
							autoComplete="off"
							value={phone}
							onChange={(event) => {
								setPhone(event.target.value);
								setInvalid(false);
							}}
							className={controlClass}
							data-testid="loyalty-lookup-input"
						/>
					)}
				</Field>
				<Button
					type="submit"
					size="compact"
					aria-disabled={lookup.isPending || undefined}
					data-testid="loyalty-lookup-submit"
				>
					{t("loyalty.lookup.submit")}
				</Button>
			</form>
			<div aria-live="polite">
				{lookup.isPending ? (
					<p role="status" className="text-sm text-ink-muted">
						{t("app.loading")}
					</p>
				) : lookup.isError ? (
					<p role="alert" className="text-sm text-negative">
						{t("loyalty.lookup.failed")}
					</p>
				) : lookup.data !== undefined ? (
					<LookupResult rows={lookup.data} />
				) : null}
			</div>
		</section>
	);
}

function MembersTable({
	columns,
	rows,
}: {
	readonly columns: readonly TableColumn[];
	readonly rows: readonly TableRow[];
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const points = (text: string) => t("report.value.points", { value: text });
	return (
		<TableScroller>
			<table className="w-full border-separate border-spacing-0 text-sm">
				<caption className="sr-only">{t("loyalty.members.caption")}</caption>
				<thead>
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								scope="col"
								className={cn(
									"snap-start border-b border-line px-2 py-1.5 font-medium text-ink-muted",
									column.kind === "text" || column.kind === "date"
										? "text-left"
										: "text-right",
								)}
							>
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.length === 0 ? (
						<tr>
							<td colSpan={columns.length} className="px-2 py-3 text-ink-muted">
								{t("loyalty.members.none")}
							</td>
						</tr>
					) : (
						rows.map((row) => (
							<tr key={row.id} data-testid="loyalty-member-row">
								{columns.map((column, index) => {
									const text = displayCell(
										column,
										row.cells[column.key] ?? null,
										formatters,
										points,
									);
									return (
										<td
											key={column.key}
											className={cn(
												"snap-start whitespace-nowrap border-b border-line px-2 py-1.5",
												column.kind === "text" || column.kind === "date"
													? "text-left"
													: "text-right tabular-nums",
												index === 0 ? "min-w-[9rem]" : null,
											)}
										>
											{index === 0 ? (
												<Link
													to={memberHref(row.id)}
													className={textLinkClass}
													aria-label={t("loyalty.members.openLabel", {
														phone: text,
													})}
													data-testid="loyalty-member-open"
												>
													{text}
												</Link>
											) : (
												text
											)}
										</td>
									);
								})}
							</tr>
						))
					)}
				</tbody>
			</table>
		</TableScroller>
	);
}

function MembersList() {
	const t = useT();
	const { tenant, stores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const dialect = useCsvDialect();
	const pages = useMemberPages();
	const members = useMemo(
		() => pages.data?.pages.flatMap((page) => page.rows) ?? [],
		[pages.data],
	);
	const columns = memberColumns(t);
	const rows = memberTableRows(members, {
		t,
		formatters,
		timeZone: tenant.timeZone,
		stores,
	});
	const ids = useId();
	let body: ReactNode;
	if (pages.status === "error" && pages.data === undefined) {
		body = (
			<div
				role="alert"
				className="space-y-2"
				data-testid="loyalty-members-failed"
			>
				<p className="text-sm">{t("report.card.error")}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => void pages.refetch()}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	} else if (pages.data === undefined) {
		body = (
			<p role="status" className="text-sm text-ink-muted">
				{t("app.loading")}
			</p>
		);
	} else {
		body = (
			<>
				<p className="text-sm" data-testid="loyalty-members-count">
					{t(
						pages.hasNextPage
							? "loyalty.members.countMore"
							: "loyalty.members.count",
						{
							count: formatters.count(members.length),
						},
					)}
				</p>
				<MembersTable columns={columns} rows={rows} />
				<div className="flex flex-wrap items-center gap-2">
					{pages.hasNextPage ? (
						<Button
							tone="secondary"
							size="compact"
							aria-disabled={pages.isFetchingNextPage || undefined}
							onClick={
								pages.isFetchingNextPage
									? undefined
									: () => void pages.fetchNextPage()
							}
							data-testid="loyalty-members-more"
						>
							{t(
								pages.isFetchingNextPage
									? "app.loading"
									: "loyalty.members.more",
							)}
						</Button>
					) : null}
					<Button
						tone="secondary"
						size="compact"
						disabled={rows.length === 0}
						aria-label={t("reportCard.downloadCsvOf", {
							table: t("loyalty.members.caption"),
						})}
						onClick={() =>
							downloadTextFile(
								loyaltyCsvName("khach-hang", "thanh-vien"),
								csvOfRows(
									columns,
									rows,
									(label) => t("reportCard.csvPercentHeader", { label }),
									formatters,
									dialect,
								),
								"text/csv;charset=utf-8",
							)
						}
						className="disabled:opacity-60"
						data-testid="loyalty-members-csv"
					>
						{t("reportCard.downloadCsv")}
					</Button>
				</div>
				<p className="text-xs text-ink-muted">
					{t("loyalty.members.scopeNote")}
				</p>
			</>
		);
	}
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="loyalty-members"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("loyalty.members.title")}
			</h2>
			{body}
		</section>
	);
}

export function MembersPage() {
	return (
		<CustomersLayout page="thanh-vien">
			{({ access }) => (
				<div className="space-y-4">
					<Lookup access={access} />
					<MetricsSlot />
					<MembersList />
				</div>
			)}
		</CustomersLayout>
	);
}
