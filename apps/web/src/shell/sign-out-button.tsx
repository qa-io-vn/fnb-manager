import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useSession } from "../auth/session";
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
		<button
			type="button"
			onClick={() => void signOut()}
			className="min-h-11 rounded-lg border border-line px-3 text-sm font-medium hover:bg-surface-sunken"
		>
			{t("auth.signOut")}
		</button>
	);
}
