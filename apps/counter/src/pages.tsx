import { useI18n } from "@fnb/zalo-mini/i18n";
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { CreateOrderPage } from "./create/create-order-page";
import { useMember, useSession } from "./lib/session";
import { clockOf } from "./lib/time";
import { ManagerHome } from "./manager/manager-home";
import { MenuEditorPage } from "./manager/menu-page";
import { OverviewPage } from "./manager/overview-page";
import { QrPage } from "./manager/qr-page";
import { RequestsPage, useInbox } from "./manager/requests-page";
import { ManagerShiftsPage } from "./manager/shifts-page";
import { StaffPage } from "./manager/staff-page";
import { SoldOutPage } from "./menu/sold-out-page";
import { BoardProvider, useBoard } from "./orders/board-context";
import { laneOrders } from "./orders/board-model";
import { OrderDetailPage } from "./orders/order-detail";
import { QueuePage } from "./orders/queue-page";
import { PrinterProvider } from "./print/printer";
import { AppShell, type NavItem } from "./shell/layout";
import { StatusChip, TopBar } from "./shell/top-bar";
import { ShiftProvider, useShift } from "./shift/shift-context";
import { ShiftPage } from "./shift/shift-page";
import { TablesPage } from "./tables/tables-page";
import {
	BellIcon,
	BellOffIcon,
	ChartIcon,
	ClockIcon,
	CupIcon,
	LockIcon,
	ReceiptIcon,
	TableIcon,
	WifiOffIcon,
} from "./ui/icons";
import { PlainNote } from "./ui/kit";

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

function SoundChip() {
	const { t } = useI18n();
	const { soundOn, unlockSound } = useBoard();
	return soundOn ? (
		<StatusChip
			tone="positive"
			icon={<BellIcon size={18} />}
			testId="sound-chip"
		>
			{t("status.soundOn")}
		</StatusChip>
	) : (
		<StatusChip
			tone="warning"
			icon={<BellOffIcon size={18} />}
			onClick={() => void unlockSound()}
			label={t("status.soundOff")}
			testId="sound-chip"
		>
			{t("status.soundOff")}
		</StatusChip>
	);
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
	const { state } = useBoard();
	// M01: the new requests nobody opened yet, on the manager's tab (staff never ask: the database refuses them)
	const unread = useInbox(manager).data?.unread ?? 0;
	const items: NavItem[] = [
		{
			to: "/don",
			label: t("nav.orders"),
			icon: <ReceiptIcon />,
			testId: "orders",
			badge: laneOrders(state, "new").length,
		},
		{
			to: "/ban",
			label: t("nav.tables"),
			icon: <TableIcon />,
			testId: "tables",
			badge: state.calls.length,
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
						badge: unread,
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
							<SoundChip />
							<ConnectionChip />
						</>
					}
					onSignOut={() => void signOut()}
				/>
			}
		>
			<Routes>
				<Route path="/" element={<Navigate to="/don" replace />} />
				<Route path="/don" element={<QueuePage />} />
				<Route path="/don/:id" element={<OrderDetailPage />} />
				<Route path="/tao-don" element={<CreateOrderPage />} />
				<Route path="/ban" element={<TablesPage />} />
				<Route path="/mon" element={<SoldOutPage />} />
				<Route path="/ca" element={<ShiftPage />} />
				<Route path="/quan-ly" element={manage(<ManagerHome />)} />
				<Route path="/quan-ly/ca-lam" element={manage(<ManagerShiftsPage />)} />
				<Route path="/quan-ly/tong-quan" element={manage(<OverviewPage />)} />
				<Route path="/quan-ly/thuc-don" element={manage(<MenuEditorPage />)} />
				<Route path="/quan-ly/yeu-cau" element={manage(<RequestsPage />)} />
				<Route path="/quan-ly/nhan-su" element={manage(<StaffPage />)} />
				<Route path="/quan-ly/ma-qr" element={manage(<QrPage />)} />
				<Route path="/quan-ly/*" element={manage(<ManagerHome />)} />
				<Route path="*" element={<Navigate to="/don" replace />} />
			</Routes>
		</AppShell>
	);
}

export function CounterPages({ manager }: { readonly manager: boolean }) {
	return (
		<ShiftProvider>
			<BoardProvider>
				<PrinterProvider>
					<Frame manager={manager} />
				</PrinterProvider>
			</BoardProvider>
		</ShiftProvider>
	);
}
