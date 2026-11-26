import { useI18n } from "@fnb/zalo-mini/react";
import { useId } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn } from "../data/dates";
import type { JoinNext } from "../join/model";
import { primaryButton, secondaryButton } from "../ui";
import { type JoinBlock, joinBlock } from "./model";

export function useJoinBlock(): JoinBlock | null {
	const { home } = useCustomerData();
	if (home.status !== "ready") return null;
	return joinBlock(home.data, isoDateIn(Date.now()));
}

export function JoinClosedNote({
	block,
	id,
}: {
	readonly block: JoinBlock;
	readonly id?: string;
}) {
	const { t } = useI18n();
	return (
		<p
			id={id}
			className="rounded-card-xl bg-neutral-soft px-4 py-3 text-body text-ink"
			data-testid="join-closed"
			data-reason={block}
		>
			{t(`join.closed.${block}`)}
		</p>
	);
}

export function JoinActions({
	next = "card",
	claim,
}: {
	readonly next?: JoinNext;
	readonly claim: boolean;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const block = useJoinBlock();
	const noteId = useId();
	const describedBy = block === null ? undefined : noteId;
	return (
		<div className="flex flex-col gap-2">
			{block === null ? null : <JoinClosedNote block={block} id={noteId} />}
			<button
				type="button"
				className={primaryButton}
				disabled={block !== null}
				aria-describedby={describedBy}
				onClick={() =>
					navigate("/tham-gia", next === "card" ? {} : { state: { next } })
				}
			>
				{t("home.join")}
			</button>
			{claim ? (
				<button
					type="button"
					className={secondaryButton}
					disabled={block !== null}
					aria-describedby={describedBy}
					onClick={() => navigate("/tham-gia", { state: { next: "claim" } })}
				>
					{t("home.claim")}
				</button>
			) : null}
		</div>
	);
}
