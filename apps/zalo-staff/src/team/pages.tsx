import type { TeamPath } from "./env";
import { TeamRoute } from "./route";
import { TEAM_SCREENS } from "./screens";

/**
 * The team screens as one lazily loaded chunk: the notices, requests,
 * approvals and notification settings, with their demo and live sources.
 */
export default function TeamPage({ path }: { readonly path: TeamPath }) {
	const entry = TEAM_SCREENS.find((candidate) => candidate.path === path);
	if (entry === undefined) return null;
	return (
		<TeamRoute
			titleKey={entry.titleKey}
			testId={entry.testId}
			screen={entry.screen}
		/>
	);
}
