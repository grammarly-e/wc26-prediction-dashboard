// ============================================================================
// Flag emoji lookup for the 48 confirmed World Cup 2026 teams.
//
// `teams.flag_emoji` exists in the schema but isn't populated by seed.ts, and
// writing to it would require a DB migration + re-sync. Resolving flags in
// code (by team display name) gets the same visual result everywhere the
// team name is already rendered, with zero schema/data changes.
//
// Most flags are built from ISO 3166-1 alpha-2 codes via Unicode regional
// indicator symbols (flagFromCode). England and Scotland don't have ISO
// country codes — they use the Unicode "tag sequence" mechanism for
// subdivision flags, so they're spelled out directly.
// ============================================================================

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - "A".charCodeAt(0);

function flagFromCode(iso2: string): string {
  return iso2
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET))
    .join("");
}

/** Team display name -> ISO 3166-1 alpha-2 code (or special-cased emoji below). */
const ISO_CODE_BY_TEAM: Record<string, string> = {
  Algeria: "DZ",
  Argentina: "AR",
  Australia: "AU",
  Austria: "AT",
  Belgium: "BE",
  "Bosnia and Herzegovina": "BA",
  Brazil: "BR",
  Canada: "CA",
  "Cape Verde": "CV",
  Colombia: "CO",
  Croatia: "HR",
  Curaçao: "CW",
  Czechia: "CZ",
  "DR Congo": "CD",
  Ecuador: "EC",
  Egypt: "EG",
  France: "FR",
  Germany: "DE",
  Ghana: "GH",
  Haiti: "HT",
  Iran: "IR",
  Iraq: "IQ",
  "Ivory Coast": "CI",
  Japan: "JP",
  Jordan: "JO",
  Mexico: "MX",
  Morocco: "MA",
  Netherlands: "NL",
  "New Zealand": "NZ",
  Norway: "NO",
  Panama: "PA",
  Paraguay: "PY",
  Portugal: "PT",
  Qatar: "QA",
  "Saudi Arabia": "SA",
  Senegal: "SN",
  "South Africa": "ZA",
  "South Korea": "KR",
  Spain: "ES",
  Sweden: "SE",
  Switzerland: "CH",
  Tunisia: "TN",
  Türkiye: "TR",
  USA: "US",
  Uruguay: "UY",
  Uzbekistan: "UZ",
};

/** Subdivision flags (Unicode tag-sequence emoji) that don't map to ISO country codes. */
const SPECIAL_FLAGS: Record<string, string> = {
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
};

/**
 * Flag emoji for a team's display name, or null if unknown (playoff-slot
 * placeholders, knockout slot codes like "1A"/"W74" before they resolve).
 */
export function flagForTeam(name: string): string | null {
  if (name in SPECIAL_FLAGS) return SPECIAL_FLAGS[name];
  const code = ISO_CODE_BY_TEAM[name];
  return code ? flagFromCode(code) : null;
}
