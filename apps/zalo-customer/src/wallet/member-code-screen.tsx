import type { CustomerStore } from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import { useId } from "react";
import { useCustomerData } from "../data/customer-data";
import { shownTime } from "../data/dates";
import { useStoreLink } from "../data/store-link";
import { storeOrOnly } from "../home/model";
import {
	BackButton,
	Card,
	Failed,
	failureKey,
	fieldClass,
	Loading,
	NoStores,
	primaryButton,
	Screen,
	Spinner,
} from "../ui";
import { codeStatus, secondsUntil, useMemberCode } from "./member-code";
import { QrCode } from "./qr";
import { MemberOnly } from "./wallet-screen";

export function StorePicker({
	stores,
	value,
	onChange,
	label,
	testId,
}: {
	readonly stores: readonly CustomerStore[];
	readonly value: string | null;
	readonly onChange: (store: string) => void;
	readonly label: string;
	readonly testId: string;
}) {
	const { t } = useI18n();
	const id = useId();
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm text-ink-muted">
				{label}
			</label>
			<select
				id={id}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value)}
				className={fieldClass}
				data-testid={testId}
			>
				{value === null ? (
					<option value="" disabled>
						{t("code.pickStore")}
					</option>
				) : null}
				{stores.map((store) => (
					<option key={store.code} value={store.code}>
						{store.name}
					</option>
				))}
			</select>
		</div>
	);
}

function CodeCard({ store }: { readonly store: string }) {
	const { t } = useI18n();
	const { code, loading, failure, now, retry } = useMemberCode(store);
	if (code === null) {
		if (failure !== null) return <Failed failure={failure} onRetry={retry} />;
		return <Loading label={t("code.loading")} />;
	}
	const status = codeStatus(code, now);
	const expired = status === "expired";
	return (
		<Card testId="code-card">
			<div className="flex flex-col items-center gap-3">
				<QrCode
					payload={code.qrPayload}
					label={t("code.qrLabel", { store: code.storeName })}
					dimmed={expired}
				/>
				<p
					className={`font-mono text-4xl font-semibold tracking-[0.3em] ${expired ? "text-ink-muted line-through" : "text-ink"}`}
					data-testid="member-code"
				>
					{code.code}
				</p>
				<p className="text-base text-ink" data-testid="code-store">
					{code.storeName}
				</p>
				{expired ? (
					<p
						role="alert"
						className="text-base text-negative"
						data-testid="code-expired"
					>
						{t("code.expired")}
					</p>
				) : (
					<p
						className="text-base text-ink"
						data-testid="code-countdown"
						aria-live="off"
					>
						{status === "fresh"
							? t("code.refreshIn", {
									seconds: secondsUntil(code.refreshAt, now),
								})
							: t("code.refreshing")}
					</p>
				)}
				<p className="text-sm text-ink-muted" data-testid="code-valid-until">
					{t("code.validUntil", { time: shownTime(code.expiresAt) })}
				</p>
				{failure === null ? null : (
					<p role="alert" className="text-sm text-ink">
						{t(failureKey(failure))}
					</p>
				)}
				{expired ? (
					<button
						type="button"
						className={primaryButton}
						onClick={retry}
						disabled={loading}
						aria-busy={loading}
					>
						{loading ? <Spinner /> : null}
						{t("code.newCode")}
					</button>
				) : null}
			</div>
		</Card>
	);
}

function MemberCodeView() {
	const { t } = useI18n();
	const { home, reloadHome } = useCustomerData();
	const { currentStore, chooseStore } = useStoreLink();
	if (home.status === "loading") return <Loading />;
	if (home.status === "failed")
		return <Failed failure={home.failure} onRetry={reloadHome} />;
	const stores = home.data.stores;
	const store = storeOrOnly(stores, currentStore)?.code ?? null;
	return (
		<Screen testId="member-code-screen">
			<BackButton />
			<h1 className="text-xl font-semibold text-ink">{t("code.title")}</h1>
			<p className="text-base text-ink">{t("code.intro")}</p>
			{stores.length === 0 ? (
				<NoStores />
			) : (
				<StorePicker
					stores={stores}
					value={store}
					onChange={chooseStore}
					label={t("code.storeLabel")}
					testId="code-store-picker"
				/>
			)}
			{stores.length === 0 ? null : store === null ? (
				<p className="text-base text-ink" data-testid="code-pick-first">
					{t("code.pickFirst")}
				</p>
			) : (
				<CodeCard key={store} store={store} />
			)}
		</Screen>
	);
}

export function MemberCodeScreen() {
	return (
		<MemberOnly next="card">
			<MemberCodeView />
		</MemberOnly>
	);
}
