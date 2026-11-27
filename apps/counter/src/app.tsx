import { I18nProvider, useI18n } from "@fnb/zalo-mini/i18n";
import { languageFrom } from "@fnb/zalo-mini/i18n/translate";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { HashRouter } from "react-router-dom";
import { BlockedScreen, NotConfigured, SignInScreen } from "./auth/sign-in";
import type { CounterEnvironment } from "./env";
import { catalogs } from "./i18n/catalog";
import {
	isManager,
	SessionProvider,
	useMember,
	useSession,
} from "./lib/session";
import { StoreProvider } from "./lib/store";
import { CounterPages } from "./pages";
import { StorePicker } from "./shell/store-picker";
import { Loading } from "./ui/kit";
import { ToastProvider } from "./ui/toast";

function Gate() {
	const { state } = useSession();
	const { t } = useI18n();
	if (state.phase === "loading") return <Loading label={t("app.loading")} />;
	if (state.phase === "signed-out") return <SignInScreen error={state.error} />;
	if (state.phase === "blocked")
		return <BlockedScreen answer={state.answer} error={state.error} />;
	return <SignedIn />;
}

function SignedIn() {
	const { t } = useI18n();
	const { member } = useMember();
	return (
		<StoreProvider
			loading={<Loading label={t("app.loading")} />}
			none={<NoStore />}
			picker={(stores, choose) => (
				<StorePicker stores={stores} onChoose={choose} />
			)}
		>
			<HashRouter>
				<CounterPages manager={isManager(member)} />
			</HashRouter>
		</StoreProvider>
	);
}

function NoStore() {
	const { t } = useI18n();
	const { signOut } = useSession();
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center text-ink">
			<p className="max-w-md text-body">{t("store.none")}</p>
			<button
				type="button"
				className="underline"
				onClick={() => void signOut()}
			>
				{t("account.signOut")}
			</button>
		</main>
	);
}

function languageOfPage(): "vi" | "en" {
	try {
		return languageFrom(
			new URLSearchParams(window.location.search).get("lang") ??
				window.localStorage.getItem("fnb-counter-lang") ??
				"vi",
		);
	} catch {
		return "vi";
	}
}

export function App({
	environment,
	children,
}: {
	readonly environment: CounterEnvironment | null;
	readonly children?: ReactNode;
}) {
	const queryClient = useMemo(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
				},
			}),
		[],
	);
	return (
		<I18nProvider language={languageOfPage()} catalogs={catalogs}>
			{environment === null ? (
				<NotConfigured />
			) : (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SessionProvider environment={environment}>
							{children ?? <Gate />}
						</SessionProvider>
					</ToastProvider>
				</QueryClientProvider>
			)}
		</I18nProvider>
	);
}
