import config from "virtual:counter-config";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { type ReactNode, useEffect, useState } from "react";
import { clockOf } from "../lib/time";
import type { Member } from "../lib/zalo-login";
import { LogoutIcon } from "../ui/icons";

function Mark() {
	const { language } = useI18n();
	const wordmark = config.theme?.wordmark ?? null;
	const title = language === "en" ? config.title.en : config.title.vi;
	return (
		<div className="flex min-w-0 items-center gap-2.5">
			{wordmark === null ? null : (
				<span
					aria-hidden="true"
					className="flex size-9 shrink-0 items-center justify-center rounded-tile text-sm font-black"
					style={{
						background: "var(--brand-hero, var(--accent))",
						color: "var(--brand-hero-ink, var(--accent-ink))",
					}}
				>
					{[...wordmark].slice(0, 2).join("")}
				</span>
			)}
			<span className="truncate text-lg font-extrabold">{title}</span>
		</div>
	);
}

function Clock() {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 15_000);
		return () => clearInterval(timer);
	}, []);
	return (
		<time
			className="hidden text-base font-bold tabular-nums lg:block"
			dateTime={now.toISOString()}
			data-testid="clock"
		>
			{clockOf(now)}
		</time>
	);
}

function AccountMenu({
	member,
	onSignOut,
}: {
	readonly member: Member;
	readonly onSignOut: () => void;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const initial = [...member.display_name.trim()][0]?.toUpperCase() ?? "?";
	return (
		<div className="relative">
			<button
				type="button"
				aria-expanded={open}
				aria-haspopup="menu"
				onClick={() => setOpen((value) => !value)}
				data-testid="account"
				className="flex min-h-11 items-center gap-2 rounded-control px-1.5 focus-visible:outline-2 focus-visible:outline-focus"
			>
				<span
					aria-hidden="true"
					className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink"
				>
					{initial}
				</span>
				<span className="hidden text-left text-sm leading-tight font-bold sm:block">
					{member.display_name}
					<span className="block font-semibold text-ink-muted">
						{t(`role.${member.role}`)}
					</span>
				</span>
			</button>
			{open ? (
				<div
					role="menu"
					className="absolute top-full right-0 z-50 mt-2 w-56 rounded-card-xl border-card border-line bg-surface-raised p-1 shadow-card"
				>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setOpen(false);
							onSignOut();
						}}
						data-testid="sign-out"
						className="flex min-h-12 w-full items-center gap-2 rounded-card-xl px-3 text-left font-bold hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
					>
						<LogoutIcon />
						{t("account.signOut")}
					</button>
				</div>
			) : null}
		</div>
	);
}

/** The top bar: the brand, "Quầy", the status pills (shift, network, sound, printer), the person and the time. */
export function TopBar({
	member,
	pills,
	onSignOut,
}: {
	readonly member: Member;
	readonly pills: ReactNode;
	readonly onSignOut: () => void;
}) {
	const { t } = useI18n();
	return (
		<header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-line bg-surface-raised px-4 md:px-5">
			<Mark />
			<span className="kicker hidden text-highlight sm:inline">
				{t("app.kicker")}
			</span>
			<div className="ml-auto flex min-w-0 items-center gap-2">{pills}</div>
			<AccountMenu member={member} onSignOut={onSignOut} />
			<Clock />
		</header>
	);
}

/** A pill of the top bar: an icon and a short word, never colour alone. */
export function StatusChip({
	icon,
	children,
	tone = "neutral",
	onClick,
	label,
	testId,
}: {
	readonly icon?: ReactNode;
	readonly children: ReactNode;
	readonly tone?: "neutral" | "positive" | "negative" | "warning";
	readonly onClick?: () => void;
	readonly label?: string;
	readonly testId?: string;
}) {
	const tones = {
		neutral: "border-line bg-surface-raised text-ink",
		positive: "border-line bg-surface-raised text-ink",
		negative: "border-transparent bg-negative-soft text-ink",
		warning: "border-transparent bg-warning-soft text-ink",
	} as const;
	const dot = {
		neutral: null,
		positive: "bg-positive",
		negative: "bg-negative",
		warning: "bg-warning",
	} as const;
	const body = (
		<>
			{dot[tone] === null ? null : (
				<span
					aria-hidden="true"
					className={`size-2.5 rounded-full ${dot[tone]}`}
				/>
			)}
			{icon}
			<span className="hidden whitespace-nowrap lg:inline">{children}</span>
			<span className="sr-only lg:hidden">{children}</span>
		</>
	);
	const classes = `inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-bold ${tones[tone]}`;
	return onClick === undefined ? (
		<span className={classes} data-testid={testId}>
			{body}
		</span>
	) : (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			className={`${classes} focus-visible:outline-2 focus-visible:outline-focus`}
			data-testid={testId}
		>
			{body}
		</button>
	);
}
