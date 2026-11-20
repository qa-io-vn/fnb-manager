import { test as base, expect } from "@playwright/test";

export type { Download, Locator, Page } from "@playwright/test";
export { expect };

export interface PolicyViolation {
	readonly directive: string;
	readonly blocked: string;
	readonly source: string;
}

export const test = base.extend<{ policyViolations: PolicyViolation[] }>({
	policyViolations: [
		async ({ context }, use) => {
			const violations: PolicyViolation[] = [];
			await context.exposeBinding(
				"__reportPolicyViolation",
				(_source, violation: PolicyViolation) => {
					violations.push(violation);
				},
			);
			await context.addInitScript(() => {
				document.addEventListener("securitypolicyviolation", (event) => {
					const report = (
						window as unknown as {
							__reportPolicyViolation?: (violation: unknown) => void;
						}
					).__reportPolicyViolation;
					report?.({
						directive: event.effectiveDirective,
						blocked: event.blockedURI.slice(0, 120),
						source: `${event.sourceFile.slice(0, 120)}:${event.lineNumber}`,
					});
				});
			});
			await use(violations);
			expect(
				violations,
				"no Content Security Policy violation during the test",
			).toEqual([]);
		},
		{ auto: true },
	],
});
