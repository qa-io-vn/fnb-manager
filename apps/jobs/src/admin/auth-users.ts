import type { SupabaseClient } from "@supabase/supabase-js";

export type NewUserMode =
	| { kind: "password"; password: string }
	| { kind: "invite" };

export async function createAuthUser(
	client: SupabaseClient,
	email: string,
	mode: NewUserMode,
): Promise<string> {
	const result =
		mode.kind === "password"
			? await client.auth.admin.createUser({
					email,
					password: mode.password,
					email_confirm: true,
				})
			: await client.auth.admin.inviteUserByEmail(email);
	if (result.error || !result.data.user) {
		throw new Error(
			`creating the login failed: ${result.error?.message ?? "no user returned"}`,
		);
	}
	return result.data.user.id;
}

export async function deleteAuthUser(
	client: SupabaseClient,
	userId: string,
): Promise<void> {
	const { error } = await client.auth.admin.deleteUser(userId);
	if (error) {
		throw new Error(`deleting the login failed: ${error.message}`);
	}
}
