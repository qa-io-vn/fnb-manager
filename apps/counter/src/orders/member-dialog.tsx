import { useI18n } from "@fnb/zalo-mini/i18n";
import { useState } from "react";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { clockOf } from "../lib/time";
import { CameraScanner, hasBarcodeDetector } from "../shift/qr-scan";
import { Dialog } from "../ui/dialog";
import { QrIcon } from "../ui/icons";
import { button, field, PlainNote } from "../ui/kit";
import {
	type AttachAnswer,
	attachMember,
	groupedNumber,
	lookupMember,
	type MemberSummary,
	readMemberCode,
	shortName,
	stampUnits,
} from "./member";
import type { Order } from "./types";

/** A card found for a draft ticket: the code (in memory only) and what the counter may see of its holder. */
export interface PickedMember {
	readonly code: string;
	readonly member: MemberSummary;
}

type Found = { readonly code: string; readonly member: MemberSummary };

/** The words of a lookup or attach refusal, with the unlock time of a lock. */
function refusalText(
	t: (key: string, params?: Record<string, string | number>) => string,
	refusal: string | null,
	retryAt: string | undefined,
): string {
	if (refusal === "rate_limited" && retryAt !== undefined)
		return t("member.refusal.rate_limited", { time: clockOf(retryAt) });
	return t(`member.refusal.${refusal ?? "failed"}`);
}

/**
 * Q01 "Quét mã thành viên": the camera reads the customer's QR where the browser can (BarcodeDetector), otherwise the
 * 8 digits are typed; the number's check digit is tested here first. The answer shows only the shortened name and the
 * stamps. With an order, "Gắn vào đơn" attaches the card (counter_attach_member with the version seen); for a ticket
 * not yet sent, "Dùng thẻ này" hands the code back to be attached once the order exists.
 */
export function MemberDialog({
	store,
	order,
	drinks,
	onClose,
	onAttached,
	onPicked,
}: {
	readonly store: string;
	/** the order to attach to; null for a ticket not yet sent */
	readonly order: Order | null;
	/** the drinks of the ticket, when there is no order yet */
	readonly drinks?: number;
	readonly onClose: () => void;
	readonly onAttached?: (answer: AttachAnswer) => void;
	readonly onPicked?: (picked: PickedMember) => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const [typed, setTyped] = useState("");
	const [scanning, setScanning] = useState(false);
	const [found, setFound] = useState<Found | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const read = readMemberCode(typed);
	const typedProblem =
		typed.trim() === "" || read.ok
			? null
			: read.problem === "too_short"
				? null
				: read.problem;
	const units = order === null ? (drinks ?? 0) : stampUnits(order);
	const camera = hasBarcodeDetector();

	const check = async (code: string) => {
		setBusy(true);
		setMessage(null);
		setFound(null);
		try {
			const answer = await lookupMember(client, store, code);
			if (answer.state === "found") setFound({ code, member: answer.member });
			else
				setMessage(
					refusalText(t, answer.refusal, answer.retry_at ?? undefined),
				);
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.network
						? "common.network"
						: error instanceof RpcError && error.code === "22023"
							? "member.refusal.code_mistyped"
							: error instanceof RpcError && error.forbidden
								? "common.forbidden"
								: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};

	const onScanned = (text: string) => {
		setScanning(false);
		const scanned = readMemberCode(text);
		if (!scanned.ok) {
			setMessage(t("member.notMemberCode"));
			return;
		}
		void check(scanned.code);
	};

	const attach = async () => {
		if (found === null) return;
		if (order === null) {
			onPicked?.({ code: found.code, member: found.member });
			return;
		}
		setBusy(true);
		setMessage(null);
		try {
			const answer = await attachMember(client, order, found.code);
			if (answer.state === "attached") {
				onAttached?.(answer);
				return;
			}
			setMessage(
				answer.state === "conflict"
					? t("order.conflict")
					: refusalText(t, answer.refusal, answer.retry_at),
			);
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.network
						? "common.network"
						: error instanceof RpcError && error.forbidden
							? "order.unknown"
							: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};

	const name = found === null ? null : shortName(found.member.name);
	return (
		<Dialog
			title={t("member.title")}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="member-dialog"
			footer={
				<>
					<button
						type="button"
						className={button.secondary}
						onClick={onClose}
						disabled={busy}
					>
						{t("common.close")}
					</button>
					<button
						type="button"
						className={button.primary}
						disabled={found === null || busy}
						onClick={() => void attach()}
						data-testid="member-attach"
					>
						{order === null
							? t("member.useForTicket")
							: t("member.attachTo", { order: order.display_no ?? "" })}
					</button>
				</>
			}
		>
			<div className="grid gap-4 md:grid-cols-2">
				<div className="flex flex-col gap-3">
					{camera ? (
						scanning ? (
							<CameraScanner
								onCode={onScanned}
								failedText={t("member.noCamera")}
								label={t("member.cameraLabel")}
							/>
						) : (
							<button
								type="button"
								className={button.secondary}
								onClick={() => setScanning(true)}
								data-testid="member-scan"
							>
								<QrIcon />
								{t("member.scan")}
							</button>
						)
					) : (
						<p
							className="text-sm text-ink-muted"
							data-testid="member-no-camera"
						>
							{t("member.typeOnly")}
						</p>
					)}
				</div>
				<div className="flex flex-col gap-3">
					<label className="flex flex-col gap-1">
						<span className="font-bold">{t("member.numberLabel")}</span>
						<input
							className={`${field} font-mono text-2xl tracking-[0.2em]`}
							inputMode="numeric"
							autoComplete="off"
							spellCheck={false}
							maxLength={12}
							value={typed}
							aria-invalid={typedProblem !== null}
							aria-describedby="member-number-hint"
							onChange={(event) => {
								setTyped(groupedNumber(event.target.value));
								setFound(null);
								setMessage(null);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter" && read.ok && !busy)
									void check(read.code);
							}}
							data-testid="member-number"
							data-autofocus
						/>
						<span
							id="member-number-hint"
							className="text-sm text-ink-muted"
							data-testid="member-number-hint"
						>
							{typedProblem === null
								? t("member.numberHint")
								: t(`member.problem.${typedProblem}`)}
						</span>
					</label>
					<button
						type="button"
						className={button.secondary}
						disabled={!read.ok || busy}
						onClick={() => {
							if (read.ok) void check(read.code);
						}}
						data-testid="member-check"
					>
						{t("member.check")}
					</button>
					<p className="text-sm text-ink-muted">{t("member.privacy")}</p>
				</div>
			</div>
			{found === null ? null : (
				<div
					className="mt-4 rounded-card-xl bg-positive-soft p-4"
					role="status"
					data-testid="member-found"
				>
					<p className="font-extrabold" data-testid="member-name">
						{name === null
							? t("member.foundNoName")
							: t("member.found", { name })}
					</p>
					<p className="text-body" data-testid="member-stamps">
						{t("member.stamps", {
							stamps: found.member.stamps,
							total: found.member.stamps_per_reward,
						})}
						{found.member.rewards_available > 0
							? ` ${t("member.rewards", { count: found.member.rewards_available })}`
							: ""}
						{units > 0 ? ` ${t("member.willEarn", { count: units })}` : ""}
					</p>
				</div>
			)}
			{message === null ? null : (
				<div className="mt-4">
					<PlainNote tone="negative" testId="member-message">
						{message}
					</PlainNote>
				</div>
			)}
		</Dialog>
	);
}
