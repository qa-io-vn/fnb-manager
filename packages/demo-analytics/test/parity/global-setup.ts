import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		readonly parityNow: string;
		readonly parityTemplateDirectory: string;
	}
}

export default function setup(project: TestProject): () => void {
	const directory = mkdtempSync(join(tmpdir(), "fnb-parity-"));
	project.provide("parityNow", new Date().toISOString());
	project.provide("parityTemplateDirectory", directory);
	return () => {
		rmSync(directory, { recursive: true, force: true });
	};
}
