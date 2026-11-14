import { type ReactNode, useId, useState } from "react";
import { Button } from "../components/ui/button";
import { fieldVariants, TextField } from "../components/ui/field";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../components/ui/popover";
import { TextLink } from "../components/ui/text-link";
import { useT } from "../i18n";
import { LanguageToggle } from "../shell/language-toggle";
import { PageHeading } from "../shell/page-heading";

const tones = ["primary", "secondary", "warning"] as const;
const sizes = ["regular", "compact"] as const;

function Specimen({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid={`specimen-${id}`}
		>
			<h2 className="text-sm font-semibold">{title}</h2>
			<div className="flex flex-wrap items-end gap-3">{children}</div>
		</section>
	);
}

function ButtonSpecimens() {
	const t = useT();
	return (
		<Specimen id="button" title={t("design.button")}>
			{tones.flatMap((tone) =>
				sizes.map((size) => (
					<Button key={`${tone}-${size}`} tone={tone} size={size}>
						{t("auth.login.submit")}
					</Button>
				)),
			)}
			<Button disabled className="disabled:opacity-70">
				{t("auth.login.submitting")}
			</Button>
		</Specimen>
	);
}

function FieldSpecimens() {
	const t = useT();
	const emailId = useId();
	const controlId = useId();
	const selectId = useId();
	const [email, setEmail] = useState("");
	return (
		<Specimen id="fields" title={t("design.fields")}>
			<div className="w-64">
				<TextField
					id={emailId}
					label={t("auth.email")}
					type="email"
					value={email}
					onChange={setEmail}
					autoComplete="username"
				/>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={controlId} className="text-sm font-medium">
					{t("auth.password")}
				</label>
				<input id={controlId} type="text" className={fieldVariants()} />
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={selectId} className="text-sm font-medium">
					{t("shell.stores")}
				</label>
				<select id={selectId} className={fieldVariants()}>
					<option>{t("shell.stores.all")}</option>
				</select>
			</div>
		</Specimen>
	);
}

function PopoverSpecimen() {
	const t = useT();
	const checkboxId = useId();
	return (
		<Specimen id="popover" title={t("design.popover")}>
			<Popover>
				<PopoverTrigger
					className={fieldVariants({ kind: "trigger" })}
					data-testid="catalogue-popover"
				>
					<span className="text-ink-muted">{t("shell.stores")}</span>
					<span className="font-semibold">{t("shell.stores.all")}</span>
				</PopoverTrigger>
				<PopoverContent label={t("shell.stores")}>
					<label
						htmlFor={checkboxId}
						className="flex min-h-11 items-center gap-2 rounded px-2"
					>
						<input
							id={checkboxId}
							type="checkbox"
							defaultChecked
							className="size-4 accent-accent"
						/>
						<span>{t("shell.stores.all")}</span>
					</label>
				</PopoverContent>
			</Popover>
		</Specimen>
	);
}

export function DesignCataloguePage() {
	const t = useT();
	return (
		<div className="space-y-4">
			<PageHeading
				title={t("design.title")}
				className="text-2xl font-semibold"
			/>
			<ButtonSpecimens />
			<FieldSpecimens />
			<Specimen id="text-link" title={t("design.textLink")}>
				<TextLink to="/">{t("auth.forgot")}</TextLink>
			</Specimen>
			<PopoverSpecimen />
			<Specimen id="language-toggle" title={t("design.languageToggle")}>
				<LanguageToggle />
			</Specimen>
		</div>
	);
}
