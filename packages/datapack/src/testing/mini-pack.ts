import miniPackJson from "../../test/fixtures/plans/mini-pack.json" with {
	type: "json",
};
import { type DataPack, dataPackSchema } from "../pack/schema.js";

export function miniPack(): DataPack {
	return dataPackSchema.parse(miniPackJson);
}
