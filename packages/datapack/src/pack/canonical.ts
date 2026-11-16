import { notImplemented } from "./errors.js";

export type CanonicalValue =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalValue[]
	| { readonly [key: string]: CanonicalValue };

export function canonicalJson(_value: CanonicalValue): string {
	return notImplemented("canonicalJson");
}
