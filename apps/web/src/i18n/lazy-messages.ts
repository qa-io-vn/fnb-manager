import type { MessageFile } from "./catalog";
import { messages } from "./index";

export function registerLazyMessages(files: readonly MessageFile[]): void {
	for (const file of files) {
		Object.assign(messages.vi, file.vi);
		Object.assign(messages.en, file.en);
	}
}
