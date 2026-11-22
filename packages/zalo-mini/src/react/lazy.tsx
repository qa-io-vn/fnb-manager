import {
	type ComponentType,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

type Loaded<P> =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly Component: ComponentType<P> }
	| { readonly status: "failed" };

interface Loader<P> {
	readonly cached: () => ComponentType<P> | null;
	readonly load: () => Promise<ComponentType<P>>;
}

export interface LazyViews {
	readonly Loading: ComponentType;
	readonly Failed: ComponentType<{ readonly retry: () => void }>;
}

const screens: Loader<never>[] = [];

/** How long after the page has loaded the other screens are fetched in the background. */
export const PRELOAD_DELAY_MS = 1000;

/**
 * Fetches the chunks of every lazy screen once the first screen has loaded and
 * the browser is idle, so a person who goes offline after opening the app can
 * still open any screen (the first paint and the load event never wait for it).
 * A chunk that fails to arrive is simply fetched again when its screen opens.
 * The page says when it is done with `data-screens-preloaded` on `<html>`, for tests.
 */
export function preloadLazyScreens(): void {
	const run = () => {
		void Promise.allSettled(screens.map((screen) => screen.load())).then(() => {
			document.documentElement.dataset.screensPreloaded = "true";
		});
	};
	const idle = () => {
		if (typeof window.requestIdleCallback === "function") {
			window.requestIdleCallback(run, { timeout: PRELOAD_DELAY_MS });
		} else {
			window.setTimeout(run, 0);
		}
	};
	const start = () => {
		window.setTimeout(idle, PRELOAD_DELAY_MS);
	};
	if (document.readyState === "complete") start();
	else window.addEventListener("load", start, { once: true });
}

/**
 * A chunk is fetched once; a failed fetch is forgotten so the next try asks
 * again, and a loaded one stays for the rest of the session.
 */
function loaderOf<M, P>(
	importer: () => Promise<M>,
	pick: (loaded: M) => ComponentType<P>,
): Loader<P> {
	let ready: ComponentType<P> | null = null;
	let pending: Promise<ComponentType<P>> | null = null;
	return {
		cached: () => ready,
		load() {
			if (ready !== null) return Promise.resolve(ready);
			if (pending === null) {
				pending = importer().then(
					(loaded) => {
						ready = pick(loaded);
						return ready;
					},
					(error: unknown) => {
						pending = null;
						throw error;
					},
				);
			}
			return pending;
		},
	};
}

function useLoaded<P>(loader: Loader<P>): {
	readonly state: Loaded<P>;
	readonly retry: () => void;
} {
	const mounted = useRef(true);
	const [state, setState] = useState<Loaded<P>>(() => {
		const known = loader.cached();
		return known === null
			? { status: "loading" }
			: { status: "ready", Component: known };
	});
	const start = useCallback(() => {
		setState({ status: "loading" });
		loader.load().then(
			(Component) => {
				if (mounted.current) setState({ status: "ready", Component });
			},
			() => {
				if (mounted.current) setState({ status: "failed" });
			},
		);
	}, [loader]);
	useEffect(() => {
		mounted.current = true;
		// the chunk may have arrived (the idle preload) between the first render, which saw none, and this effect
		const known = loader.cached();
		if (known === null) start();
		else setState({ status: "ready", Component: known });
		return () => {
			mounted.current = false;
		};
	}, [loader, start]);
	return { state, retry: start };
}

function ScreenView<P extends object>({
	loader,
	views,
	props,
}: {
	readonly loader: Loader<P>;
	readonly views: LazyViews;
	readonly props: P;
}) {
	const { state, retry } = useLoaded(loader);
	if (state.status === "ready") return <state.Component {...props} />;
	return state.status === "loading" ? (
		<views.Loading />
	) : (
		<views.Failed retry={retry} />
	);
}

function CardView<P extends object>({
	loader,
	props,
}: {
	readonly loader: Loader<P>;
	readonly props: P;
}) {
	const { state } = useLoaded(loader);
	return state.status === "ready" ? <state.Component {...props} /> : null;
}

/**
 * A screen that loads its own chunk the first time it opens, so the first
 * screen does not pay for the others. If the chunk cannot be fetched the
 * screen says so (the app's own `Failed` view) and offers a retry.
 */
export function lazyScreen<M, P extends object>(
	importer: () => Promise<M>,
	pick: (loaded: M) => ComponentType<P>,
	views: LazyViews,
): ComponentType<P> {
	const loader = loaderOf(importer, pick);
	screens.push(loader as unknown as Loader<never>);
	return (props: P) => (
		<ScreenView loader={loader} views={views} props={props} />
	);
}

/**
 * A card in a slot of the first screen. It loads its own chunk after the first
 * paint and shows nothing meanwhile, or if the chunk is missing.
 */
export function lazyCard<M, P extends object>(
	importer: () => Promise<M>,
	pick: (loaded: M) => ComponentType<P>,
): ComponentType<P> {
	const loader = loaderOf(importer, pick);
	return (props: P) => <CardView loader={loader} props={props} />;
}
