import { DemoSettingsStore } from "@fnb/demo-analytics";

let shared: DemoSettingsStore | null = null;

export function sharedDemoSettings(): DemoSettingsStore {
	shared ??= new DemoSettingsStore();
	return shared;
}
