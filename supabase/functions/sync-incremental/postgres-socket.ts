import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

const SSL_REQUEST = new Uint8Array([0, 0, 0, 8, 4, 210, 22, 47]);
const TLS_ACCEPTED = 83;
const READ_BYTES = 64 * 1024;
const WRITE_QUEUE_LIMIT = 16;

type Connection = Deno.TcpConn | Deno.TlsConn;

export interface SocketOptions {
	ssl?: unknown;
}

async function writeAll(conn: Connection, data: Uint8Array): Promise<void> {
	let written = 0;
	while (written < data.length) {
		written += await conn.write(data.subarray(written));
	}
}

function closeQuietly(conn: Connection): void {
	try {
		conn.close();
	} catch (error) {
		if (!(error instanceof Deno.errors.BadResource)) {
			throw error;
		}
	}
}

function wantsTls(ssl: unknown): boolean {
	return Boolean(ssl) && ssl !== "disable";
}

function tlsOptional(ssl: unknown): boolean {
	return ssl === "prefer" || ssl === "allow";
}

async function negotiateTls(
	conn: Deno.TcpConn,
	host: string,
	ssl: unknown,
	caCerts: readonly string[],
): Promise<Connection> {
	await writeAll(conn, SSL_REQUEST);
	const answer = new Uint8Array(1);
	const read = await conn.read(answer);
	if (read === 1 && answer[0] === TLS_ACCEPTED) {
		return Deno.startTls(conn, {
			hostname: host,
			...(caCerts.length > 0 ? { caCerts: [...caCerts] } : {}),
		});
	}
	if (tlsOptional(ssl)) {
		return conn;
	}
	closeQuietly(conn);
	throw new Error("the database does not accept TLS connections");
}

export class DenoPostgresSocket extends EventEmitter {
	readonly secure: boolean;
	readonly negotiated = true;
	private readonly conn: Connection;
	private paused = false;
	private wake: (() => void) | null = null;
	private closed = false;
	private queued = 0;
	private writes: Promise<void> = Promise.resolve();

	constructor(conn: Connection, secure: boolean) {
		super();
		this.conn = conn;
		this.secure = secure;
		this.pump();
	}

	write(data: Uint8Array): boolean {
		if (this.closed) {
			return false;
		}
		this.queued += 1;
		const copy = new Uint8Array(data);
		this.writes = this.writes
			.then(() => writeAll(this.conn, copy))
			.then(
				() => {
					this.queued -= 1;
					if (this.queued === 0) {
						this.emit("drain");
					}
				},
				(error: unknown) => this.fail(error),
			);
		return this.queued < WRITE_QUEUE_LIMIT;
	}

	end(data?: Uint8Array): void {
		if (data) {
			this.write(data);
		}
		this.writes.then(
			() => this.finish(),
			() => this.finish(),
		);
	}

	destroy(): void {
		this.finish();
	}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		this.paused = false;
		this.wake?.();
		this.wake = null;
	}

	setKeepAlive(): void {}

	private async pump(): Promise<void> {
		try {
			for (;;) {
				if (this.paused) {
					await new Promise<void>((resolve) => {
						this.wake = resolve;
					});
				}
				const chunk = new Uint8Array(READ_BYTES);
				const read = await this.conn.read(chunk);
				if (read === null) {
					break;
				}
				this.emit("data", Buffer.from(chunk.buffer, 0, read));
			}
			this.finish();
		} catch (error) {
			if (!this.closed) {
				this.fail(error);
			}
		}
	}

	private fail(error: unknown): void {
		if (!this.closed) {
			this.emit(
				"error",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
		this.finish();
	}

	private finish(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		closeQuietly(this.conn);
		this.emit("close");
	}
}

export function denoPostgresSocket(caCerts: readonly string[] = []) {
	return async (
		options: SocketOptions,
		host: string,
		port: number,
	): Promise<DenoPostgresSocket> => {
		const tcp = await Deno.connect({ hostname: host, port });
		tcp.setNoDelay(true);
		const conn = wantsTls(options.ssl)
			? await negotiateTls(tcp, host, options.ssl, caCerts)
			: tcp;
		return new DenoPostgresSocket(conn, conn !== tcp);
	};
}
