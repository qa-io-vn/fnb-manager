import type { CardModel } from "@fnb/reports";
import { type ReactNode, useMemo, useRef } from "react";
import {
	ReportCard,
	type ReportCardProps,
	WIDE_CARD_SPAN,
} from "../components/report-card/report-card";
import { Button } from "../components/ui/button";
import { useT } from "../i18n";
import type { Formatters } from "../lib/format";
import { type CardKind, cardTestId, toReportCardProps } from "./card-adapter";
import type { CardState } from "./use-report";

function spanOf(wide: boolean): string {
	return wide ? ` ${WIDE_CARD_SPAN}` : "";
}

function CardSkeleton({
	testId,
	wide,
	controls,
}: {
	testId: string;
	wide: boolean;
	controls?: ReactNode;
}) {
	const t = useT();
	return (
		<article
			aria-busy="true"
			className={`flex min-h-48 min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-raised p-4${spanOf(wide)}`}
			data-testid={testId}
		>
			{controls ?? null}
			<p role="status" className="text-sm text-ink-muted">
				{t("app.loading")}
			</p>
		</article>
	);
}

function CardError({
	testId,
	retry,
	wide,
	limit = false,
	controls,
}: {
	testId: string;
	retry: () => void;
	wide: boolean;
	limit?: boolean;
	controls?: ReactNode;
}) {
	const t = useT();
	return (
		<article
			className={`flex min-w-0 flex-col items-start gap-3 rounded-xl border border-warning bg-surface-raised p-4${spanOf(wide)}`}
			data-testid={testId}
			data-state={limit ? "limit" : "error"}
		>
			{controls ?? null}
			<p role="alert" className="text-sm">
				{t(limit ? "report.card.overLimit" : "report.card.error")}
			</p>
			{limit ? null : (
				<Button type="button" onClick={retry}>
					{t("app.retry")}
				</Button>
			)}
		</article>
	);
}

type Adapted =
	| { readonly props: ReportCardProps }
	| { readonly failure: unknown };

function adapt(
	model: CardModel,
	kind: CardKind,
	t: ReturnType<typeof useT>,
	formatters: Formatters,
): Adapted {
	try {
		return { props: toReportCardProps(model, kind, t, formatters) };
	} catch (failure) {
		if (import.meta.env.DEV) console.error(failure);
		return { failure };
	}
}

export function ReportCardView({
	kind,
	state,
	formatters,
	wide = false,
	controls,
}: {
	kind: CardKind;
	state: CardState;
	formatters: Formatters;
	wide?: boolean;
	controls?: ReactNode;
}) {
	const t = useT();
	const testId = cardTestId(kind, state.id);
	const lastModel = useRef<CardModel | null>(null);
	if (state.status === "ready") lastModel.current = state.model;
	const shown = state.status === "loading" ? lastModel.current : null;
	const model = state.status === "ready" ? state.model : shown;
	const adapted = useMemo(
		() => (model === null ? null : adapt(model, kind, t, formatters)),
		[model, kind, t, formatters],
	);
	if (state.status === "error") {
		return (
			<CardError
				testId={testId}
				retry={state.retry}
				wide={wide}
				limit={state.limit === true}
				controls={controls}
			/>
		);
	}
	if (adapted === null) {
		return <CardSkeleton testId={testId} wide={wide} controls={controls} />;
	}
	if ("failure" in adapted) {
		return (
			<CardError
				testId={testId}
				wide={wide}
				retry={() => window.location.reload()}
				controls={controls}
			/>
		);
	}
	return (
		<ReportCard
			{...adapted.props}
			wide={wide || adapted.props.wide === true}
			busy={state.status === "loading"}
			controls={controls}
		/>
	);
}
