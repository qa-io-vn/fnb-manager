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

const fallbackPalette: ChartPalette = {
	primary: "#0a6b56",
	secondary: "#8a6417",
	tertiary: "#4c5fa3",
	quaternary: "#9c4f7a",
	muted: "#8a857c",
	positive: "#1b7a48",
	negative: "#b3261e",
	ink: "#1f1d1a",
	inkMuted: "#585550",
	line: "#d9d4ca",
	surface: "#ffffff",
};

function readPalette(): ChartPalette {
	const style = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string) =>
		style.getPropertyValue(name).trim() || fallback;
	return {
		primary: read("--chart-1", fallbackPalette.primary),
		secondary: read("--chart-2", fallbackPalette.secondary),
		tertiary: read("--chart-3", fallbackPalette.tertiary),
		quaternary: read("--chart-4", fallbackPalette.quaternary),
		muted: read("--chart-muted", fallbackPalette.muted),
		positive: read("--positive", fallbackPalette.positive),
		negative: read("--negative", fallbackPalette.negative),
		ink: read("--ink", fallbackPalette.ink),
		inkMuted: read("--ink-muted", fallbackPalette.inkMuted),
		line: read("--line", fallbackPalette.line),
		surface: read("--surface-raised", fallbackPalette.surface),
	};
}

export const printPalette: ChartPalette = {
	primary: "#0a6b56",
	secondary: "#b07a1f",
	tertiary: "#4c5fa3",
	quaternary: "#9c4f7a",
	muted: "#8c8c8c",
	positive: "#1b7a48",
	negative: "#b3261e",
	ink: "#000000",
	inkMuted: "#333333",
	line: "#8c8c8c",
	surface: "#ffffff",
};

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
