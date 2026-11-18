import { TOKEN_FLOOR, TOKEN_LIMIT } from "@fnb/datapack";
import { useId, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import type { StoreRow } from "../../data/row-source";
import type { BrowserPack, PackGapView } from "../../datapack/browser-pack";
import { PACK_ID_SHOWN } from "../../datapack/pack-files";
import { isMessageKey, type Translate, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { noticeRoutes } from "../../reports/card-adapter";
import { PackCopyDialog } from "./pack-copy-dialog";
import { PLAN_PASTE_PATH } from "./paths";

type CopyState = "idle" | "copied" | "manual";

function scopeLabel(
	t: Translate,
	scope: string,
	names: ReadonlyMap<string, string>,
): string {
	if (scope === "ALL") return t("exports.pack.scope.all");
	const name = names.get(scope);
	return name === undefined
		? scope
		: t("exports.pack.scope.store", { label: scope, name });
}

function trimmedLabel(t: Translate, step: string): string {
	const key = `exports.pack.trim.${step}`;
	return isMessageKey(key) ? t(key) : step;
}

function shareableFile(text: string, fileName: string): File | null {
	if (
		typeof navigator.canShare !== "function" ||
		typeof navigator.share !== "function"
	) {
		return null;
	}
	const file = new File([text], fileName, { type: "application/json" });
	try {
		return navigator.canShare({ files: [file] }) ? file : null;
	} catch {
		return null;
	}
}

function GapItem({
	gap,
	names,
	formatters,
}: {
	gap: PackGapView;
	names: ReadonlyMap<string, string>;
	formatters: Formatters;
}) {
	const t = useT();
	return (
		<li
			className="space-y-1 rounded-lg border border-line p-3"
			data-gap={gap.code}
			data-scope={gap.scope}
			data-severity={gap.severity}
		>
			<p className="text-sm font-medium">{scopeLabel(t, gap.scope, names)}</p>
			<p className="break-words">
				{t(`exports.pack.gap.${gap.code}`, {
					count: gap.value === null ? "—" : formatters.count(gap.value),
				})}
			</p>
			<p className="text-sm text-ink-muted">
				{t(`exports.pack.severity.${gap.severity}`)}
			</p>
			{gap.setting === null ? null : (
				<TextLink to={noticeRoutes[gap.setting]} className="text-sm">
					{t(`report.action.${gap.setting}`)}
				</TextLink>
			)}
		</li>
	);
}

export function PackResultView({
	pack,
	url,
	fileName,
	bundleName,
	stores,
	formatters,
	onAgain,
}: {
	pack: BrowserPack;
	url: string;
	fileName: string;
	bundleName: string;
	stores: readonly StoreRow[];
	formatters: Formatters;
	onAgain: () => void;
}) {
	const t = useT();
	const gapsTitleId = useId();
	const stepsTitleId = useId();
	const copyButton = useRef<HTMLButtonElement>(null);
	const [copy, setCopy] = useState<CopyState>("idle");
	const [dialogOpen, setDialogOpen] = useState(false);
	const shareFile = useMemo(
		() => shareableFile(pack.text, fileName),
		[pack.text, fileName],
	);
	const names = useMemo(() => {
		const byId = new Map(stores.map((store) => [store.id, store.name]));
		return new Map(
			pack.stores.flatMap((store) => {
				const name = byId.get(store.id);
				return name === undefined ? [] : [[store.label, name] as const];
			}),
		);
	}, [pack.stores, stores]);
	const copyBundle = async () => {
		try {
			if (typeof navigator.clipboard?.writeText !== "function") {
				throw new Error("no clipboard");
			}
			await navigator.clipboard.writeText(pack.bundle);
			setCopy("copied");
		} catch {
			setCopy("manual");
			setDialogOpen(true);
		}
	};
	const share = async () => {
		if (shareFile === null) return;
		try {
			await navigator.share({
				files: [shareFile],
				title: t("exports.pack.result.shareTitle"),
			});
		} catch {
			return;
		}
	};
	const summary: readonly { term: string; detail: string; testId: string }[] = [
		...(pack.sample
			? [
					{
						term: t("exports.pack.result.source"),
						detail: t("exports.pack.result.sampleSource"),
						testId: "pack-source",
					},
				]
			: []),
		{
			term: t("exports.pack.result.size"),
			detail: t("exports.pack.result.tokens", {
				tokens: formatters.count(pack.estimatedTokens),
				limit: formatters.count(TOKEN_LIMIT),
			}),
			testId: "pack-tokens",
		},
		{
			term: t("exports.pack.result.id"),
			detail: pack.packId.slice(0, PACK_ID_SHOWN),
			testId: "pack-id",
		},
		{
			term: t("exports.pack.result.tables"),
			detail: t("exports.pack.result.tableCount", {
				count: formatters.count(pack.tables.length),
			}),
			testId: "pack-table-count",
		},
		{
			term: t("exports.pack.result.asOf"),
			detail: formatters.date(pack.asOf),
			testId: "pack-as-of-day",
		},
		{
			term: t("exports.pack.result.stores"),
			detail: pack.stores
				.map((store) => scopeLabel(t, store.label, names))
				.join(", "),
			testId: "pack-stores",
		},
		{
			term: t("exports.pack.result.horizon"),
			detail: t(`exports.pack.horizon.${pack.horizon}`),
			testId: "pack-horizon",
		},
		{
			term: t("exports.pack.result.language"),
			detail: t(`exports.pack.language.${pack.language}`),
			testId: "pack-language",
		},
	];
	return (
		<div
			className="space-y-4 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="pack-result"
		>
			<h3 className="text-lg font-semibold">
				{t("exports.pack.result.title")}
			</h3>
			<p className="sr-only" role="status">
				{t("exports.pack.result.title")}
			</p>
			<dl
				className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]"
				data-testid="pack-summary"
			>
				{summary.map((entry) => (
					<div key={entry.testId} className="contents">
						<dt className="text-sm text-ink-muted">{entry.term}</dt>
						<dd className="break-words" data-testid={entry.testId}>
							{entry.detail}
						</dd>
					</div>
				))}
			</dl>
			{pack.sample ? (
				<p
					className="rounded-lg border border-line bg-surface-sunken p-3 text-sm"
					data-testid="pack-sample"
				>
					{t("exports.pack.result.sample")}
				</p>
			) : null}
			<p className="text-sm" data-testid="pack-totals-only">
				{t("exports.pack.result.totalsOnly")}
			</p>
			{pack.estimatedTokens < TOKEN_FLOOR ? (
				<p className="text-sm text-ink-muted" data-testid="pack-small">
					{t("exports.pack.result.small", {
						floor: formatters.count(TOKEN_FLOOR),
					})}
				</p>
			) : null}
			<details
				className="rounded-lg border border-line"
				data-testid="pack-tables"
			>
				<summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
					{t("exports.pack.result.tablesList")}
				</summary>
				<ul className="space-y-1 px-3 pb-3 text-sm">
					{pack.tables.map((table) => (
						<li key={table.id} className="break-words" data-table={table.id}>
							{t("exports.pack.result.tableRows", {
								title: table.title,
								rows: formatters.count(table.rows),
							})}
						</li>
					))}
				</ul>
			</details>
			{pack.trimmed.length > 0 ? (
				<div className="space-y-1 text-sm" data-testid="pack-trimmed">
					<p>{t("exports.pack.result.trimmed")}</p>
					<ul className="list-disc space-y-1 pl-5">
						{pack.trimmed.map((step) => (
							<li key={step}>{trimmedLabel(t, step)}</li>
						))}
					</ul>
				</div>
			) : null}
			<section aria-labelledby={gapsTitleId} className="space-y-2">
				<h4 id={gapsTitleId} className="font-semibold">
					{t("exports.pack.gaps.title")}
				</h4>
				{pack.gaps.length === 0 ? (
					<p data-testid="pack-gaps-none">{t("exports.pack.gaps.none")}</p>
				) : (
					<>
						<p className="text-sm text-ink-muted">
							{t("exports.pack.gaps.intro")}
						</p>
						<ul className="space-y-2" data-testid="pack-gaps">
							{pack.gaps.map((gap) => (
								<GapItem
									key={`${gap.code}/${gap.scope}`}
									gap={gap}
									names={names}
									formatters={formatters}
								/>
							))}
						</ul>
					</>
				)}
			</section>
			<div className="flex flex-wrap gap-2">
				<a
					href={url}
					download={fileName}
					className={`${buttonVariants()} inline-flex max-w-full items-center`}
					data-testid="pack-download"
				>
					{t("exports.pack.result.download")}
				</a>
				<Button
					ref={copyButton}
					tone="secondary"
					onClick={() => void copyBundle()}
					data-testid="pack-copy"
				>
					{t("exports.pack.result.copy")}
				</Button>
				{shareFile === null ? null : (
					<Button
						tone="secondary"
						onClick={() => void share()}
						data-testid="pack-share"
					>
						{t("exports.pack.result.share")}
					</Button>
				)}
			</div>
			<p
				role="status"
				aria-live="polite"
				className={copy === "manual" ? "text-negative" : undefined}
				data-testid="pack-copy-status"
			>
				{copy === "copied"
					? t("exports.pack.result.copied")
					: copy === "manual"
						? t("exports.pack.result.copyManual")
						: ""}
			</p>
			<section aria-labelledby={stepsTitleId} className="space-y-2">
				<h4 id={stepsTitleId} className="font-semibold">
					{t("exports.pack.steps.title")}
				</h4>
				<ol className="list-decimal space-y-1 pl-5" data-testid="pack-steps">
					<li>{t("exports.pack.steps.one")}</li>
					<li>{t("exports.pack.steps.two")}</li>
					<li>
						{t("exports.pack.steps.three")}{" "}
						<TextLink to={PLAN_PASTE_PATH}>
							{t("exports.pack.steps.paste")}
						</TextLink>
					</li>
				</ol>
			</section>
			<Button tone="secondary" onClick={onAgain} data-testid="pack-again">
				{t("exports.pack.result.again")}
			</Button>
			{dialogOpen ? (
				<PackCopyDialog
					text={pack.bundle}
					fileName={bundleName}
					onClose={() => {
						setDialogOpen(false);
						copyButton.current?.focus();
					}}
				/>
			) : null}
		</div>
	);
}
