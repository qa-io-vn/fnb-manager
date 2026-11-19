import { type ComponentType, createContext, useContext } from "react";

export interface HomeTeamProps {
	readonly storeId: string;
}

export interface HomeTeamParts {
	readonly notices: ComponentType<HomeTeamProps>;
	readonly requests: ComponentType<HomeTeamProps>;
}

export const HomeTeamContext = createContext<HomeTeamParts | null>(null);

export function HomeTeamSlot({
	part,
	storeId,
}: HomeTeamProps & { readonly part: keyof HomeTeamParts }) {
	const parts = useContext(HomeTeamContext);
	const Part = parts?.[part];
	return Part === undefined ? null : <Part storeId={storeId} />;
}
