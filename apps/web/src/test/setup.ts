import * as matchers from "@testing-library/jest-dom/matchers";
import type {} from "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

// The matchers go on this file's own `expect`. The
// "@testing-library/jest-dom/vitest" entry imports vitest through jest-dom's own
// pnpm link instead; on Windows (where that link is a junction) every
// `await expect(promise).rejects.toThrow("…")` then failed with "expected
// [Function] to throw … but got ''", while Linux CI passed.
expect.extend(matchers);

afterEach(() => {
	cleanup();
});
