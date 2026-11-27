import config from "virtual:counter-config";
import { useI18n } from "@fnb/zalo-mini/i18n";
import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useStore } from "../lib/store";
import type { Order } from "../orders/types";
import { type Ticket, TicketView, ticketOf } from "./ticket";

/**
 * The printer seam (ADR-066): the app prints a ticket through a TicketPrinter. v1 is the browser's print dialog with an
 * 80 mm print style sheet; an ESC/POS printer over WebUSB or Web Bluetooth is a second implementation later, fed the
 * same Ticket model (lines of text with sizes), so no screen changes when it comes.
 */
export interface TicketPrinter {
	readonly kind: "browser" | "escpos";
	print(ticket: Ticket): Promise<void>;
}

interface PrinterValue {
	print(order: Order): Promise<void>;
	readonly kind: TicketPrinter["kind"];
}

const PrinterContext = createContext<PrinterValue | null>(null);

export function PrinterProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const { language } = useI18n();
	const { t } = useI18n();
	const { store } = useStore();
	const [ticket, setTicket] = useState<Ticket | null>(null);
	const browser = useMemo<TicketPrinter>(
		() => ({
			kind: "browser",
			async print(next) {
				setTicket(next);
				// let React draw the ticket before the dialog opens
				await new Promise((resolve) => setTimeout(resolve, 50));
				window.print();
			},
		}),
		[],
	);
	const value = useMemo<PrinterValue>(
		() => ({
			kind: browser.kind,
			print: (order) =>
				browser.print(
					ticketOf(
						order,
						{
							brand: language === "en" ? config.title.en : config.title.vi,
							store: store.name,
							printedAt: new Date(),
						},
						t,
					),
				),
		}),
		[browser, language, store.name, t],
	);
	return (
		<PrinterContext.Provider value={value}>
			{children}
			{ticket === null
				? null
				: createPortal(<TicketView ticket={ticket} />, document.body)}
		</PrinterContext.Provider>
	);
}

export function usePrinter(): PrinterValue {
	const value = useContext(PrinterContext);
	if (value === null) throw new Error("usePrinter needs a PrinterProvider");
	return value;
}
