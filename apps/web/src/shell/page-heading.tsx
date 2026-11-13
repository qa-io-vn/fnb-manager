import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useT } from "../i18n";

let lastFocusedPathname: string | null = null;

export function PageHeading({
	title,
	className,
}: {
	title: string;
	className: string;
}) {
	const t = useT();
	const { pathname } = useLocation();
	const heading = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title });
	}, [t, title]);

	useEffect(() => {
		if (lastFocusedPathname === null) {
			lastFocusedPathname = pathname;
			return;
		}
		if (pathname === lastFocusedPathname) return;
		lastFocusedPathname = pathname;
		heading.current?.focus();
	}, [pathname]);

	return (
		<h1 ref={heading} tabIndex={-1} className={`${className} outline-none`}>
			{title}
		</h1>
	);
}
