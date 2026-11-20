import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The screens load their own chunk on first use (the home screen's paint budget).
// A cold chunk costs a transform in the test runner, which on a loaded CI machine
// takes longer than Testing Library's default one second, so waits are generous;
// a wait that succeeds still returns at once.
configure({ asyncUtilTimeout: 15_000 });

afterEach(() => {
	cleanup();
});
