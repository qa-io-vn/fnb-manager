import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import { type LoyaltyAccess, loyaltyReadAccess } from "../../loyalty/access";
import { useCustomerSource } from "../../loyalty/queries";
import {
	CUSTOMER_PAGES,
	CUSTOMER_TAB_KEYS,
	type CustomerPage,
	customerHref,
	PRIVACY_PAGES,
} from "../../loyalty/route";
import type { CustomerSource } from "../../loyalty/source";
import { privacyAccess } from "../../privacy/access";
import { useMembership } from "../../settings/queries";
import { useRetrySettingsSource } from "../../settings/settings-source-context";
import { PageHeading } from "../../shell/page-heading";
import { StatusMessage } from "../../shell/scope-status";

function CustomerTabs({
	current,
	pages,
}: {
	readonly current: CustomerPage;
	readonly pages: readonly CustomerPage[];
}) {
	const t = useT();
	const active = useRef<HTMLAnchorElement | null>(null);
	useEffect(() => {
		active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, []);
	return (
		<nav
			aria-label={t("loyalty.tabs")}
			className="print:hidden"
			data-testid="loyalty-tabs"
		>
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1">
				{pages.map((page) => {
					const isCurrent = page === current;
					return (
						<li key={page} className="shrink-0">
							<Link
								ref={isCurrent ? active : undefined}
								to={customerHref(page)}
								aria-current={isCurrent ? "page" : undefined}
								className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
							>
								{t(CUSTOMER_TAB_KEYS[page])}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

export function Notice({
	testId,
	children,
}: {
	readonly testId: string;
	readonly children: ReactNode;
}) {
	return (
		<p
			role="note"
			className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
			data-testid={testId}
		>
			{children}
		</p>
	);
}

function Failed({ onRetry }: { readonly onRetry: () => void }) {
	const t = useT();
	return (
		<StatusMessage>
			<p role="alert" className="mb-3">
				{t("app.error")}
			</p>
			<Button type="button" onClick={onRetry}>
				{t("app.retry")}
			</Button>
		</StatusMessage>
	);
}

export interface CustomerContext {
	readonly access: LoyaltyAccess;
	readonly source: CustomerSource;
}

export function CustomersLayout({
	page,
	subtitle,
	children,
	withoutCustomerData,
}: {
	readonly page: CustomerPage;
	readonly subtitle?: string;
	readonly children: (context: CustomerContext) => ReactNode;
	/** What a page still shows below the demo explanation, from data the demo has. */
	readonly withoutCustomerData?: (access: LoyaltyAccess) => ReactNode;
}) {
	const t = useT();
	const source = useCustomerSource();
	const membership = useMembership();
	const retrySource = useRetrySettingsSource();
	const member = membership.status === "success" ? membership.data : undefined;
	const access = loyaltyReadAccess(member);
	const handlesPrivacy = privacyAccess(member).canHandle;
	const pages = CUSTOMER_PAGES.filter(
		(candidate) => handlesPrivacy || !PRIVACY_PAGES.includes(candidate),
	);
	const title = [
		t("loyalty.title"),
		subtitle ?? t(CUSTOMER_TAB_KEYS[page]),
	].join(" · ");
	let body: ReactNode;
	if (source.status === "unavailable") {
		body = (
			<>
				<Notice testId="loyalty-demo">{t("loyalty.demo")}</Notice>
				{withoutCustomerData !== undefined &&
				membership.status === "success" &&
				access.canRead
					? withoutCustomerData(access)
					: null}
			</>
		);
	} else if (source.status === "failed") {
		body = <Failed onRetry={retrySource} />;
	} else if (membership.status === "error") {
		body = <Failed onRetry={() => void membership.refetch()} />;
	} else if (source.status === "loading" || membership.status === "pending") {
		body = <p role="status">{t("app.loading")}</p>;
	} else if (!access.canRead) {
		body = (
			<Notice testId="loyalty-no-access">{t("loyalty.readOnly.role")}</Notice>
		);
	} else {
		body = children({ access, source: source.source });
	}
	return (
		<div className="space-y-4" data-testid="loyalty-page" data-page={page}>
			<PageHeading title={title} className="text-2xl font-semibold" />
			<CustomerTabs current={page} pages={pages} />
			{source.status === "unavailable" ? null : (
				<p className="text-sm text-ink-muted print:hidden">
					{t("loyalty.intro")}
				</p>
			)}
			{body}
		</div>
	);
}
