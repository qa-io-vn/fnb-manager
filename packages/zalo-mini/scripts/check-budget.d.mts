export interface BuiltFile {
	readonly path: string;
	readonly bytes: number;
}

export interface SizeLimits {
	readonly maxVersionBytes?: number;
	readonly maxFileBytes?: number;
}

export interface SizeCheck {
	readonly totalBytes: number;
	readonly largest: BuiltFile | null;
	readonly problems: string[];
}

export declare const MAX_VERSION_BYTES: number;
export declare const MAX_FILE_BYTES: number;
export declare const FORBIDDEN_PACKAGES: readonly string[];
export declare function listFiles(directory: string): BuiltFile[];
export declare function checkSizes(
	files: readonly BuiltFile[],
	limits?: SizeLimits,
): SizeCheck;
export declare function findForbiddenPackages(
	appDirectory: string,
	forbidden?: readonly string[],
): string[];
