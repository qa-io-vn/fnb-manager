export class ZaloRefusal extends Error {
	readonly status: number;
	readonly code: string;
	readonly logLine: string | null;

	constructor(status: number, code: string, logLine: string | null = null) {
		super(code);
		this.name = "ZaloRefusal";
		this.status = status;
		this.code = code;
		this.logLine = logLine;
	}
}
