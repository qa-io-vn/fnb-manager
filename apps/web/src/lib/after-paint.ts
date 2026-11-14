export const IDLE_TIMEOUT_MS = 1000;

type Cancel = () => void;

function nextFrame(callback: () => void): Cancel {
	const handle = requestAnimationFrame(() => callback());
	return () => cancelAnimationFrame(handle);
}

function whenIdle(callback: () => void): Cancel {
	if (typeof requestIdleCallback === "function") {
		const handle = requestIdleCallback(() => callback(), {
			timeout: IDLE_TIMEOUT_MS,
		});
		return () => cancelIdleCallback(handle);
	}
	const handle = setTimeout(callback, 0);
	return () => clearTimeout(handle);
}

export function afterPaintWhenIdle(callback: () => void): Cancel {
	let cancelCurrent = nextFrame(() => {
		cancelCurrent = nextFrame(() => {
			cancelCurrent = whenIdle(callback);
		});
	});
	return () => cancelCurrent();
}
