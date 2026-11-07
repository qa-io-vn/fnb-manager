export type LogContext = Record<
	string,
	string | number | boolean | null | undefined
>;

export interface IposLogger {
	debug(message: string, context?: LogContext): void;
	info(message: string, context?: LogContext): void;
	warn(message: string, context?: LogContext): void;
	error(message: string, context?: LogContext): void;
}

const ignore = (): void => undefined;

export const silentLogger: IposLogger = {
	debug: ignore,
	info: ignore,
	warn: ignore,
	error: ignore,
};
