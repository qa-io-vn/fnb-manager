import type { PosConnector } from "./connector.js";
import { ConnectorError } from "./errors.js";

export interface ConnectorFactory<TOptions = unknown> {
	id: string;
	create(options: TOptions): PosConnector;
}

export class ConnectorRegistry {
	private readonly factories = new Map<string, ConnectorFactory>();

	register<TOptions>(factory: ConnectorFactory<TOptions>): this {
		if (this.factories.has(factory.id)) {
			throw new ConnectorError(
				factory.id,
				`connector "${factory.id}" is already registered`,
			);
		}
		this.factories.set(factory.id, factory as ConnectorFactory);
		return this;
	}

	has(id: string): boolean {
		return this.factories.has(id);
	}

	ids(): string[] {
		return [...this.factories.keys()];
	}

	create(id: string, options: unknown): PosConnector {
		const factory = this.factories.get(id);
		if (!factory) {
			throw new ConnectorError(
				id,
				`no connector registered under "${id}" (known: ${this.ids().join(", ") || "none"})`,
			);
		}
		return factory.create(options);
	}
}
