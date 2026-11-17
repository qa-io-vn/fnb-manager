import { z } from "zod";
import { dataPackSchema, planFrontMatterSchema } from "../src/index.js";

export interface SchemaDocument {
	readonly file: string;
	readonly id: string;
	readonly schema: z.ZodType;
}

export const SCHEMA_DOCUMENTS: readonly SchemaDocument[] = [
	{
		file: "fnb-datapack-1.schema.json",
		id: "urn:fnb:datapack:1",
		schema: dataPackSchema,
	},
	{
		file: "fnb-plan-1.schema.json",
		id: "urn:fnb:plan:1",
		schema: planFrontMatterSchema,
	},
];

export function jsonSchemaDocument(
	document: SchemaDocument,
): Record<string, unknown> {
	const { $schema, ...rest } = z.toJSONSchema(document.schema, {
		target: "draft-2020-12",
		io: "input",
	});
	return { $schema, $id: document.id, ...rest };
}
