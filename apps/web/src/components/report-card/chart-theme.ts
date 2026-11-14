import { type ColorName, colors } from "@fnb/design-tokens";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { SeriesTone } from "./types";

export interface ChartPalette {
	primary: string;
	secondary: string;
	tertiary: string;
	quaternary: string;
	muted: string;
	positive: string;
	negative: string;
	ink: string;
	inkMuted: string;
	line: string;
	surface: string;
}

function paletteOf(colorOf: (token: ColorName) => string): ChartPalette {
	return {
		primary: colorOf("chart-1"),
		secondary: colorOf("chart-2"),
		tertiary: colorOf("chart-3"),
		quaternary: colorOf("chart-4"),
		muted: colorOf("chart-muted"),
		positive: colorOf("positive"),
		negative: colorOf("negative"),
		ink: colorOf("ink"),
		inkMuted: colorOf("ink-muted"),
		line: colorOf("line"),
		surface: colorOf("surface-raised"),
	};
}

function readPalette(): ChartPalette {
	const style = getComputedStyle(document.documentElement);
	return paletteOf(
		(token) =>
			style.getPropertyValue(`--${token}`).trim() || colors.light[token],
	);
}

export const printPalette: ChartPalette = paletteOf(
	(token) => colors.print[token],
);

export function toneColor(palette: ChartPalette, tone: SeriesTone): string {
	return palette[tone];
}

function printMediaQuery(): MediaQueryList | null {
	return typeof window.matchMedia === "function"
		? window.matchMedia("print")
		: null;
}

export function usePrinting(): boolean {
	const [printing, setPrinting] = useState(
		() => printMediaQuery()?.matches ?? false,
	);
	useEffect(() => {
		const query = printMediaQuery();
		const settle = (value: boolean) => flushSync(() => setPrinting(value));
		const startPrinting = () => settle(true);
		const stopPrinting = () => settle(false);
		const followQuery = (event: MediaQueryListEvent) => settle(event.matches);
		window.addEventListener("beforeprint", startPrinting);
		window.addEventListener("afterprint", stopPrinting);
		query?.addEventListener("change", followQuery);
		return () => {
			window.removeEventListener("beforeprint", startPrinting);
			window.removeEventListener("afterprint", stopPrinting);
			query?.removeEventListener("change", followQuery);
		};
	}, []);
	return printing;
}

export function useChartPalette(): ChartPalette {
	const [palette, setPalette] = useState(readPalette);
	const printing = usePrinting();
	useEffect(() => {
		const query = window.matchMedia?.("(prefers-color-scheme: dark)");
		if (!query) return;
		const refresh = () => setPalette(readPalette());
		query.addEventListener("change", refresh);
		return () => query.removeEventListener("change", refresh);
	}, []);
	return printing ? printPalette : palette;
}
