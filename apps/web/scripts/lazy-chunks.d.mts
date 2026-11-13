export declare const lazySources: readonly RegExp[];
export declare function unmatchedLazySources(
	keys: readonly string[],
	sources?: readonly RegExp[],
): RegExp[];
export declare function isLazySource(
	key: string,
	sources?: readonly RegExp[],
): boolean;
export declare const eagerSources: readonly RegExp[];
export declare function isEagerSource(
	key: string,
	sources?: readonly RegExp[],
): boolean;
