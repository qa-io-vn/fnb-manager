import { type ComponentType, createContext, useContext } from "react";

export interface HomeTaskProps {
	readonly storeId: string;
}

export const HomeTasksContext =
	createContext<ComponentType<HomeTaskProps> | null>(null);

export function HomeTaskSlot({ storeId }: HomeTaskProps) {
	const Tasks = useContext(HomeTasksContext);
	return Tasks === null ? null : <Tasks storeId={storeId} />;
}
