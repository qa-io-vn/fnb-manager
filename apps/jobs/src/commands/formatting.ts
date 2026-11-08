export function ageText(from: Date | null, now: Date): string {
	if (!from) {
		return "never";
	}
	const minutes = Math.max(
		0,
		Math.round((now.getTime() - from.getTime()) / 60_000),
	);
	if (minutes < 120) {
		return `${minutes} min`;
	}
	const hours = minutes / 60;
	return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}

export function hoursSince(from: Date | null, now: Date): number | null {
	return from ? (now.getTime() - from.getTime()) / 3_600_000 : null;
}

export function countsText(counts: Readonly<Record<string, number>>): string {
	const entries = Object.entries(counts).filter(([, count]) => count > 0);
	return entries.length === 0
		? "nothing"
		: entries.map(([table, count]) => `${table} ${count}`).join(", ");
}
