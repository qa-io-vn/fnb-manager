import type { PaymentMode, TransferQr } from "@fnb/zalo-mini/ordering";
import { kitButton, PriceText, useI18n } from "@fnb/zalo-mini/react";
import { useState } from "react";
import { useNow } from "../data/use-now";
import { QrCode } from "../wallet/qr";
import { Panel } from "./parts";
import { countdown } from "./payment-step";

// The in-app VietQR of a bank transfer (shown outside Zalo, or when Zalo's QR popup is not there or was closed): the
// code, the amount, the bank, the account and its name, and the reference with copy buttons, and the time the code
// still holds. The customer's bank pays; the server learns it from the bank's notification, and only then the order.

async function copyText(text: string): Promise<boolean> {
	try {
		if (typeof navigator === "undefined" || navigator.clipboard === undefined)
			return false;
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

function CopyRow({
	label,
	value,
	field,
	mono = false,
}: {
	readonly label: string;
	readonly value: string;
	readonly field: string;
	readonly mono?: boolean;
}) {
	const { t } = useI18n();
	const [copied, setCopied] = useState(false);
	return (
		<div
			className="flex items-center justify-between gap-3"
			data-testid={`transfer-${field}`}
		>
			<dl className="min-w-0">
				<dt className="text-[13px] text-ink-muted">{label}</dt>
				<dd
					className={`text-[15px] font-bold text-ink break-all ${mono ? "tracking-wider" : ""}`}
					data-testid={`transfer-${field}-value`}
				>
					{value}
				</dd>
			</dl>
			<button
				type="button"
				className={`${kitButton.quiet} shrink-0`}
				aria-label={t("transfer.copyLabel", { field: label })}
				onClick={() => {
					void copyText(value).then(setCopied);
				}}
				data-testid={`transfer-copy-${field}`}
			>
				{copied ? t("transfer.copied") : t("transfer.copy")}
			</button>
		</div>
	);
}

export function TransferPanel({
	qr,
	expiresAt,
	mode,
	claimed,
}: {
	readonly qr: TransferQr;
	readonly expiresAt: string;
	readonly mode: PaymentMode;
	readonly claimed: boolean;
}) {
	const { t } = useI18n();
	const now = useNow(1000);
	const expired = Date.parse(expiresAt) <= now;
	return (
		<div className="flex flex-col gap-4" data-testid="transfer">
			<p
				role="status"
				className="text-body text-ink"
				data-testid="transfer-status"
			>
				{claimed ? t("transfer.claimed") : t("transfer.waiting")}
			</p>
			<Panel testId="transfer-card" className="items-center">
				<p className="text-body text-ink">{t("transfer.lead")}</p>
				<QrCode
					payload={qr.payload}
					label={t("transfer.qrLabel")}
					dimmed={expired}
					testId="transfer-qr"
				/>
				<p
					className="text-[13px] font-bold text-ink"
					data-testid="transfer-countdown"
					data-expired={expired}
				>
					{expired
						? t("transfer.expired")
						: t("transfer.expiresIn", { time: countdown(expiresAt, now) })}
				</p>
				{mode === "sandbox" ? (
					<p className="text-[13px] text-ink" data-testid="transfer-sandbox">
						{t("transfer.sandbox")}
					</p>
				) : null}
			</Panel>
			<Panel testId="transfer-details">
				<div className="flex items-center justify-between gap-3">
					<span className="text-[13px] text-ink-muted">
						{t("paystep.amount")}
					</span>
					<PriceText amount={qr.amount} size="lead" testId="transfer-amount" />
				</div>
				<div data-testid="transfer-bank">
					<p className="text-[13px] text-ink-muted">{t("transfer.bank")}</p>
					<p className="text-[15px] font-bold text-ink">{qr.bankName}</p>
				</div>
				<CopyRow
					label={t("transfer.account")}
					value={qr.accountNumber}
					field="account"
					mono
				/>
				<div data-testid="transfer-name">
					<p className="text-[13px] text-ink-muted">
						{t("transfer.accountName")}
					</p>
					<p className="text-[15px] font-bold text-ink">{qr.accountName}</p>
				</div>
				<CopyRow
					label={t("transfer.reference")}
					value={qr.reference}
					field="reference"
					mono
				/>
				<p className="text-[13px] text-ink">{t("transfer.exact")}</p>
			</Panel>
		</div>
	);
}
