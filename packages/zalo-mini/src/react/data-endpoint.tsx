import { createContext, type ReactNode, useContext } from "react";
import { type DataEndpoint, STAND_IN_DATA } from "../data/endpoint";

const DataEndpointContext = createContext<DataEndpoint>(STAND_IN_DATA);

export interface DataEndpointProviderProps {
	readonly endpoint: DataEndpoint;
	readonly children: ReactNode;
}

export function DataEndpointProvider({
	endpoint,
	children,
}: DataEndpointProviderProps) {
	return (
		<DataEndpointContext.Provider value={endpoint}>
			{children}
		</DataEndpointContext.Provider>
	);
}

export function useDataEndpoint(): DataEndpoint {
	return useContext(DataEndpointContext);
}
