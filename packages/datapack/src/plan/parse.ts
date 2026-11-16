import { notImplemented } from "../pack/errors.js";
import type { PlanFrontMatter } from "./front-matter.js";
import type { InitiativeFieldId, PlanSectionId } from "./sections.js";

export interface PlanSectionBlock {
	readonly id: PlanSectionId | null;
	readonly number: number | null;
	readonly heading: string;
	readonly line: number;
	readonly body: string;
}

export interface PlanField {
	readonly text: string;
	readonly line: number;
}

export interface PlanInitiative {
	readonly number: number;
	readonly title: string;
	readonly line: number;
	readonly fields: Readonly<Partial<Record<InitiativeFieldId, PlanField>>>;
}

export interface PlanCitation {
	readonly ref: string;
	readonly table: string;
	readonly row: string;
	readonly column: string;
	readonly line: number;
	readonly written: string | null;
}

export interface ParsedPlan {
	readonly text: string;
	readonly frontMatter: PlanFrontMatter;
	readonly extraFrontMatterKeys: readonly string[];
	readonly sections: readonly PlanSectionBlock[];
	readonly initiatives: readonly PlanInitiative[];
	readonly citations: readonly PlanCitation[];
}

export function parsePlan(_text: string): ParsedPlan {
	return notImplemented("parsePlan");
}
