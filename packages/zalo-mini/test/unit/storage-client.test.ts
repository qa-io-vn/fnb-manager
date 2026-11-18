import { describe, expect, it } from "vitest";
import { RestError } from "../../src/data/rest-client";
import {
	createStorageClient,
	objectPath,
	type StorageAnswer,
	type StorageRequest,
} from "../../src/data/storage-client";

const PATH = "t-1/s-1/run/r-1/p-abc.jpg";

function recorder(answer: (request: StorageRequest) => StorageAnswer) {
	const sent: StorageRequest[] = [];
	const transport = async (request: StorageRequest) => {
		sent.push(request);
		request.onProgress?.(0.5);
		request.onProgress?.(1);
		return answer(request);
	};
	const client = createStorageClient({
		url: "https://project.example.com/",
		publishableKey: "publishable-test",
		accessToken: "session-test",
		transport,
	});
	return { sent, client };
}

describe("the Mini App's Storage client", () => {
	it("uploads a JPEG with the publishable key and the member's session, never overwriting, and reports progress", async () => {
		const { sent, client } = recorder(() => ({
			status: 200,
			body: { Key: "x" },
		}));
		const progress: number[] = [];
		const photo = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
		await client.upload("ops-brand-1", PATH, photo, {
			onProgress: (fraction) => progress.push(fraction),
		});
		expect(sent[0]).toMatchObject({
			method: "POST",
			url: `https://project.example.com/storage/v1/object/ops-brand-1/${PATH}`,
			headers: {
				apikey: "publishable-test",
				Authorization: "Bearer session-test",
				"Content-Type": "image/jpeg",
				"x-upsert": "false",
			},
			responseType: "json",
		});
		expect(sent[0]?.body).toBe(photo);
		expect(progress).toEqual([0.5, 1]);
	});

	it("goes through the local dev server's /supabase path too", async () => {
		const sent: StorageRequest[] = [];
		const client = createStorageClient({
			url: "/supabase",
			publishableKey: "k",
			accessToken: "t",
			transport: async (request) => {
				sent.push(request);
				return { status: 200, body: {} };
			},
		});
		await client.upload("ops-brand-1", PATH, new Blob(["x"]));
		expect(sent[0]?.url).toBe(
			`/supabase/storage/v1/object/ops-brand-1/${PATH}`,
		);
	});

	it("treats an object that already exists as uploaded, so a retry after a lost answer succeeds", async () => {
		for (const answer of [
			{ status: 409, body: null },
			{
				status: 400,
				body: { statusCode: "409", error: "Duplicate", message: "x" },
			},
		]) {
			const { client } = recorder(() => answer);
			await expect(
				client.upload("ops-brand-1", PATH, new Blob(["x"])),
			).resolves.toBeUndefined();
		}
	});

	it("turns a refusal into its status, from the answer's statusCode when there is one, without its text", async () => {
		const { client } = recorder(() => ({
			status: 400,
			body: {
				statusCode: "403",
				error: "Unauthorized",
				message: "new row violates row-level security policy",
			},
		}));
		const error = await client
			.upload("ops-brand-1", PATH, new Blob(["x"]))
			.catch((e) => e);
		expect(error).toBeInstanceOf(RestError);
		expect(error.status).toBe(403);
		expect(error.message).not.toContain("row-level");
		const lost = recorder(() => ({ status: 0, body: null }));
		await expect(
			lost.client.upload("ops-brand-1", PATH, new Blob(["x"])),
		).rejects.toMatchObject({ status: 0 });
		const oversized = recorder(() => ({
			status: 413,
			body: { statusCode: 413 },
		}));
		await expect(
			oversized.client.upload("ops-brand-1", PATH, new Blob(["x"])),
		).rejects.toMatchObject({ status: 413 });
	});

	it("downloads a private photo through the authenticated path", async () => {
		const photo = new Blob([new Uint8Array(3)], { type: "image/jpeg" });
		const { sent, client } = recorder(() => ({ status: 200, body: photo }));
		expect(await client.download("ops-brand-1", PATH)).toBe(photo);
		expect(sent[0]).toMatchObject({
			method: "GET",
			url: `https://project.example.com/storage/v1/object/authenticated/ops-brand-1/${PATH}`,
			responseType: "blob",
		});
		const missing = recorder(() => ({
			status: 400,
			body: { statusCode: "404" },
		}));
		await expect(
			missing.client.download("ops-brand-1", PATH),
		).rejects.toMatchObject({ status: 404 });
	});

	it("refuses bucket and object names that could leave the bucket", () => {
		expect(objectPath("ops-brand-1", "a/b c.jpg".replace(" ", "_"))).toBe(
			"ops-brand-1/a/b_c.jpg",
		);
		expect(() => objectPath("ops-brand-1", "a/../b.jpg")).toThrow(
			"not an object name",
		);
		expect(() => objectPath("ops-brand-1", "/a.jpg")).toThrow(
			"not an object name",
		);
		expect(() => objectPath("ops-brand-1", "a/b?c.jpg")).toThrow(
			"not an object name",
		);
		expect(() => objectPath("../ops", "a.jpg")).toThrow("not a bucket name");
	});
});
