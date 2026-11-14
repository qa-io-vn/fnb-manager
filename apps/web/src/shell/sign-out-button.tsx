import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useSession } from "../auth/session";
import { Button } from "../components/ui/button";
import { useT } from "../i18n";

export function SignOutButton() {
	const t = useT();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { client, status } = useSession();
	if (!client || status !== "signed-in") return null;
	const signOut = async () => {
		await client.auth.signOut();
		queryClient.clear();
		navigate("/dang-nhap", { replace: true });
	};
	return (
		<Button
			type="button"
			onClick={() => void signOut()}
			tone="secondary"
			size="compact"
		>
			{t("auth.signOut")}
		</Button>
	);
}
