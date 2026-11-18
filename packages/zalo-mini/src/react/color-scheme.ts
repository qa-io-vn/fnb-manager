import { useEffect, useState } from "react";

export type ColorScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function currentScheme(): ColorScheme {
	return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches
		? "dark"
		: "light";
}

export function useColorScheme(): ColorScheme {
	const [scheme, setScheme] = useState<ColorScheme>(currentScheme);
	useEffect(() => {
		if (typeof matchMedia !== "function") return;
		const query = matchMedia(DARK_QUERY);
		const update = () => setScheme(query.matches ? "dark" : "light");
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return scheme;
}
