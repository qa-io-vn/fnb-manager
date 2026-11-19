import { type ComponentType, createContext, useContext } from "react";

export interface HomeLoyaltyProps {
	readonly storeId: string;
}

export const HomeLoyaltyContext =
	createContext<ComponentType<HomeLoyaltyProps> | null>(null);

export function HomeLoyaltySlot({ storeId }: HomeLoyaltyProps) {
	const Loyalty = useContext(HomeLoyaltyContext);
	return Loyalty === null ? null : <Loyalty storeId={storeId} />;
}
