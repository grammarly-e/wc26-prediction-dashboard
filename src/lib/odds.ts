// ============================================================================
// World Cup 2026 win probability odds for each participating team.
// Source: user-provided odds table (June 2026).
// Keys are canonical team names as stored in the teams table.
// ============================================================================

export const TEAM_ODDS: Record<string, number> = {
  "Spain": 19.23,
  "France": 17.86,
  "England": 13.33,
  "Brazil": 10.53,
  "Portugal": 9.09,
  "Argentina": 9.09,
  "Germany": 7.14,
  "Netherlands": 5.88,
  "Belgium": 4.35,
  "Norway": 2.78,
  "Colombia": 2.44,
  "Japan": 2.17,
  "Morocco": 1.64,
  "United States of America": 1.64,
  "Uruguay": 1.64,
  "Mexico": 1.52,
  "Switzerland": 1.52,
  "Croatia": 1.41,
  "Turkey": 1.23,
  "Ecuador": 0.99,
  "Senegal": 0.79,
  "Austria": 0.79,
  "Canada": 0.57,
  "Sweden": 0.57,
  "Ivory Coast": 0.57,
  "Paraguay": 0.50,
  "Egypt": 0.40,
  "Scotland": 0.33,
  "Bosnia and Herzegovina": 0.25,
  "Ghana": 0.17,
  "Czechia": 0.17,
  "South Korea": 0.14,
  "Iran": 0.10,
  "Tunisia": 0.05,
  "Cape Verde": 0.04,
  "Uzbekistan": 0.04,
  "Haiti": 0.04,
  "Panama": 0.04,
  "Curacao": 0.04,
  "Qatar": 0.04,
  "Saudi Arabia": 0.04,
  "New Zealand": 0.04,
  "Australia": 0.04,
  "DR Congo": 0.04,
  "Iraq": 0.04,
  "Jordan": 0.04,
  "South Africa": 0.04,
};

/** Max combined odds (%) allowed for the 3 favourite team picks. */
export const FAVOURITES_ODDS_CAP = 25;

/** Lookup odds by canonical team name. Returns 0 for unlisted teams. */
export function getTeamOdds(teamName: string): number {
  return TEAM_ODDS[teamName] ?? 0;
}
