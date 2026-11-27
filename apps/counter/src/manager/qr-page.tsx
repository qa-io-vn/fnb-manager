import { useI18n } from "@fnb/zalo-mini/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RpcError, rpc } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { counterQr, counterQrAddress } from "../shift/api";
import { PrinterIcon } from "../ui/icons";
import { button, card, Loading, PageTitle, PlainNote } from "../ui/kit";
import { QrCode } from "../ui/qr";
import { useToast } from "../ui/toast";

interface TableLink {
	readonly id: string;
	readonly label: string;
	readonly area: string | null;
	readonly active: boolean;
	readonly qr_version: number;
	readonly token: string | null;
	readonly link: string | null;
}

/** Quản lý → Mã QR: the counter's code for clocking in and each table's ordering code, to print; either can be retired. */
export function QrPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { show } = useToast();
	const [confirm, setConfirm] = useState<string | null>(null);
	const counter = useQuery({
		queryKey: ["counter-qr", store.id],
		queryFn: () => counterQr(client, store.id, false),
	});
	const tables = useQuery({
		queryKey: ["table-qr", store.id],
		queryFn: () =>
			rpc<{ missing: string | null; tables: TableLink[] }>(
				client,
				"table_qr_links",
				{ p_store: store.id },
			),
	});
	const rotateCounter = async () => {
		try {
			await counterQr(client, store.id, true);
			show(t("qr.rotated"));
			await counter.refetch();
		} catch (error) {
			show(
				t(
					error instanceof RpcError && error.forbidden
						? "common.forbidden"
						: "common.failed",
				),
			);
		} finally {
			setConfirm(null);
		}
	};
	const rotateTable = async (id: string) => {
		try {
			await rpc(client, "rotate_table_qr", { p_table: id });
			show(t("qr.rotated"));
			await tables.refetch();
		} catch {
			show(t("common.failed"));
		} finally {
			setConfirm(null);
		}
	};
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<PageTitle
				aside={
					<button
						type="button"
						className={`${button.secondary} print:hidden`}
						onClick={() => window.print()}
					>
						<PrinterIcon />
						{t("qr.print")}
					</button>
				}
			>
				{t("qr.title")}
			</PageTitle>
			<section
				className={`${card} flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:text-left`}
				data-testid="counter-qr"
			>
				{counter.data === undefined ? (
					<Loading label={t("app.loading")} />
				) : (
					<>
						<QrCode
							payload={counterQrAddress(
								window.location.origin,
								counter.data.token,
							)}
							label={t("qr.counterLabel")}
							testId="counter-qr-code"
						/>
						<div className="flex flex-col gap-2">
							<h2 className="text-xl font-extrabold">{t("qr.counterTitle")}</h2>
							<p className="text-body text-ink-muted">{t("qr.counterLead")}</p>
							<p
								className="font-mono text-lg font-bold break-all"
								data-testid="counter-qr-token"
							>
								{counter.data.token}
							</p>
							<button
								type="button"
								className={`${button.danger} print:hidden`}
								onClick={() => setConfirm("counter")}
								data-testid="rotate-counter"
							>
								{confirm === "counter" ? t("qr.confirmRotate") : t("qr.rotate")}
							</button>
							{confirm === "counter" ? (
								<button
									type="button"
									className={button.destructive}
									onClick={() => void rotateCounter()}
									data-testid="rotate-counter-confirm"
								>
									{t("qr.rotateNow")}
								</button>
							) : null}
						</div>
					</>
				)}
			</section>
			<section className="flex flex-col gap-3">
				<h2 className="text-lg font-extrabold">{t("qr.tablesTitle")}</h2>
				{tables.data?.missing ? (
					<PlainNote tone="warning">{t("qr.missing")}</PlainNote>
				) : null}
				<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{(tables.data?.tables ?? [])
						.filter((table) => table.active)
						.map((table) => (
							<li
								key={table.id}
								className={`${card} flex flex-col items-center gap-2 p-4 text-center break-inside-avoid`}
								data-testid="table-qr"
							>
								<p className="text-lg font-extrabold">{table.label}</p>
								{table.link === null ? (
									<PlainNote>{t("qr.noLink")}</PlainNote>
								) : (
									<QrCode
										payload={table.link}
										label={t("qr.tableLabel", { table: table.label })}
										size={160}
									/>
								)}
								<button
									type="button"
									className={`${button.quiet} print:hidden`}
									onClick={() =>
										confirm === table.id
											? void rotateTable(table.id)
											: setConfirm(table.id)
									}
								>
									{confirm === table.id ? t("qr.rotateNow") : t("qr.rotate")}
								</button>
							</li>
						))}
				</ul>
			</section>
		</div>
	);
}
