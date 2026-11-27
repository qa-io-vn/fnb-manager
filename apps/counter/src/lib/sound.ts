/**
 * The new-order chime (ADR-066): two short tones made with Web Audio (no sound file, no network), and a vibration
 * where the device has one. Browsers play sound only after a tap, so the counter asks for one tap per shift
 * ("Bật âm báo"). Each chime also counts on <html data-chimes>, which a test or a support person can read.
 */

interface AudioContextLike {
	readonly state: string;
	readonly currentTime: number;
	readonly destination: unknown;
	resume(): Promise<void>;
	createOscillator(): {
		type: string;
		frequency: { setValueAtTime(value: number, at: number): void };
		connect(node: unknown): void;
		start(at: number): void;
		stop(at: number): void;
	};
	createGain(): {
		gain: {
			setValueAtTime(value: number, at: number): void;
			exponentialRampToValueAtTime(value: number, at: number): void;
		};
		connect(node: unknown): void;
	};
}

type AudioContextConstructor = new () => AudioContextLike;

function audioContextClass(): AudioContextConstructor | null {
	const scope = globalThis as {
		AudioContext?: AudioContextConstructor;
		webkitAudioContext?: AudioContextConstructor;
	};
	return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class Chime {
	private context: AudioContextLike | null = null;
	private count = 0;

	get unlocked(): boolean {
		return this.context !== null && this.context.state === "running";
	}

	/** After a tap: makes and resumes the audio context; true when sound can play. */
	async unlock(): Promise<boolean> {
		const Context = audioContextClass();
		if (Context === null) return false;
		this.context ??= new Context();
		try {
			await this.context.resume();
		} catch {
			return false;
		}
		return this.unlocked;
	}

	/** Rings for new orders: answers whether a sound could play (the count and the vibration happen either way). */
	play(): boolean {
		this.count += 1;
		if (typeof document !== "undefined") {
			document.documentElement.dataset.chimes = String(this.count);
		}
		if (
			typeof navigator !== "undefined" &&
			typeof navigator.vibrate === "function"
		) {
			navigator.vibrate([120, 60, 120]);
		}
		const context = this.context;
		if (context === null || context.state !== "running") return false;
		const start = context.currentTime;
		for (const [offset, frequency] of [
			[0, 880],
			[0.18, 1320],
		] as const) {
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			oscillator.type = "sine";
			oscillator.frequency.setValueAtTime(frequency, start + offset);
			gain.gain.setValueAtTime(0.0001, start + offset);
			gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
			oscillator.connect(gain);
			gain.connect(context.destination);
			oscillator.start(start + offset);
			oscillator.stop(start + offset + 0.17);
		}
		return true;
	}

	get chimes(): number {
		return this.count;
	}
}
