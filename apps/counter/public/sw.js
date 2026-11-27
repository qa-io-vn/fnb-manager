// The counter's service worker (ADR-066): it makes the app installable and keeps the app shell, so a tablet that lost
// its network can reload the app. It never stores an API answer: orders, sessions and money always come from the
// network, and the app itself keeps the orders it shows.
const CACHE = "fnb-counter-shell-v1";

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) =>
				cache.addAll([
					"/",
					"/index.html",
					"/manifest.webmanifest",
					"/icon.svg",
				]),
			),
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (request.method !== "GET" || url.origin !== self.location.origin) {
		return;
	}
	if (request.mode === "navigate") {
		event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
		return;
	}
	if (url.pathname.startsWith("/assets/")) {
		event.respondWith(
			caches.match(request).then(
				(cached) =>
					cached ??
					fetch(request).then((response) => {
						if (response.ok) {
							const copy = response.clone();
							caches.open(CACHE).then((cache) => cache.put(request, copy));
						}
						return response;
					}),
			),
		);
	}
});
