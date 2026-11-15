import { createContext, type ReactNode, useContext } from "react";
import { type CsvDialect, DEFAULT_CSV_DIALECT } from "../lib/csv";

const CsvDialectContext = createContext<CsvDialect>(DEFAULT_CSV_DIALECT);

export function CsvDialectProvider({
	dialect,
	children,
}: {
	dialect: CsvDialect;
	children: ReactNode;
}) {
	return (
		<CsvDialectContext.Provider value={dialect}>
			{children}
		</CsvDialectContext.Provider>
	);
}

export function useCsvDialect(): CsvDialect {
	return useContext(CsvDialectContext);
}
