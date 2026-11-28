import { useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOrdering } from "./ordering-data";
import { BellIcon } from "./parts";

// C01's PageActions (design spec 3.3 and C01): a row under the native header with the bell, 44 × 44, which opens C12;
// its badge counts the unread items (customer_inbox_unread), read when the screen shows, every minute while it stays,
// and when the app comes back to the foreground. The count is said in the bell's name ("Thông báo, 2 chưa đọc"), so
// the drawn badge is hidden from assistive technology. The badge is drawn at 12 px, the smallest text the screens
// allow (the design draws 11).

const UNREAD_POLL_MS = 60_000;

/** How many of the customer's inbox items are unread; null until the first answer. */
export function useInboxUnread(): number | null {
	const { client } = useOrdering();
	const [unread, setUnread] = useState<number | null>(null);
	const read = useCallback(() => {
		if (client === null) return;
		client.inboxUnread().then(
			(answer) => setUnread(answer.unread),
			() => undefined,
		);
	}, [client]);
	useEffect(() => {
		read();
		const timer = setInterval(read, UNREAD_POLL_MS);
		const onVisible = () => {
			if (document.visibilityState === "visible") read();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [read]);
	return unread;
}

/** The badge's text: the count, 99+ above 99. */
export function badgeText(count: number): string {
	return count > 99 ? "99+" : String(count);
}

export function PageActions() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const unread = useInboxUnread();
	const count = unread ?? 0;
	return (
		<div
			className="flex h-12 items-center justify-end"
			data-testid="page-actions"
		>
			<button
				type="button"
				onClick={() => navigate("/thong-bao")}
				aria-label={
					count > 0 ? t("inbox.bell", { count }) : t("inbox.bellNone")
				}
				className="relative inline-flex size-11 items-center justify-center rounded-control text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				data-testid="inbox-bell"
				data-unread={count}
			>
				<BellIcon />
				{count > 0 ? (
					<span
						aria-hidden="true"
						className="absolute top-0.5 right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-badge px-1 text-[12px] leading-none font-bold text-badge-ink"
						data-testid="inbox-bell-badge"
					>
						{badgeText(count)}
					</span>
				) : null}
			</button>
		</div>
	);
}
