import type {
	CapabilityName,
	ConnectorCapabilities,
	ConnectorDescriptor,
} from "./connector.js";
import { ConnectorCapabilityError } from "./errors.js";

export const NO_CAPABILITIES: ConnectorCapabilities = {
	lines: false,
	modifiers: false,
	payments: false,
	shifts: false,
	adjustments: false,
	controlTotals: false,
	customers: false,
	guestCount: false,
	costs: false,
};

export function capabilities(
	enabled: Partial<ConnectorCapabilities>,
): ConnectorCapabilities {
	return { ...NO_CAPABILITIES, ...enabled };
}

export function assertCapability(
	descriptor: Pick<ConnectorDescriptor, "id" | "capabilities">,
	capability: CapabilityName,
): void {
	if (!descriptor.capabilities[capability]) {
		throw new ConnectorCapabilityError(descriptor.id, capability);
	}
}
