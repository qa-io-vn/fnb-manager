import { type ResizedPhoto, resizePhoto } from "@fnb/zalo-mini";
import { useI18n } from "@fnb/zalo-mini/react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { chooseImage } from "zmp-sdk";

export const PERMISSION_DENIED = -201;

export type PhotoTake =
	| { readonly kind: "photo"; readonly blob: Blob }
	| { readonly kind: "refused" }
	| { readonly kind: "none" };

export type CaptureResult =
	| { readonly kind: "photo"; readonly photo: ResizedPhoto }
	| { readonly kind: "refused" }
	| { readonly kind: "none" }
	| { readonly kind: "unreadable" };

export interface PhotoTools {
	take(): Promise<PhotoTake>;
	resize(blob: Blob): Promise<ResizedPhoto>;
}

function errorCode(error: unknown): number | null {
	if (typeof error !== "object" || error === null) return null;
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "number" ? code : null;
}

export async function takePhoto(): Promise<PhotoTake> {
	let path: string | undefined;
	try {
		const result = await chooseImage({
			sourceType: ["camera"],
			cameraType: "back",
			count: 1,
		});
		path = result.filePaths[0] ?? result.tempFiles[0]?.path;
	} catch (error) {
		return errorCode(error) === PERMISSION_DENIED
			? { kind: "refused" }
			: { kind: "none" };
	}
	if (path === undefined || path === "") return { kind: "none" };
	try {
		const response = await fetch(path);
		if (!response.ok) return { kind: "none" };
		return { kind: "photo", blob: await response.blob() };
	} catch {
		return { kind: "none" };
	} finally {
		if (path.startsWith("blob:")) URL.revokeObjectURL(path);
	}
}

export const devicePhotoTools: PhotoTools = {
	take: takePhoto,
	resize: (blob) => resizePhoto(blob),
};

const PhotoToolsContext = createContext<PhotoTools>(devicePhotoTools);

export function PhotoToolsProvider({
	tools,
	children,
}: {
	readonly tools: PhotoTools;
	readonly children: ReactNode;
}) {
	return (
		<PhotoToolsContext.Provider value={tools}>
			{children}
		</PhotoToolsContext.Provider>
	);
}

export function usePhotoTools(): PhotoTools {
	return useContext(PhotoToolsContext);
}

export async function capturePhoto(tools: PhotoTools): Promise<CaptureResult> {
	const taken = await tools.take();
	if (taken.kind !== "photo") return taken;
	try {
		return { kind: "photo", photo: await tools.resize(taken.blob) };
	} catch {
		return { kind: "unreadable" };
	}
}

export function usePreviewUrl(blob: Blob | null): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (blob === null) {
			setUrl(null);
			return;
		}
		const created = URL.createObjectURL(blob);
		setUrl(created);
		return () => URL.revokeObjectURL(created);
	}, [blob]);
	return url;
}

export function PhotoPreview({
	photo,
	label,
	testId = "photo-preview",
}: {
	readonly photo: ResizedPhoto | Blob;
	readonly label: string;
	readonly testId?: string;
}) {
	const blob = photo instanceof Blob ? photo : photo.blob;
	const url = usePreviewUrl(blob);
	if (url === null) return null;
	return (
		<img
			src={url}
			alt={label}
			data-testid={testId}
			data-bytes={blob.size}
			data-width={photo instanceof Blob ? undefined : photo.width}
			data-height={photo instanceof Blob ? undefined : photo.height}
			className="h-20 w-20 shrink-0 rounded-xl border border-line object-cover"
		/>
	);
}

export function UploadProgress({ fraction }: { readonly fraction: number }) {
	const { t } = useI18n();
	const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
	return (
		<div className="flex flex-col gap-1" role="status" aria-live="polite">
			<p className="text-sm text-ink-muted">
				{t("ops.photo.uploading", { percent })}
			</p>
			<div
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-label={t("ops.photo.progress")}
				className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
			>
				<div
					className="h-full rounded-full bg-accent transition-[width]"
					style={{ width: `${percent}%` }}
				/>
			</div>
		</div>
	);
}
