import { type FormEvent, useId, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppMode } from "../app-mode/app-mode";
import { Button } from "../components/ui/button";
import { TextField } from "../components/ui/field";
import { TextLink } from "../components/ui/text-link";
import { useT } from "../i18n";
import { AuthLayout } from "./auth-layout";
import { useSession } from "./session";

export function LoginPage() {
	const t = useT();
	const navigate = useNavigate();
	const { mode, isConfigured, enterDemo } = useAppMode();
	const { client, clientFailed, status } = useSession();
	const emailId = useId();
	const passwordId = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [failed, setFailed] = useState(false);

	if (!isConfigured || mode === "demo" || status === "signed-in") {
		return <Navigate to="/" replace />;
	}

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!client) {
			setFailed(true);
			return;
		}
		setSubmitting(true);
		setFailed(false);
		const { error } = await client.auth.signInWithPassword({
			email: email.trim(),
			password,
		});
		setSubmitting(false);
		if (error) {
			setFailed(true);
			return;
		}
		navigate("/", { replace: true });
	};

	const openDemo = () => {
		enterDemo();
		navigate("/", { replace: true });
	};

	return (
		<AuthLayout title={t("auth.login.title")}>
			<p className="mb-4 text-sm text-ink-muted">{t("auth.login.intro")}</p>
			<form
				onSubmit={(event) => void submit(event)}
				className="space-y-4"
				noValidate={false}
			>
				<TextField
					id={emailId}
					label={t("auth.email")}
					type="email"
					value={email}
					onChange={setEmail}
					autoComplete="username"
				/>
				<TextField
					id={passwordId}
					label={t("auth.password")}
					type="password"
					value={password}
					onChange={setPassword}
					autoComplete="current-password"
				/>
				{failed ? (
					<p role="alert" className="text-sm text-negative">
						{clientFailed ? t("app.error") : t("auth.login.failed")}
					</p>
				) : null}
				<Button
					type="submit"
					disabled={submitting || (status === "loading" && !clientFailed)}
					className="w-full disabled:opacity-70"
				>
					{submitting ? t("auth.login.submitting") : t("auth.login.submit")}
				</Button>
			</form>
			<p className="mt-2 text-sm">
				<TextLink to="/quen-mat-khau">{t("auth.forgot")}</TextLink>
			</p>
			<div className="mt-6 border-t border-line pt-4">
				<p className="mb-2 text-sm text-ink-muted">{t("demo.offer")}</p>
				<Button
					type="button"
					onClick={openDemo}
					tone="secondary"
					className="w-full"
				>
					{t("demo.open")}
				</Button>
			</div>
		</AuthLayout>
	);
}
