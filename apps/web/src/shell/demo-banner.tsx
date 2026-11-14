import { useNavigate } from "react-router-dom";
import { useAppMode } from "../app-mode/app-mode";
import { Button } from "../components/ui/button";
import { translate, useT } from "../i18n";

export function DemoBanner() {
	const t = useT();
	const { mode } = useAppMode();
	if (mode !== "demo") return null;
	return (
		<section
			aria-label={t("demo.bannerLabel")}
			className="border-b border-warning bg-warning-soft px-4 py-1.5 text-xs text-ink sm:text-sm print:hidden"
			data-testid="demo-banner"
		>
			<p className="mx-auto max-w-6xl">
				<span className="sm:hidden">
					<span lang="vi" className="font-semibold">
						{translate("vi", "demo.bannerShort")}
					</span>
					{" · "}
					<span lang="en">{translate("en", "demo.bannerShort")}</span>
				</span>
				<span className="hidden sm:inline">
					<span lang="vi" className="font-semibold">
						{translate("vi", "demo.banner")}
					</span>{" "}
					<span lang="en">{translate("en", "demo.banner")}</span>
				</span>
			</p>
		</section>
	);
}

export function DemoExitButton() {
	const t = useT();
	const navigate = useNavigate();
	const { mode, isConfigured, exitDemo } = useAppMode();
	if (mode !== "demo" || !isConfigured) return null;
	const leave = () => {
		exitDemo();
		navigate("/dang-nhap", { replace: true });
	};
	return (
		<Button type="button" onClick={leave} tone="warning" size="compact">
			{t("demo.exit")}
		</Button>
	);
}
