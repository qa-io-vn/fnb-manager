import { z } from "zod";
import { APP_ACCESS_TOKEN_PATTERN } from "../client.js";

export const iposCredentialsSchema = z.object({
	email: z.string().min(1),
	password: z.string().min(1),
	appAccessToken: z
		.string()
		.regex(
			APP_ACCESS_TOKEN_PATTERN,
			"appAccessToken must be the 32-hex iPOS CMS application key",
		),
});

export type IposCredentials = z.infer<typeof iposCredentialsSchema>;
