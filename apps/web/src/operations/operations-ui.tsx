import { type ReactNode, useEffect, useState } from "react";
import { WIDE_CARD_SPAN } from "../components/report-card/report-card";
import { Button } from "../components/ui/button";
import { useT } from "../i18n";
import { usePhoto } from "./queries";

export function PhotoThumbnail({
	bucket,
	path,
	alt,
}: {
	readonly bucket: string;
	readonly path: string;
	readonly alt: string;
}) {
	const t = useT();
	const photo = usePhoto(bucket, path, true);
	const [url, setUrl] = useState<string | null>(null);
	const blob = photo.data;
	useEffect(() => {
		if (blob === undefined) return;
		const created = URL.createObjectURL(blob);
		setUrl(created);
		return () => {
			URL.revokeObjectURL(created);
			setUrl(null);
		};
	}, [blob]);
	if (photo.status === "error") {
		return (
			<p className="text-sm text-negative" data-testid="photo-failed">
				{t("operations.run.photoFailed")}
			</p>
		);
	}
	if (url === null) {
		return (
			<p role="status" className="text-sm text-ink-muted">
				{t("operations.run.photoLoading")}
			</p>
		);
	}
	return (
		<img
			src={url}
			alt={alt}
			className="h-28 w-auto max-w-full rounded-lg border border-line object-cover"
			data-testid="photo-thumbnail"
		/>
	);
}

export function PlainCard({
	title,
	testId,
	state,
	wide = false,
	children,
}: {
	readonly title: string;
	readonly testId: string;
	readonly state: "plain" | "loading" | "error";
	readonly wide?: boolean;
	readonly children: ReactNode;
}) {
	return (
		<article
			aria-busy={state === "loading" ? true : undefined}
			className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-surface-raised p-4 ${state === "error" ? "border-warning" : "border-line"} ${wide ? WIDE_CARD_SPAN : ""}`}
			data-testid={testId}
			data-state={state}
		>
			<h3 className="text-base font-semibold">{title}</h3>
			{children}
		</article>
	);
}

export function LoadFailed({
	onRetry,
	overLimit = false,
}: {
	readonly onRetry: () => void;
	readonly overLimit?: boolean;
}) {
	const t = useT();
	return (
		<div role="alert" className="space-y-2">
			<p className="text-sm">
				{t(overLimit ? "operations.overLimit" : "report.card.error")}
			</p>
			{overLimit ? null : (
				<Button tone="secondary" size="compact" onClick={onRetry}>
					{t("app.retry")}
				</Button>
			)}
		</div>
	);
}
