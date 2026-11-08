import type { OutputStreams } from "../../src/output.js";

export interface Captured {
	streams: OutputStreams;
	stdout: () => string;
	stderr: () => string;
}

export function capture(): Captured {
	const out: string[] = [];
	const err: string[] = [];
	return {
		streams: {
			stdout: (text) => {
				out.push(text);
			},
			stderr: (text) => {
				err.push(text);
			},
		},
		stdout: () => out.join(""),
		stderr: () => err.join(""),
	};
}
