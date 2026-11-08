import { type FormEvent, useId, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAppMode } from "../app-mode/app-mode";
import { useT } from "../i18n";
import {
	AuthLayout,
	primaryButtonClass,
	TextField,
	textLinkClass,
} from "./auth-layout";
import { useSession } from "./session";

export const NEW_PASSWORD_ROUTE = "/mat-khau-moi";

export function recoveryRedirectUrl(
	location: Pick<Location, "origin" | "pathname">,
): string {
	return `${location.origin}${location.pathname}#${NEW_PASSWORD_ROUTE}`;
}

type RequestState = "idle" | "sending" | "sent" | "failed";

export function ResetRequestPage() {
	const t = useT();
	const { isConfigured } = useAppMode();
	const { client, clientFailed } = useSession();
	const emailId = useId();
	const [email, setEmail] = useState("");
	const [state, setState] = useState<RequestState>("idle");

	if (!isConfigured) return <Navigate to="/" replace />;

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!client) {
			setState("failed");
			return;
		}
		setState("sending");
		const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
			redirectTo: recoveryRedirectUrl(window.location),
		});
		setState(error ? "failed" : "sent");
	};

	return (
		<AuthLayout title={t("auth.reset.title")}>
			<p className="mb-4 text-sm text-ink-muted">{t("auth.reset.intro")}</p>
			<form onSubmit={(event) => void submit(event)} className="space-y-4">
				<TextField
					id={emailId}
					label={t("auth.email")}
					type="email"
					value={email}
					onChange={setEmail}
					autoComplete="username"
				/>
				{state === "sent" ? (
					<p
						role="status"
						className="text-sm text-positive"
						data-testid="reset-sent"
					>
						{t("auth.reset.sent")}
					</p>
				) : null}
				{state === "failed" ? (
					<p role="alert" className="text-sm text-negative">
						{t("auth.reset.failed")}
					</p>
				) : null}
				<button
					type="submit"
					disabled={state === "sending" || (!client && !clientFailed)}
					className={primaryButtonClass}
				>
					{state === "sending"
						? t("auth.reset.sending")
						: t("auth.reset.submit")}
				</button>
			</form>
			<p className="mt-2 text-sm">
				<Link to="/dang-nhap" className={textLinkClass}>
					{t("auth.reset.back")}
				</Link>
			</p>
		</AuthLayout>
	);
}
