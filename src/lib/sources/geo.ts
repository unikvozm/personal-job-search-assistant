import type { WorkMode } from "../jobs/types";

const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const EUROPE = [...EU, "GB", "CH", "NO", "IS", "UA", "RS"];

const US_STATES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|san francisco|seattle|boston|chicago|austin|denver|los angeles|nyc";

/** Matched case-sensitively against the original text so "Berlin, DE" is not read as Delaware. */
const US_STATE_CODES =
  "AL|AK|AZ|AR|CA|CO|CT|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

/** Lowercase name/alias patterns → ISO alpha-2. Regions expand to several codes. */
const PATTERNS: [RegExp, string[]][] = [
  [/\b(worldwide|anywhere|global)\b/, []],
  [/\b(european union|eu)\b/, EU],
  [/\b(europe|emea)\b/, EUROPE],
  [/\b(usa|u\.s\.a?|united states(?! minor)|us)\b(?!.*samoa)/, ["US"]],
  [new RegExp(`\\b(${US_STATES})\\b`), ["US"]],
  [new RegExp(`,\\s*(${US_STATE_CODES})\\b`), ["US"]],
  [/\b(uk|united kingdom|england|scotland|wales|london|manchester|edinburgh)\b/, ["GB"]],
  [/\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|leipzig)\b/, ["DE"]],
  [/\b(netherlands|holland|amsterdam|rotterdam|utrecht|the hague|eindhoven)\b/, ["NL"]],
  [/\b(austria|österreich|vienna|wien|graz)\b/, ["AT"]],
  [/\b(switzerland|schweiz|zurich|zürich|geneva|basel|bern)\b/, ["CH"]],
  [/\b(france|paris|lyon)\b/, ["FR"]],
  [/\b(spain|españa|madrid|barcelona|valencia)\b/, ["ES"]],
  [/\b(portugal|lisbon|lisboa|porto)\b/, ["PT"]],
  [/\b(ireland|dublin)\b/, ["IE"]],
  [/\b(poland|warsaw|krakow|kraków|wroclaw)\b/, ["PL"]],
  [/\b(sweden|stockholm)\b/, ["SE"]],
  [/\b(denmark|copenhagen)\b/, ["DK"]],
  [/\b(norway|oslo)\b/, ["NO"]],
  [/\b(finland|helsinki)\b/, ["FI"]],
  [/\b(belgium|brussels|antwerp)\b/, ["BE"]],
  [/\b(italy|milan|rome)\b/, ["IT"]],
  [/\b(czech|prague)\b/, ["CZ"]],
  [/\b(canada|toronto|vancouver|montreal)\b/, ["CA"]],
  [/\b(australia|sydney|melbourne)\b/, ["AU"]],
  [/\b(singapore)\b/, ["SG"]],
  [/\b(india|bangalore|bengaluru|hyderabad|pune)\b/, ["IN"]],
];

/** Best-effort country detection from a free-text location. Empty = unknown / worldwide. */
export function countriesFrom(location: string): string[] {
  const text = location.trim();
  if (!text) return [];
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const [re, codes] of PATTERNS) {
    // The state-code pattern is the only uppercase one; everything else matches lowercase text.
    if (re.test(re.source.includes(US_STATE_CODES) ? text : lower)) codes.forEach((c) => found.add(c));
  }
  return [...found];
}

export function workModeFrom(...texts: (string | null | undefined)[]): WorkMode | null {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\bremote\b|work from home|wfh|telecommut/.test(t)) return "remote";
  if (/\bon-?site\b|in office|in-office/.test(t)) return "onsite";
  return null;
}
