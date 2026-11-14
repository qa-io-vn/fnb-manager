export function byteOrder(left: string, right: string): number {
	if (left === right) return 0;
	const leftPoints = [...left];
	const rightPoints = [...right];
	const length = Math.min(leftPoints.length, rightPoints.length);
	for (let index = 0; index < length; index += 1) {
		const leftPoint = leftPoints[index]?.codePointAt(0) ?? 0;
		const rightPoint = rightPoints[index]?.codePointAt(0) ?? 0;
		if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
	}
	return leftPoints.length - rightPoints.length < 0
		? -1
		: leftPoints.length === rightPoints.length
			? 0
			: 1;
}
