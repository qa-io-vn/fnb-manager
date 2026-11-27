import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup, StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { query, RpcError, rpc } from "../lib/rpc";
import { useMember, useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { dayAndClock } from "../lib/time";
import { Dialog } from "../ui/dialog";
import { LockIcon, PlusIcon } from "../ui/icons";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";

interface RosterRow {
	readonly id: string;
	readonly display_name: string;
	readonly role: "staff" | "manager";
	readonly store_ids: readonly string[] | null;
	readonly status: "invited" | "active" | "inactive";
	readonly user_id: string | null;
	readonly paired_at: string | null;
	readonly deactivated_at: string | null;
}

interface BlockedSignin {
	readonly id: string;
	readonly display_name: string | null;
	readonly device: string | null;
	readonly attempts: number;
	readonly last_at: string;
	readonly version: number;
}

/** The roster rows a manager sees, by status: the person's own row marked, the locked ones last. */
export function rosterOrder(rows: readonly RosterRow[]): RosterRow[] {
	const rank = { active: 0, invited: 1, inactive: 2 } as const;
	return [...rows].sort(
		(a, b) =>
			rank[a.status] - rank[b.status] ||
			a.display_name.localeCompare(b.display_name),
	);
}

function CodeDialog({
	name,
	code,
	onClose,
}: {
	readonly name: string;
	readonly code: string;
	readonly onClose: () => void;
}) {
	const { t } = useI18n();
	return (
		<Dialog
			title={t("staff.codeTitle", { name })}
			onClose={onClose}
			closeLabel={t("common.close")}
			size="sm"
			testId="pairing-code-dialog"
		>
			<p
				className="text-center font-mono text-5xl font-extrabold tracking-[0.3em]"
				data-testid="pairing-code-value"
			>
				{code}
			</p>
			<p className="pt-3 text-body">{t("staff.codeLead")}</p>
		</Dialog>
	);
}

function PersonDialog({
	title,
	initialName,
	canAddManager,
	onClose,
	onSave,
}: {
	readonly title: string;
	readonly initialName: string;
	readonly canAddManager: boolean;
	readonly onClose: () => void;
	readonly onSave: (name: string, role: "staff" | "manager") => Promise<void>;
}) {
	const { t } = useI18n();
	const [name, setName] = useState(initialName);
	const [role, setRole] = useState<"staff" | "manager">("staff");
	const [busy, setBusy] = useState(false);
	return (
		<Dialog
			title={title}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="person-dialog"
			footer={
				<button
					type="button"
					className={button.primary}
					disabled={busy || name.trim() === ""}
					data-testid="person-save"
					onClick={() => {
						setBusy(true);
						onSave(name.trim(), role).finally(() => setBusy(false));
					}}
				>
					{t("staff.save")}
				</button>
			}
		>
			<div className="flex flex-col gap-3">
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("staff.name")}</span>
					<input
						className={field}
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						data-testid="person-name"
					/>
				</label>
				<div className="-mx-4">
					<ChipGroup
						label={t("staff.role")}
						chips={[
							{ key: "staff", label: t("role.staff") },
							...(canAddManager
								? [{ key: "manager", label: t("role.manager") }]
								: []),
						]}
						selected={role}
						onSelect={(key) => setRole(key === "manager" ? "manager" : "staff")}
					/>
				</div>
				{canAddManager ? null : (
					<p className="text-sm text-ink-muted">
						{t("staff.managerOwnerOnly")}
					</p>
				)}
				<p className="text-sm text-ink-muted">{t("staff.addLead")}</p>
			</div>
		</Dialog>
	);
}

