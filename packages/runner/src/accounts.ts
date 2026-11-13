import { z } from "zod";

const accountKey = z
	.string()
	.min(1)
	.regex(/^[a-z0-9][a-z0-9-_]*$/, "account keys are lower-case slugs");

export const iposAccountSchema = z.object({
	key: accountKey,
	connector: z.literal("ipos-fabi"),
	email: z.string().min(1),
	password: z.string().min(1),
	appAccessToken: z.string().min(1).optional(),
});

export const mockAccountSchema = z.object({
	key: accountKey,
	connector: z.literal("mock"),
	seed: z.number().int().nonnegative().optional(),
	storeCount: z.number().int().min(1).max(5).optional(),
	rejectLogin: z.literal(true).optional(),
});

export const accountEntrySchema = z.discriminatedUnion("connector", [
	iposAccountSchema,
	mockAccountSchema,
]);

export const accountEntriesSchema = z
	.array(accountEntrySchema)
	.superRefine((entries, context) => {
		const seen = new Set<string>();
		entries.forEach((entry, index) => {
			if (seen.has(entry.key)) {
				context.addIssue({
					code: "custom",
					path: [index, "key"],
					message: "account keys must be unique",
				});
			}
			seen.add(entry.key);
		});
	});

export type AccountEntry = z.infer<typeof accountEntrySchema>;
export type IposAccountEntry = z.infer<typeof iposAccountSchema>;
export type MockAccountEntry = z.infer<typeof mockAccountSchema>;

export const CREDENTIAL_FIELDS = [
	"email",
	"password",
	"appAccessToken",
] as const;

export const ACCOUNTS_VARIABLE = "POS_ACCOUNTS_JSON";

export class AccountConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AccountConfigError";
	}
}

export function describeIssues(source: string, error: z.ZodError): string {
	const details = error.issues
		.slice(0, 5)
		.map(
			(issue) =>
				`${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`,
		)
		.join("; ");
	return `${source} is invalid (${details})`;
}

export function parseAccountEntries(raw: string | undefined): AccountEntry[] {
	if (!raw) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new AccountConfigError(`${ACCOUNTS_VARIABLE} is not valid JSON`);
	}
	const result = accountEntriesSchema.safeParse(parsed);
	if (!result.success) {
		throw new AccountConfigError(
			describeIssues(ACCOUNTS_VARIABLE, result.error),
		);
	}
	return result.data;
}

export interface NumberedEntry {
	entry: AccountEntry;
	position: number;
}

export function entryForKey(
	entries: readonly AccountEntry[],
	key: string,
): NumberedEntry | null {
	const index = entries.findIndex((entry) => entry.key === key);
	const entry = entries[index];
	return entry ? { entry, position: index + 1 } : null;
}
