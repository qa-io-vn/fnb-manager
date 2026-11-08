import type { BenchmarkContextEntry } from "./vocabulary.js";

export const benchmarkContext = [
	{
		id: "ctx_fnb_revenue_2024",
		figure: "F&B revenue 688,800 bn VND, +16.6 %; 323,010 outlets",
		year: "2024",
		source: "iPOS market report 2024 (published 2025-03)",
	},
	{
		id: "ctx_fnb_revenue_2025",
		figure: "F&B revenue 726,500 bn VND, +5.5 %; 329,500 outlets",
		year: "2025",
		source: "iPOS market report 2025 (published 2026-04)",
	},
	{
		id: "ctx_outlets_h1_2025",
		figure: "299,900 outlets, −7.1 %; 45.3 % of outlets raised prices 5–10 %",
		year: "H1 2025",
		source: "iPOS half-year report (published 2025-10)",
	},
	{
		id: "ctx_drink_price_bands_2024",
		figure:
			"preferred drink price bands, 2023 → 2024: under 20k VND 4.3 → 12.3 %; 21–35k 29.6 → 40.0 %; 35–50k 47.7 → 31.5 %; 70k and over 7.3 → 5.1 %; 52.3 % of consumers prefer drinks under 35k",
		year: "2024",
		source: "iPOS market report 2024",
	},
	{
		id: "ctx_drink_price_bands_2025",
		figure: "drinks at 35k VND or more: 57.58 %",
		year: "2025",
		source: "iPOS market report 2025",
	},
	{
		id: "ctx_visit_frequency_h1_2024",
		figure:
			"41.7 % visit cafés 1–2 times a month, 32.3 % 1–2 times a week; cups over 100k VND fell from 6 % to 1.7 %",
		year: "H1 2024",
		source: "iPOS half-year report (published 2024-08)",
	},
	{
		id: "ctx_visit_frequency_2024",
		figure: "the 3–4 visits a week group grew from 17.4 % to 32.8 %",
		year: "2024",
		source: "iPOS market report 2024",
	},
	{
		id: "ctx_chain_daily_sales_2024",
		figure:
			"a leading coffee chain: about 850 stores, roughly 15–16 m VND per store per day, same-store sales −3.7 %",
		year: "2024",
		source: "Jollibee Group annual results, cafef.vn (2025-03)",
	},
	{
		id: "ctx_chain_daily_sales_2025",
		figure:
			"a leading tea chain: 1,891 bn VND revenue, +17 %; like-for-like 22.8 m VND per store per day; delivery over 31 % of retail revenue",
		year: "2025",
		source:
			"znews.vn (2026-01), vnexpress.net (2026-10, Q3 2026 like-for-like 24.8 m VND)",
	},
	{
		id: "ctx_food_delivery_gmv_2025",
		figure: "food delivery GMV US$2.1 bn, +19 %; two platforms hold about 95 %",
		year: "2025",
		source: "theinvestor.vn (2026-01)",
	},
] as const satisfies readonly BenchmarkContextEntry[];
