import {
	ConnectorAuthError,
	ConnectorRateLimitError,
	ConnectorSchemaError,
} from "@fnb/connector-core";
import { IposAuthError, IposHttpError, IposSchemaError } from "../errors.js";
import { IPOS_CONNECTOR_ID } from "./descriptor.js";

const RATE_LIMIT_STATUS = 429;

export function toConnectorError(error: unknown): unknown {
	if (error instanceof IposAuthError) {
		return new ConnectorAuthError(IPOS_CONNECTOR_ID, error.message, {
			cause: error,
		});
	}
	if (error instanceof IposSchemaError) {
		return new ConnectorSchemaError(
			IPOS_CONNECTOR_ID,
			error.endpoint,
			error.issues.map((issue) => ({
				path: issue.path.map(String).join("."),
				message: issue.message,
			})),
			{ cause: error },
		);
	}
	if (error instanceof IposHttpError && error.status === RATE_LIMIT_STATUS) {
		return new ConnectorRateLimitError(IPOS_CONNECTOR_ID, null, {
			cause: error,
		});
	}
	return error;
}

export async function translateErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		throw toConnectorError(error);
	}
}
