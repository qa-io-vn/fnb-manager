import { useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useState } from "react";

function onlineNow(): boolean {
	return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export function useOnline(): boolean {
	const [online, setOnline] = useState(onlineNow);
	useEffect(() => {
		const update = () => setOnline(onlineNow());
		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);
	return online;
}

export function useBackOnline(onBack: () => void): void {
	useEffect(() => {
		window.addEventListener("online", onBack);
		return () => window.removeEventListener("online", onBack);
	}, [onBack]);
}

export function OfflineNotice() {
	const { t } = useI18n();
	const online = useOnline();
	if (online) return null;
	return (
		<p
			role="status"
			className="mx-4 mt-3 rounded-xl bg-warning-soft px-4 py-3 text-base text-ink"
			data-testid="offline"
		>
			{t("customer.offline")}
		</p>
	);
}
