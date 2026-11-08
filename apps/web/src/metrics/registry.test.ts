import { isMetricId, metricById } from "@fnb/metrics";
import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import {
	displaySeriesIds,
	metricRegistry,
	registryMetricIds,
	toneForChange,
} from "./registry";

describe("web metrics and packages/metrics", () => {
	it.each(registryMetricIds)(
		"labels %s in Vietnamese and English exactly as the registry does",
		(id) => {
			const { label } = metricById(id);
			expect(translate("vi", metricRegistry[id].labelKey)).toBe(label.vi);
			expect(translate("en", metricRegistry[id].labelKey)).toBe(label.en);
		},
	);

	it.each(registryMetricIds)(
		"colours the chips of %s with the registry direction",
		(id) => {
			expect(metricRegistry[id].direction).toBe(metricById(id).direction);
		},
	);

	it("keeps the display series, which have no registry entry, out of the registry ids", () => {
		expect(displaySeriesIds.filter((id) => isMetricId(id))).toEqual([]);
		expect(Object.keys(metricRegistry).sort()).toEqual(
			[...registryMetricIds, ...displaySeriesIds].sort(),
		);
	});

	it("reads a rise as good, bad or neither from the direction", () => {
		expect(toneForChange("higher", 0.1)).toBe("positive");
		expect(toneForChange("lower", 0.1)).toBe("negative");
		expect(toneForChange("neutral", 0.1)).toBe("neutral");
		expect(toneForChange("higher", null)).toBe("neutral");
	});
});
