interface EdgeRuntimeLike {
	waitUntil(promise: Promise<unknown>): void;
}

function edgeRuntime(): EdgeRuntimeLike | undefined {
	return (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
}

export function runtimeWaitUntil(promise: Promise<unknown>): void {
	const runtime = edgeRuntime();
	if (runtime) {
		runtime.waitUntil(promise);
		return;
	}
	promise.catch(() => undefined);
}
