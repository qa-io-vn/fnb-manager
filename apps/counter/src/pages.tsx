import { useI18n } from "@fnb/zalo-mini/i18n";
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useMember, useSession } from "./lib/session";
import { AppShell, type NavItem } from "./shell/layout";
import { StatusChip, TopBar } from "./shell/top-bar";
import {
	ChartIcon,
	ClockIcon,
	CupIcon,
	LockIcon,
	ReceiptIcon,
	TableIcon,
	WifiOffIcon,
} from "./ui/icons";
import { PageTitle, PlainNote } from "./ui/kit";

/** Whether the browser says it is online; the board's polls say more once they run. */
export function useBrowserOnline(): boolean {
	const [online, setOnline] = useState(() =>
		typeof navigator === "undefined" ? true : navigator.onLine,
	);
	useEffect(() => {
		const up = () => setOnline(true);
		const down = () => setOnline(false);
		window.addEventListener("online", up);
		window.addEventListener("offline", down);
		return () => {
			window.removeEventListener("online", up);
			window.removeEventListener("offline", down);
		};
	}, []);
	return online;
}

function ConnectionChip() {
	const { t } = useI18n();
	const online = useBrowserOnline();
	return online ? (
		<StatusChip tone="positive" testId="connection">
			{t("status.online")}
		</StatusChip>
	) : (
		<StatusChip
			tone="negative"
			icon={<WifiOffIcon size={18} />}
			testId="connection"
		>
			{t("status.offline")}
		</StatusChip>
	);
}

function Placeholder({ title }: { readonly title: string }) {
	return <PageTitle>{title}</PageTitle>;
}

/** What a staff member sees at a manager's address: the database refuses them anyway (hiding is never the control). */
export function ManagersOnly() {
	const { t } = useI18n();
	return (
		<div
			className="flex flex-col items-start gap-3"
			data-testid="managers-only"
		>
			<LockIcon />
			<PlainNote tone="warning">{t("manager.only")}</PlainNote>
		</div>
	);
}

export function CounterPages({ manager }: { readonly manager: boolean }) {
	const { t } = useI18n();
	const { member } = useMember();
	const { signOut } = useSession();
	const items: NavItem[] = [
		{
			to: "/don",
			label: t("nav.orders"),
			icon: <ReceiptIcon />,
			testId: "orders",
		},
		{
			to: "/ban",
			label: t("nav.tables"),
			icon: <TableIcon />,
			testId: "tables",
		},
		{ to: "/mon", label: t("nav.menu"), icon: <CupIcon />, testId: "menu" },
		{ to: "/ca", label: t("nav.shift"), icon: <ClockIcon />, testId: "shift" },
		...(manager
			? [
					{
						to: "/quan-ly",
						label: t("nav.manager"),
						icon: <ChartIcon />,
						testId: "manager",
					},
				]
			: []),
	];
	const manage = (page: ReactNode) => (manager ? page : <ManagersOnly />);
	return (
		<AppShell
			items={items}
			topBar={
				<TopBar
					member={member}
					pills={<ConnectionChip />}
					onSignOut={() => void signOut()}
				/>
			}
		>
			<Routes>
				<Route path="/" element={<Navigate to="/don" replace />} />
				<Route path="/don" element={<Placeholder title={t("nav.orders")} />} />
				<Route path="/ban" element={<Placeholder title={t("nav.tables")} />} />
				<Route path="/mon" element={<Placeholder title={t("nav.menu")} />} />
				<Route path="/ca" element={<Placeholder title={t("nav.shift")} />} />
				<Route
					path="/quan-ly/*"
					element={manage(<Placeholder title={t("nav.manager")} />)}
				/>
				<Route path="*" element={<Navigate to="/don" replace />} />
			</Routes>
		</AppShell>
	);
}
