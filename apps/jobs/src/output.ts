import { appendFileSync } from "node:fs";
import type { Redactor } from "@fnb/sync";

export interface OutputStreams {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

export const processStreams: OutputStreams = {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
};

export type Cell = string | number | null;

export class Output {
	readonly ci: boolean;
	private readonly streams: OutputStreams;
	private readonly redact: Redactor;
	private readonly summaryFile: string | undefined;

	constructor(options: {
		ci: boolean;
		streams: OutputStreams;
		redact: Redactor;
		summaryFile?: string | undefined;
	}) {
		this.ci = options.ci;
		this.streams = options.streams;
		this.redact = options.redact;
		this.summaryFile = options.summaryFile;
	}

	raw(text: string): void {
		this.streams.stdout(`${text}\n`);
	}

	line(text = ""): void {
		this.streams.stdout(`${this.redact(text)}\n`);
	}

	error(text: string): void {
		this.streams.stderr(`${this.redact(text)}\n`);
	}

	table(headers: readonly string[], rows: readonly (readonly Cell[])[]): void {
		const cells = [
			headers,
			...rows.map((row) =>
				row.map((cell) => (cell === null ? "–" : String(cell))),
			),
		];
		const widths = headers.map((_, column) =>
			Math.max(...cells.map((row) => (row[column] ?? "").length)),
		);
		for (const [index, row] of cells.entries()) {
			this.line(
				row
					.map((cell, column) => cell.padEnd(widths[column] ?? 0))
					.join("  ")
					.trimEnd(),
			);
			if (index === 0) {
				this.line(widths.map((width) => "-".repeat(width)).join("  "));
			}
		}
	}

	label(
		kind: "account" | "other" | "store" | "tenant",
		index: number,
		name: string,
	): string {
		return this.ci ? `${kind} ${index + 1}` : name;
	}

	summary(markdown: string): void {
		if (this.summaryFile) {
			appendFileSync(this.summaryFile, `${this.redact(markdown)}\n`);
		}
	}
}
