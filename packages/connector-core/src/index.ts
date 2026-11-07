export {
	assertCapability,
	capabilities,
	NO_CAPABILITIES,
} from "./capabilities.js";
export {
	type BusinessDateWindow,
	CAPABILITY_NAMES,
	type CapabilityName,
	type ConnectorCapabilities,
	type ConnectorDescriptor,
	collectSales,
	type FetchContext,
	type FlagSink,
	type PosConnector,
} from "./connector.js";
export {
	ConnectorAuthError,
	ConnectorCapabilityError,
	ConnectorError,
	ConnectorRateLimitError,
	ConnectorSchemaError,
	type SchemaIssue,
} from "./errors.js";
export { type ConnectorFactory, ConnectorRegistry } from "./registry.js";
export {
	assertWindow,
	type InstantRange,
	isWithinWindow,
	type StoreDayContext,
	singleDayWindow,
	splitWindow,
	windowDates,
	windowInstants,
} from "./window.js";
