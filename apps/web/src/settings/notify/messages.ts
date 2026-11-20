import type { MessageFile } from "../../i18n/catalog";
import { registerLazyMessages } from "../../i18n/lazy-messages";
import digestEn from "../../i18n/messages/settings-digest.en.json";
import digestVi from "../../i18n/messages/settings-digest.vi.json";
import notifyEn from "../../i18n/messages/settings-notify.en.json";
import notifyVi from "../../i18n/messages/settings-notify.vi.json";

export const notifyMessageFiles: readonly MessageFile[] = [
	{
		name: "settings-notify",
		prefix: "settings.notify.",
		excludedPrefixes: [],
		vi: notifyVi,
		en: notifyEn,
	},
	{
		name: "settings-digest",
		prefix: "settings.digest.",
		excludedPrefixes: [],
		vi: digestVi,
		en: digestEn,
	},
];

registerLazyMessages(notifyMessageFiles);
