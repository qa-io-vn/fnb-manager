import { useI18n } from "@fnb/zalo-mini/i18n";
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useMember, useSession } from "./lib/session";
import { clockOf } from "./lib/time";
import { ManagerHome } from "./manager/manager-home";
import { ManagerShiftsPage } from "./manager/shifts-page";
import { AppShell, type NavItem } from "./shell/layout";
import { StatusChip, TopBar } from "./shell/top-bar";
import { ShiftProvider, useShift } from "./shift/shift-context";
import { ShiftPage } from "./shift/shift-page";
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

function ShiftChip() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { data, current } = useShift();
	if (data === null) return null;
	const go = () => navigate("/ca");
	if (current === null) {
		return (
			<StatusChip
				tone="warning"
				icon={<ClockIcon size={18} />}
				onClick={go}
				label={t("status.noShift")}
				testId="shift-chip"
			>
				{t("status.noShift")}
			</StatusChip>
		);
	}
	return current.status === "open" ? (
		<StatusChip
			tone="positive"
			icon={<ClockIcon size={18} />}
			onClick={go}
			label={t("status.shiftSince", { time: clockOf(current.clock_in_at) })}
			testId="shift-chip"
		>
			{t("status.shiftSince", { time: clockOf(current.clock_in_at) })}
		</StatusChip>
	) : (
		<StatusChip
			tone="warning"
			icon={<ClockIcon size={18} />}
			onClick={go}
			label={t("shift.status.awaiting_confirmation")}
			testId="shift-chip"
		>
			{t("shift.status.awaiting_confirmation")}
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

function Frame({ manager }: { readonly manager: boolean }) {
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
					pills={
						<>
							<ShiftChip />
							<ConnectionChip />
						</>
					}
					onSignOut={() => void signOut()}
				/>
			}
		>
			<Routes>
				<Route path="/" element={<Navigate to="/don" replace />} />
				<Route path="/don" element={<Placeholder title={t("nav.orders")} />} />
				<Route path="/ban" element={<Placeholder title={t("nav.tables")} />} />
				<Route path="/mon" element={<Placeholder title={t("nav.menu")} />} />
				<Route path="/ca" element={<ShiftPage />} />
				<Route path="/quan-ly" element={manage(<ManagerHome />)} />
				<Route path="/quan-ly/ca-lam" element={manage(<ManagerShiftsPage />)} />
				<Route path="/quan-ly/*" element={manage(<ManagerHome />)} />
				<Route path="*" element={<Navigate to="/don" replace />} />
			</Routes>
		</AppShell>
	);
}

export function CounterPages({ manager }: { readonly manager: boolean }) {
	return (
		<ShiftProvider>
			<Frame manager={manager} />
		</ShiftProvider>
	);
}
