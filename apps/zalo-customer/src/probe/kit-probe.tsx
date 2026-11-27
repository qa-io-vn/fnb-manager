import {
	ChipGroup,
	kitButton,
	OptionPills,
	PriceText,
	StatusPill,
	Stepper,
	StickyActionBar,
	Toast,
} from "@fnb/zalo-mini/react";
import { useState } from "react";
import { Card, Screen } from "../ui";

// The design kit on one screen, for the Development build only (the marker "kit-probe" keeps it out of a Testing
// build): every component of the kit in each of its states, so the design checks can look at them on a themed brand in
// light and dark, at each phone width. The words are plain sample words, not the copy of any brand.

const CHIPS = [
	{ key: "one", label: "Nhóm một", tone: 1 },
	{ key: "two", label: "Nhóm hai", tone: 2 },
	{ key: "three", label: "Nhóm ba", tone: 3 },
	{ key: "four", label: "Nhóm bốn", tone: 4 },
	{ key: "plain", label: "Chung" },
] as const;

const SIZES = [
	{ value: "m", label: "Vừa" },
	{
		value: "l",
		label: "Lớn",
		note: <PriceText amount={5000} kind="delta" size="note" tone="muted" />,
	},
] as const;

/** The kit screen; `actionBar` false leaves out the sticky action bar, so a tab route with the strip shows exactly two bars. */
export function KitScreen({
	actionBar = true,
}: {
	readonly actionBar?: boolean;
} = {}) {
	const [chip, setChip] = useState("one");
	const [size, setSize] = useState<"m" | "l" | null>("m");
	const [extras, setExtras] = useState<readonly string[]>(["foam"]);
	const [quantity, setQuantity] = useState(2);
	const [single, setSingle] = useState(1);
	const [toast, setToast] = useState(false);
	return (
		<Screen testId="kit-probe">
			<h1 className="text-2xl font-bold text-ink">Bộ giao diện</h1>

			<Card testId="kit-buttons">
				<h2 className="text-lg font-bold text-ink">Nút</h2>
				<div className="flex flex-col gap-2">
					{(Object.keys(kitButton) as (keyof typeof kitButton)[]).map(
						(name) => (
							<button
								key={name}
								type="button"
								className={kitButton[name]}
								data-variant={name}
							>
								{`Nút ${name}`}
							</button>
						),
					)}
					<button
						type="button"
						className={kitButton.primary}
						disabled
						data-variant="disabled"
					>
						Nút tắt
					</button>
					<p className="text-sm text-ink-muted">
						Chọn đủ các mục bắt buộc trước khi tiếp tục.
					</p>
				</div>
			</Card>

			<Card testId="kit-chips">
				<h2 className="text-lg font-bold text-ink">Nhóm lọc</h2>
				<ChipGroup
					label="Nhóm mẫu"
					chips={CHIPS}
					selected={chip}
					onSelect={setChip}
					testId="kit-chip-group"
				/>
			</Card>

			<Card testId="kit-options">
				<h2 className="text-lg font-bold text-ink">Lựa chọn</h2>
				<OptionPills
					legend="Cỡ mẫu"
					name="kit-size"
					options={SIZES}
					value={size}
					onChange={setSize}
					testId="kit-size"
				/>
				<OptionPills
					legend="Thêm mẫu"
					name="kit-extra"
					multiple
					options={[
						{ value: "pearl", label: "Mục một" },
						{ value: "foam", label: "Mục hai" },
					]}
					value={extras}
					onChange={setExtras}
					testId="kit-extra"
				/>
			</Card>

			<Card testId="kit-steppers">
				<h2 className="text-lg font-bold text-ink">Số lượng</h2>
				<Stepper
					value={quantity}
					max={20}
					onChange={setQuantity}
					onRemove={() => setQuantity(1)}
					decreaseLabel="Bớt một"
					increaseLabel="Thêm một"
					removeLabel="Bỏ mục"
					testId="kit-stepper"
				/>
				<Stepper
					value={single}
					max={1}
					onChange={setSingle}
					decreaseLabel="Bớt một"
					increaseLabel="Thêm một"
					testId="kit-stepper-limit"
				/>
			</Card>

			<Card testId="kit-pills">
				<h2 className="text-lg font-bold text-ink">Nhãn trạng thái</h2>
				<div className="flex flex-wrap gap-2">
					<StatusPill tone="badge">Mới</StatusPill>
					<StatusPill tone="positive">Đã xong</StatusPill>
					<StatusPill tone="negative">Đã hủy</StatusPill>
					<StatusPill tone="warning">Chờ xử lý</StatusPill>
					<StatusPill tone="neutral">Tạm hết</StatusPill>
				</div>
			</Card>

			<Card testId="kit-prices">
				<h2 className="text-lg font-bold text-ink">Giá</h2>
				<p className="flex flex-wrap items-baseline gap-3">
					<PriceText amount={35000} size="list" />
					<PriceText amount={74000} size="lead" tone="ink" />
					<PriceText amount={5000} kind="delta" size="note" tone="muted" />
					<PriceText amount={-5000} kind="delta" size="note" tone="muted" />
				</p>
			</Card>

			<Card testId="kit-bars">
				<h2 className="text-lg font-bold text-ink">Thanh thao tác</h2>
				{actionBar ? (
					<StickyActionBar testId="kit-action-bar">
						<Stepper
							value={quantity}
							max={20}
							onChange={setQuantity}
							decreaseLabel="Bớt một"
							increaseLabel="Thêm một"
						/>
						<button type="button" className={`${kitButton.primary} flex-1`}>
							Thêm vào giỏ
						</button>
					</StickyActionBar>
				) : null}
				<button
					type="button"
					className={kitButton.secondary}
					onClick={() => setToast(true)}
					data-testid="kit-toast-open"
				>
					Hiện thông báo
				</button>
				{toast ? (
					<Toast
						message="Đã thêm một mục."
						onDone={() => setToast(false)}
						testId="kit-toast"
					/>
				) : null}
			</Card>
		</Screen>
	);
}

/** A strip above the tab bar for the route chrome checks (Development builds with ?strip=1): an order in progress, sample words. */
export function KitStrip() {
	return (
		<div
			data-testid="kit-strip"
			className="mx-3 mb-2 flex min-h-12 items-center justify-between gap-3 rounded-card-xl bg-inverse px-4 text-body text-inverse-ink"
		>
			<span>Đơn mẫu · Đang làm</span>
			<button
				type="button"
				className="min-h-11 min-w-11 font-bold text-inverse-ink underline"
			>
				Xem
			</button>
		</div>
	);
}