/** M02: who may enter the counter; people blocked at sign-in (acceptance criterion 5); add, lock and unlock. */
export function StaffPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { member, userId } = useMember();
	const { store } = useStore();
	const { show } = useToast();
	const [adding, setAdding] = useState<BlockedSignin | "new" | null>(null);
	const [locking, setLocking] = useState<RosterRow | null>(null);
	const [code, setCode] = useState<{ name: string; code: string } | null>(null);
	const roster = useQuery({
		queryKey: ["roster", member.tenant_id],
		queryFn: () =>
			query<RosterRow[]>(
				client
					.from("staff_roster")
					.select(
						"id, display_name, role, store_ids, status, user_id, paired_at, deactivated_at",
					)
					.eq("tenant_id", member.tenant_id),
			),
	});
	const blocked = useQuery({
		queryKey: ["blocked", member.tenant_id],
		queryFn: () =>
			rpc<{ requests: BlockedSignin[] }>(client, "manager_blocked_signins", {
				p_tenant: member.tenant_id,
			}),
		refetchInterval: 30_000,
	});
	const refresh = async () => {
		await Promise.all([roster.refetch(), blocked.refetch()]);
	};
	const fail = (error: unknown) =>
		show(
			t(
				error instanceof RpcError && error.forbidden
					? "common.forbidden"
					: "common.failed",
			),
		);
	const issue = async (row: { id: string; display_name: string }) => {
		try {
			setCode({
				name: row.display_name,
				code: await rpc<string>(client, "issue_pairing_code", {
					p_roster_id: row.id,
				}),
			});
		} catch (error) {
			fail(error);
		}
	};
	const save = async (name: string, role: "staff" | "manager") => {
		try {
			if (adding === "new") {
				const id = await rpc<string>(client, "add_staff", {
					p_tenant_id: member.tenant_id,
					p_display_name: name,
					p_role: role,
					p_store_ids: [store.id],
				});
				setCode({
					name,
					code: await rpc<string>(client, "issue_pairing_code", {
						p_roster_id: id,
					}),
				});
			} else if (adding !== null) {
				const answer = await rpc<{ state: string; pairing_code?: string }>(
					client,
					"manager_approve_blocked_signin",
					{
						p_request: adding.id,
						p_expected_version: adding.version,
						p_display_name: name,
						p_role: role,
						p_store_ids: [store.id],
					},
				);
				if (answer.state !== "approved" || answer.pairing_code === undefined) {
					show(t("staff.changed"));
				} else {
					setCode({ name, code: answer.pairing_code });
				}
			}
			setAdding(null);
			await refresh();
		} catch (error) {
			fail(error);
		}
	};
	const dismiss = async (row: BlockedSignin) => {
		try {
			await rpc(client, "manager_dismiss_blocked_signin", {
				p_request: row.id,
				p_expected_version: row.version,
			});
			await refresh();
		} catch (error) {
			fail(error);
		}
	};
	const lock = async (row: RosterRow) => {
		try {
			await rpc(client, "deactivate_staff", { p_roster_id: row.id });
			show(t("staff.locked", { name: row.display_name }));
			setLocking(null);
			await refresh();
		} catch (error) {
			fail(error);
		}
	};
	const unlock = async (row: RosterRow) => {
		try {
			await rpc(client, "reactivate_staff", { p_roster_id: row.id });
			await issue(row);
			await refresh();
		} catch (error) {
			fail(error);
		}
	};
	const people = blocked.data?.requests ?? [];
	return (
		<div className="mx-auto flex max-w-4xl flex-col gap-4">
			<PageTitle
				aside={
					<button
						type="button"
						className={button.primary}
						onClick={() => setAdding("new")}
						data-testid="add-staff"
					>
						<PlusIcon />
						{t("staff.add")}
					</button>
				}
			>
				{t("staff.title")}
			</PageTitle>
			{people.length === 0 ? null : (
				<section
					className={`${card} flex flex-col gap-3 border-negative p-5`}
					data-testid="blocked-signins"
				>
					<h2 className="flex items-center gap-2 text-lg font-extrabold">
						<LockIcon />
						{t("staff.blockedTitle", { count: people.length })}
					</h2>
					<p className="text-sm text-ink-muted">{t("staff.blockedLead")}</p>
					<ul className="flex flex-col gap-2">
						{people.map((person) => (
							<li
								key={person.id}
								className="flex flex-wrap items-center gap-2 rounded-card-xl bg-surface-sunken p-3"
								data-testid="blocked-row"
							>
								<div className="min-w-40 flex-1">
									<p className="font-extrabold">
										{person.display_name ?? t("staff.noName")}
									</p>
									<p className="text-sm text-ink-muted">
										{dayAndClock(person.last_at)}
										{person.device === null ? "" : ` · ${person.device}`} ·{" "}
										{t("staff.attempts", { count: person.attempts })}
									</p>
								</div>
								<button
									type="button"
									className={button.primary}
									onClick={() => setAdding(person)}
									data-testid="blocked-add"
								>
									{t("staff.addToList")}
								</button>
								<button
									type="button"
									className={button.secondary}
									onClick={() => void dismiss(person)}
									data-testid="blocked-dismiss"
								>
									{t("staff.dismiss")}
								</button>
							</li>
						))}
					</ul>
					<p className="text-sm text-ink-muted">{t("staff.recognise")}</p>
				</section>
			)}
			{roster.data === undefined ? (
				<Loading label={t("app.loading")} />
			) : (
				<ul
					className={`${card} divide-y divide-line px-4`}
					data-testid="roster"
				>
					{rosterOrder(roster.data).map((row) => {
						const own = row.user_id === userId;
						return (
							<li
								key={row.id}
								className="flex flex-wrap items-center gap-2 py-3"
								data-testid="roster-row"
								data-status={row.status}
							>
								<span className="min-w-40 flex-1 font-extrabold">
									{row.display_name}
									{own ? (
										<span className="pl-1 font-semibold text-ink-muted">
											{t("staff.you")}
										</span>
									) : null}
								</span>
								<StatusPill tone="neutral">{t(`role.${row.role}`)}</StatusPill>
								<StatusPill
									tone={
										row.status === "active"
											? "positive"
											: row.status === "inactive"
												? "negative"
												: "warning"
									}
								>
									{t(`staff.status.${row.status}`)}
								</StatusPill>
								{own ? null : row.status === "active" ? (
									<button
										type="button"
										className={button.danger}
										onClick={() => setLocking(row)}
										data-testid="lock"
									>
										{t("staff.lock")}
									</button>
								) : row.status === "invited" ? (
									<button
										type="button"
										className={button.secondary}
										onClick={() => void issue(row)}
										data-testid="issue-code"
									>
										{t("staff.newCode")}
									</button>
								) : (
									<button
										type="button"
										className={button.secondary}
										onClick={() => void unlock(row)}
										data-testid="unlock"
									>
										{t("staff.unlock")}
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{adding === null ? null : (
				<PersonDialog
					title={adding === "new" ? t("staff.add") : t("staff.addToList")}
					initialName={adding === "new" ? "" : (adding.display_name ?? "")}
					canAddManager={member.role === "owner"}
					onClose={() => setAdding(null)}
					onSave={save}
				/>
			)}
			{locking === null ? null : (
				<Dialog
					title={t("staff.lockTitle", { name: locking.display_name })}
					onClose={() => setLocking(null)}
					closeLabel={t("common.close")}
					size="sm"
					testId="lock-dialog"
					footer={
						<button
							type="button"
							className={button.destructive}
							onClick={() => void lock(locking)}
							data-testid="lock-confirm"
						>
							<LockIcon />
							{t("staff.lockConfirm")}
						</button>
					}
				>
					<ul className="list-disc pl-5 text-body">
						<li>{t("staff.lockOut")}</li>
						<li>{t("staff.lockShift")}</li>
						<li>{t("staff.lockHistory")}</li>
					</ul>
				</Dialog>
			)}
			{code === null ? null : (
				<CodeDialog
					name={code.name}
					code={code.code}
					onClose={() => setCode(null)}
				/>
			)}
			{roster.isError ? (
				<PlainNote tone="negative">{t("common.failed")}</PlainNote>
			) : null}
		</div>
	);
}
