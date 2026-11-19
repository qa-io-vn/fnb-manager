import { describe, expect, it } from "vitest";
import {
	customerInput,
	formPhone,
	inputParameter,
} from "../../src/oa/input.js";

const SUBSCRIBER = "900000123";
const INTERNATIONAL = `+84${SUBSCRIBER}`;

describe("form answers", () => {
	it("keeps only the name and the phone in E.164 form", () => {
		const input = customerInput("user_submit_info", {
			event_name: "user_submit_info",
			info: {
				name: "  Khách\u0000 Thử ",
				phone: `0${SUBSCRIBER}`,
				address: "Số 1 Đường Thử",
				city: "Thành phố",
				user_dob: "01/01/2000",
				gender: "1",
			},
		});
		expect(input).toEqual({
			kind: "form",
			phone: INTERNATIONAL,
			name: "Khách Thử",
		});
		expect(Object.keys(inputParameter(input)).sort()).toEqual([
			"kind",
			"name",
			"phone",
		]);
	});

	it("reads the national, the 84-prefixed, the + and the spaced forms of a phone", () => {
		expect(formPhone(`0${SUBSCRIBER}`)).toBe(INTERNATIONAL);
		expect(formPhone(`84${SUBSCRIBER}`)).toBe(INTERNATIONAL);
		expect(
			formPhone(`+84 ${SUBSCRIBER.slice(0, 3)} ${SUBSCRIBER.slice(3)}`),
		).toBe(INTERNATIONAL);
		expect(formPhone(Number(`84${SUBSCRIBER}`))).toBe(INTERNATIONAL);
	});

	it("answers no phone for an unreadable, empty or oversized value and an absent info", () => {
		expect(formPhone("abc")).toBeNull();
		expect(formPhone("")).toBeNull();
		expect(formPhone("0".repeat(40))).toBeNull();
		expect(formPhone({ number: SUBSCRIBER })).toBeNull();
		expect(customerInput("user_submit_info", {})).toEqual({
			kind: "form",
			phone: null,
			name: null,
		});
	});
});

describe("menu keywords", () => {
	it("recognises the join keyword in a sent text and nothing in other texts or events", () => {
		expect(
			customerInput("user_send_text", {
				message: { text: "#join", msg_id: "m1" },
			}),
		).toEqual({ kind: "keyword", action: "join" });
		expect(
			customerInput("user_send_text", { message: { text: "Xin chào quán" } }),
		).toEqual({ kind: "none" });
		expect(
			customerInput("user_send_text", {
				message: { text: `#join${" ".repeat(40)}` },
			}),
		).toEqual({ kind: "none" });
		expect(customerInput("follow", { message: { text: "#join" } })).toEqual({
			kind: "none",
		});
	});
});
