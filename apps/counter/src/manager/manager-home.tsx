import { useI18n } from "@fnb/zalo-mini/i18n";
import { Link } from "react-router-dom";
import { card, PageTitle } from "../ui/kit";

export const MANAGER_SECTIONS = [
	{ to: "/quan-ly/tong-quan", key: "overview" },
	{ to: "/quan-ly/thuc-don", key: "menu" },
	{ to: "/quan-ly/yeu-cau", key: "requests" },
	{ to: "/quan-ly/nhan-su", key: "staff" },
	{ to: "/quan-ly/ca-lam", key: "shifts" },
	{ to: "/quan-ly/ma-qr", key: "qr" },
] as const;

/** Quản lý: the manager's sections, on the tablet and on the phone. */
export function ManagerHome() {
	const { t } = useI18n();
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<PageTitle>{t("nav.manager")}</PageTitle>
			<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{MANAGER_SECTIONS.map((section) => (
					<li key={section.key}>
						<Link
							to={section.to}
							className={`${card} flex min-h-24 flex-col justify-center gap-1 p-5 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus`}
							data-testid={`manager-${section.key}`}
						>
							<span className="text-lg font-extrabold">
								{t(`manager.${section.key}.title`)}
							</span>
							<span className="text-sm text-ink-muted">
								{t(`manager.${section.key}.lead`)}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}
