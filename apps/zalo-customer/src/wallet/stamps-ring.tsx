import { useI18n } from "@fnb/zalo-mini/react";

export interface RingSegment {
	readonly index: number;
	readonly state: "filled" | "pending" | "empty";
	readonly path: string;
}

const SIZE = 120;
const RADIUS = 48;
const GAP_DEGREES = 6;

function point(angle: number): string {
	const radians = ((angle - 90) * Math.PI) / 180;
	const x = SIZE / 2 + RADIUS * Math.cos(radians);
	const y = SIZE / 2 + RADIUS * Math.sin(radians);
	return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

export function ringSegments(
	stamps: number,
	pending: number,
	perCard: number,
): RingSegment[] {
	const total = Math.max(1, perCard);
	const filled = Math.min(Math.max(0, stamps), total);
	const waiting = Math.min(Math.max(0, pending), total - filled);
	const step = 360 / total;
	const gap = total === 1 ? 0 : Math.min(GAP_DEGREES, step / 3);
	return Array.from({ length: total }, (_, index) => {
		const start = index * step + gap / 2;
		const end = (index + 1) * step - gap / 2;
		const sweep = end - start;
		const path =
			total === 1
				? `M ${point(0)} A ${RADIUS} ${RADIUS} 0 1 1 ${point(359.99)}`
				: `M ${point(start)} A ${RADIUS} ${RADIUS} 0 ${sweep > 180 ? 1 : 0} 1 ${point(end)}`;
		return {
			index,
			state:
				index < filled
					? "filled"
					: index < filled + waiting
						? "pending"
						: "empty",
			path,
		};
	});
}

const STROKES = {
	filled: "var(--color-accent)",
	pending: "var(--color-warning)",
	empty: "var(--color-line)",
} as const;

export function StampsRing({
	stamps,
	pending,
	perCard,
}: {
	readonly stamps: number;
	readonly pending: number;
	readonly perCard: number;
}) {
	const { t } = useI18n();
	const label =
		pending > 0
			? t("wallet.ringLabelPending", { stamps, total: perCard, pending })
			: t("wallet.ringLabel", { stamps, total: perCard });
	return (
		<div className="relative size-[120px] shrink-0">
			<svg
				role="img"
				aria-label={label}
				width={SIZE}
				height={SIZE}
				viewBox={`0 0 ${SIZE} ${SIZE}`}
				data-testid="stamps-ring"
			>
				{ringSegments(stamps, pending, perCard).map((segment) => (
					<path
						key={segment.index}
						d={segment.path}
						fill="none"
						stroke={STROKES[segment.state]}
						strokeWidth="10"
						strokeLinecap="round"
						strokeDasharray={segment.state === "pending" ? "4 4" : undefined}
						data-state={segment.state}
					/>
				))}
			</svg>
			<span
				aria-hidden="true"
				className="absolute inset-0 flex flex-col items-center justify-center text-ink"
			>
				<span className="text-2xl font-semibold">{stamps}</span>
				<span className="text-sm text-ink-muted">/{perCard}</span>
			</span>
		</div>
	);
}
