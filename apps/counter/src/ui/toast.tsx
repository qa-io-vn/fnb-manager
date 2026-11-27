import { Toast } from "@fnb/zalo-mini/ui-kit";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

interface ToastValue {
	show(message: string): void;
}

const ToastContext = createContext<ToastValue>({ show: () => undefined });

/** One short message at a time on the inverse pill; never the only place a result is stated. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
	const [message, setMessage] = useState<{
		readonly text: string;
		readonly key: number;
	} | null>(null);
	const show = useCallback(
		(text: string) => setMessage({ text, key: Date.now() }),
		[],
	);
	const value = useMemo(() => ({ show }), [show]);
	return (
		<ToastContext.Provider value={value}>
			{children}
			{message === null ? null : (
				<Toast
					key={message.key}
					message={message.text}
					onDone={() => setMessage(null)}
					testId="toast"
				/>
			)}
		</ToastContext.Provider>
	);
}

export function useToast(): ToastValue {
	return useContext(ToastContext);
}
