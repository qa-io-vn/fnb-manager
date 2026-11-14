import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterPaintWhenIdle, IDLE_TIMEOUT_MS } from "./after-paint";

class CallbackQueue<Callback extends (...args: never[]) => void> {
	private readonly pending = new Map<number, Callback>();
	private nextHandle = 1;
	readonly options: unknown[] = [];

	add = (callback: Callback, options?: unknown): number => {
		const handle = this.nextHandle;
		this.nextHandle += 1;
		this.pending.set(handle, callback);
		this.options.push(options);
		return handle;
	};

	remove = (handle: number): void => {
		this.pending.delete(handle);
	};

	run(...args: Parameters<Callback>): void {
		const due = [...this.pending.values()];
		this.pending.clear();
		for (const callback of due) callback(...args);
	}

	get size(): number {
		return this.pending.size;
	}
}

let frames: CallbackQueue<FrameRequestCallback>;
let idle: CallbackQueue<IdleRequestCallback>;
const idleDeadline = { didTimeout: false, timeRemaining: () => 50 };

function stubFrames(): void {
	frames = new CallbackQueue();
	vi.stubGlobal("requestAnimationFrame", frames.add);
	vi.stubGlobal("cancelAnimationFrame", frames.remove);
}

function stubIdle(): void {
	idle = new CallbackQueue();
	vi.stubGlobal("requestIdleCallback", idle.add);
	vi.stubGlobal("cancelIdleCallback", idle.remove);
}

beforeEach(() => {
	stubFrames();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("afterPaintWhenIdle", () => {
	it("runs once two frames have passed and the main thread is idle", () => {
		stubIdle();
		const callback = vi.fn();
		afterPaintWhenIdle(callback);
		frames.run(0);
		expect(idle.size).toBe(0);
		frames.run(16);
		expect(callback).not.toHaveBeenCalled();
		expect(idle.size).toBe(1);
		expect(idle.options).toEqual([{ timeout: IDLE_TIMEOUT_MS }]);
		idle.run(idleDeadline);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("never runs once cancelled, whichever step is waiting", () => {
		stubIdle();
		const steps = [0, 1, 2];
		for (const framesBeforeCancel of steps) {
			const callback = vi.fn();
			const cancel = afterPaintWhenIdle(callback);
			for (let frame = 0; frame < framesBeforeCancel; frame += 1)
				frames.run(frame * 16);
			cancel();
			frames.run(100);
			frames.run(116);
			idle.run(idleDeadline);
			expect(callback).not.toHaveBeenCalled();
		}
	});

	it("falls back to a zero-delay timer where idle callbacks do not exist", () => {
		vi.useFakeTimers();
		const callback = vi.fn();
		afterPaintWhenIdle(callback);
		frames.run(0);
		frames.run(16);
		expect(callback).not.toHaveBeenCalled();
		vi.runAllTimers();
		expect(callback).toHaveBeenCalledTimes(1);
	});
});
