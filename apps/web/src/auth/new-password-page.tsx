import { type FormEvent, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { TextField } from "../components/ui/field";
import { TextLink } from "../components/ui/text-link";
import { useT } from "../i18n";
import { AuthLayout } from "./auth-layout";
import { useSession } from "./session";

const MINIMUM_PASSWORD_LENGTH = 8;

type SaveState = "idle" | "saving" | "saved" | "failed";

export function NewPasswordPage() {
	const t = useT();
	const navigate = useNavigate();
	const { client, status, finishRecovery } = useSession();
	const passwordId = useId();
	const [password, setPassword] = useState("");
	const [state, setState] = useState<SaveState>("idle");

	if (status === "loading") {
		return (
			<AuthLayout title={t("auth.newPassword.title")}>
				<p role="status">{t("auth.newPassword.waiting")}</p>
			</AuthLayout>
		);
	}

	if (status === "signed-out" || !client) {
		return (
			<AuthLayout title={t("auth.newPassword.title")}>
				<p className="mb-4">{t("auth.newPassword.expired")}</p>
				<TextLink to="/quen-mat-khau">{t("auth.forgot")}</TextLink>
			</AuthLayout>
		);
	}

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (password.length < MINIMUM_PASSWORD_LENGTH) {
			setState("failed");
			return;
		}
		setState("saving");
		const { error } = await client.auth.updateUser({ password });
		setState(error ? "failed" : "saved");
		if (!error) finishRecovery();
	};

	return (
		<AuthLayout title={t("auth.newPassword.title")}>
			{state === "saved" ? (
				<div className="space-y-4">
					<p role="status" className="text-positive">
						{t("auth.newPassword.saved")}
					</p>
					<Button
						type="button"
						onClick={() => navigate("/", { replace: true })}
						className="w-full disabled:opacity-70"
					>
						{t("auth.newPassword.continue")}
					</Button>
				</div>
			) : (
				<form onSubmit={(event) => void submit(event)} className="space-y-4">
					<TextField
						id={passwordId}
						label={t("auth.newPassword.label")}
						type="password"
						value={password}
						onChange={setPassword}
						autoComplete="new-password"
					/>
					<p className="text-sm text-ink-muted">
						{t("auth.newPassword.rule", { count: MINIMUM_PASSWORD_LENGTH })}
					</p>
					{state === "failed" ? (
						<p role="alert" className="text-sm text-negative">
							{t("auth.newPassword.failed")}
						</p>
					) : null}
					<Button
						type="submit"
						disabled={state === "saving"}
						className="w-full disabled:opacity-70"
					>
						{state === "saving"
							? t("auth.newPassword.saving")
							: t("auth.newPassword.submit")}
					</Button>
				</form>
			)}
		</AuthLayout>
	);
}
