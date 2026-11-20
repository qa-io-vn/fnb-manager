import type { ComponentType } from "react";
import { LoyaltyQueueScreen } from "../approvals/loyalty-queue";
import { MyRequestsScreen } from "../approvals/my-requests";
import { BillQueueScreen } from "../bills/bill-queue";
import { BillsScreen } from "../bills/bill-screen";
import { CounterScreen } from "../bills/counter-screen";
import { CheckInScreen } from "../check-in/check-in-screen";
import { MemberLookupScreen } from "../member-lookup/member-lookup-screen";
import { RedemptionScreen } from "../redemption/redemption-screen";
import { LOYALTY_PATHS, type LoyaltyPath } from "./env";
import { LoyaltyRoute, type LoyaltyScreenProps } from "./route";

interface LoyaltyPageEntry {
	readonly titleKey: string;
	readonly testId: string;
	readonly screen: ComponentType<LoyaltyScreenProps>;
}

const PAGES: Readonly<Record<LoyaltyPath, LoyaltyPageEntry>> = {
	[LOYALTY_PATHS.checkIn]: {
		titleKey: "checkin.title",
		testId: "check-in",
		screen: CheckInScreen,
	},
	[LOYALTY_PATHS.redeem]: {
		titleKey: "redeem.title",
		testId: "redemption",
		screen: RedemptionScreen,
	},
	[LOYALTY_PATHS.lookup]: {
		titleKey: "lookup.title",
		testId: "member-lookup",
		screen: MemberLookupScreen,
	},
	[LOYALTY_PATHS.queue]: {
		titleKey: "queue.title",
		testId: "loyalty-queue",
		screen: LoyaltyQueueScreen,
	},
	[LOYALTY_PATHS.requests]: {
		titleKey: "requests.title",
		testId: "my-requests",
		screen: MyRequestsScreen,
	},
	[LOYALTY_PATHS.bills]: {
		titleKey: "bills.title",
		testId: "bills",
		screen: BillsScreen,
	},
	[LOYALTY_PATHS.counter]: {
		titleKey: "counter.title",
		testId: "counter",
		screen: CounterScreen,
	},
	[LOYALTY_PATHS.billQueue]: {
		titleKey: "billQueue.title",
		testId: "bill-queue",
		screen: BillQueueScreen,
	},
};

/**
 * The till screens as one lazily loaded chunk: only a member who opens the
 * check-in, redemption, lookup, queue or staff-mode bill screens pays for
 * them and their sources (the counter QR encoder among them).
 */
export default function LoyaltyPage({ path }: { readonly path: LoyaltyPath }) {
	const entry = PAGES[path];
	return (
		<LoyaltyRoute
			titleKey={entry.titleKey}
			testId={entry.testId}
			screen={entry.screen}
		/>
	);
}
