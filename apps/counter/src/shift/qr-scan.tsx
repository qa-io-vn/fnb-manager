import { useI18n } from "@fnb/zalo-mini/i18n";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/dialog";
import { QrIcon } from "../ui/icons";
import { button } from "../ui/kit";

interface DetectedBarcode {
	readonly rawValue: string;
}
interface BarcodeDetectorLike {
	detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorConstructor = new (options: {
	formats: string[];
}) => BarcodeDetectorLike;

function detectorClass(): BarcodeDetectorConstructor | null {
	const value = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
		.BarcodeDetector;
	return value ?? null;
}

/**
 * "Quét mã" with the tablet's camera where the browser reads QR codes (BarcodeDetector: Chrome on Android); elsewhere
 * (Safari on an iPad) the button is not shown and the code printed under the QR is typed.
 */
export function QrScanButton({
	onCode,
}: {
	readonly onCode: (text: string) => void;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	if (detectorClass() === null) return null;
	return (
		<>
			<button
				type="button"
				className={button.secondary}
				onClick={() => setOpen(true)}
				data-testid="scan-qr"
			>
				<QrIcon />
				{t("scan.button")}
			</button>
			{open ? (
				<ScanDialog
					onClose={() => setOpen(false)}
					onCode={(text) => {
						setOpen(false);
						onCode(text);
					}}
				/>
			) : null}
		</>
	);
}

function ScanDialog({
	onClose,
	onCode,
}: {
	readonly onClose: () => void;
	readonly onCode: (text: string) => void;
}) {
	const { t } = useI18n();
	const video = useRef<HTMLVideoElement>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const Detector = detectorClass();
		if (Detector === null) return;
		let stream: MediaStream | null = null;
		let timer: ReturnType<typeof setInterval> | undefined;
		let stopped = false;
		navigator.mediaDevices
			?.getUserMedia({ video: { facingMode: "environment" } })
			.then(async (media) => {
				if (stopped) {
					for (const track of media.getTracks()) track.stop();
					return;
				}
				stream = media;
				if (video.current === null) return;
				video.current.srcObject = media;
				await video.current.play();
				const detector = new Detector({ formats: ["qr_code"] });
				timer = setInterval(() => {
					if (video.current === null) return;
					detector
						.detect(video.current)
						.then((codes) => {
							const first = codes[0];
							if (first !== undefined) onCode(first.rawValue);
						})
						.catch(() => undefined);
				}, 300);
			})
			.catch(() => setFailed(true));
		return () => {
			stopped = true;
			if (timer !== undefined) clearInterval(timer);
			for (const track of stream?.getTracks() ?? []) track.stop();
		};
	}, [onCode]);
	return (
		<Dialog
			title={t("scan.title")}
			onClose={onClose}
			closeLabel={t("common.close")}
			size="sm"
		>
			{failed ? (
				<p role="alert">{t("scan.noCamera")}</p>
			) : (
				<video
					ref={video}
					className="aspect-square w-full rounded-card-xl bg-black object-cover"
					playsInline
					muted
				/>
			)}
		</Dialog>
	);
}
