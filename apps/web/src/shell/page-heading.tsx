import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useT } from "../i18n";

const INITIAL_LOCATION_KEY = "default";
let lastFocusedLocationKey = INITIAL_LOCATION_KEY;

export function PageHeading({
	title,
	className,
}: {
	title: string;
	className: string;
}) {
	const t = useT();
	const { key } = useLocation();
	const heading = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title });
	}, [t, title]);

	useEffect(() => {
		if (key === lastFocusedLocationKey) return;
		lastFocusedLocationKey = key;
		heading.current?.focus();
	}, [key]);

	return (
		<h1 ref={heading} tabIndex={-1} className={`${className} outline-none`}>
			{title}
		</h1>
	);
}
