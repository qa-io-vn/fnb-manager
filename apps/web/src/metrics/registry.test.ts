import { isMetricId, metricById } from "@fnb/metrics";
import { describe, expect, it } from "vitest";
import { isMessageKey, translate } from "../i18n";
import {
	displaySeries,
	displaySeriesIds,
	metricRegistry,
	registryMetricIds,
	toneForChange,
	webUnitOf,
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

	it.each(registryMetricIds)(
		"shows %s in the unit the registry declares",
		(id) => {
			expect(metricRegistry[id].unit).toBe(webUnitOf(metricById(id).unit));
		},
	);

	it("maps every registry unit the reports use to a display unit", () => {
		expect(webUnitOf("VND")).toBe("money");
		expect(webUnitOf("count")).toBe("count");
		expect(webUnitOf("items")).toBe("decimal");
		expect(webUnitOf("z")).toBe("decimal");
		expect(webUnitOf("fraction")).toBe("fraction");
		expect(webUnitOf("% change")).toBe("percentChange");
		expect(webUnitOf("VND and count")).toBe("money");
		expect(webUnitOf("class")).toBe("count");
	});

	it("explains every metric and display series in both languages", () => {
		for (const definition of Object.values(metricRegistry)) {
			for (const key of [
				definition.labelKey,
				definition.formulaKey,
				definition.grainKey,
				definition.conventionKey,
			]) {
				expect(isMessageKey(key), key).toBe(true);
				expect(translate("vi", key).trim(), key).not.toBe("");
				expect(translate("en", key).trim(), key).not.toBe("");
			}
		}
		expect(Object.keys(displaySeries).sort()).toEqual(
			[...displaySeriesIds].sort(),
		);
	});

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
