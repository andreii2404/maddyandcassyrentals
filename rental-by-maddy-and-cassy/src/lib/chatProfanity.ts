// Profanity filter for customer chat messages (English and Tagalog/Filipino).
//
// The same algorithm and term list are implemented in Postgres by
// private.chat_message_has_profanity (supabase/migrations/
// 20261001160000_chat_profanity_filter.sql), which send_chat_message calls so
// the rule cannot be bypassed by calling the RPC directly. This module gives
// the composer instant feedback. Keep both in sync: scripts/testMessaging.ts
// fails when a term or character map here is missing from the migration.
//
// Matching rules, chosen to block bypass attempts without flagging ordinary
// words that merely contain a profane fragment:
// - text is NFKD-normalised, accents and zero-width characters are removed,
//   look-alike Cyrillic letters become Latin, and everything is lower-cased;
// - common symbol/number substitutions are reversed (f@ck, sh!t, 5hit, b1tch);
// - every letter in a term may repeat (fuuuck, gaaago);
// - punctuation inside a word is ignored (f.u.c.k, tang-ina);
// - three or more single letters in a row are joined (f u c k, g a g o);
// - `*` and `#` inside a word stand for exactly one hidden letter (f**k);
// - "word" terms must match the whole word (plus listed suffixes), so
//   Fukuoka, putahe (dish), Niger, class and assistant stay allowed;
// - "contains" terms are matched anywhere and are reserved for strings that
//   never occur inside ordinary English or Tagalog words;
// - "phrase" terms match consecutive words (tang ina, hayop ka).

export type ProfanityMatchKind = "contains" | "word" | "phrase";

export interface ProfanityTerm {
  kind: ProfanityMatchKind;
  term: string;
  /** Endings allowed after the term; "" means the bare term. */
  suffixes: readonly string[];
}

export const PROFANITY_TERMS: readonly ProfanityTerm[] = [
  // English, matched anywhere inside a word.
  { kind: "contains", term: "fuck", suffixes: ["", "s", "ed", "er", "ers", "ing", "in", "face", "head", "off", "wit"] },
  { kind: "contains", term: "fck", suffixes: ["", "s", "ed", "er", "ing"] },
  { kind: "contains", term: "phuck", suffixes: ["", "s", "ed", "er", "ing"] },
  { kind: "contains", term: "cocksucker", suffixes: ["", "s"] },
  // Tagalog/Filipino, matched anywhere inside a word.
  { kind: "contains", term: "putangina", suffixes: ["", "mo", "ng"] },
  { kind: "contains", term: "tangina", suffixes: ["", "mo", "ng"] },
  { kind: "contains", term: "pukingina", suffixes: ["", "mo"] },
  { kind: "contains", term: "kantot", suffixes: ["", "an", "in"] },
  { kind: "contains", term: "kantut", suffixes: ["", "an"] },
  { kind: "contains", term: "pakyu", suffixes: ["", "ka"] },
  { kind: "contains", term: "pakshet", suffixes: [""] },
  // English, whole words only.
  { kind: "word", term: "fuk", suffixes: ["", "s", "ed", "er", "ing", "in"] },
  { kind: "word", term: "fuq", suffixes: ["", "ing"] },
  { kind: "word", term: "shit", suffixes: ["", "s", "ty", "ting", "ted", "head", "heads", "face", "hole", "load", "show", "bag"] },
  { kind: "word", term: "bullshit", suffixes: ["", "s", "ting"] },
  { kind: "word", term: "horseshit", suffixes: [""] },
  { kind: "word", term: "dipshit", suffixes: ["", "s"] },
  { kind: "word", term: "batshit", suffixes: [""] },
  { kind: "word", term: "bitch", suffixes: ["", "es", "y", "ing", "ass"] },
  { kind: "word", term: "biatch", suffixes: ["", "es"] },
  { kind: "word", term: "asshole", suffixes: ["", "s"] },
  { kind: "word", term: "arsehole", suffixes: ["", "s"] },
  { kind: "word", term: "dumbass", suffixes: ["", "es"] },
  { kind: "word", term: "jackass", suffixes: ["", "es"] },
  { kind: "word", term: "bastard", suffixes: ["", "s"] },
  { kind: "word", term: "cunt", suffixes: ["", "s", "y"] },
  { kind: "word", term: "dickhead", suffixes: ["", "s"] },
  { kind: "word", term: "whore", suffixes: ["", "s"] },
  { kind: "word", term: "slut", suffixes: ["", "s", "ty"] },
  { kind: "word", term: "twat", suffixes: ["", "s"] },
  { kind: "word", term: "wanker", suffixes: ["", "s"] },
  { kind: "word", term: "douchebag", suffixes: ["", "s"] },
  { kind: "word", term: "nigger", suffixes: ["", "s"] },
  { kind: "word", term: "nigga", suffixes: ["", "s", "z"] },
  { kind: "word", term: "faggot", suffixes: ["", "s"] },
  { kind: "word", term: "retard", suffixes: ["", "s", "ed"] },
  // Tagalog/Filipino, whole words only.
  { kind: "word", term: "puta", suffixes: ["", "ng"] },
  { kind: "word", term: "pota", suffixes: ["", "ng"] },
  { kind: "word", term: "taena", suffixes: ["", "mo"] },
  { kind: "word", term: "tngina", suffixes: ["", "mo"] },
  { kind: "word", term: "tangna", suffixes: ["", "mo"] },
  { kind: "word", term: "kingina", suffixes: ["", "mo"] },
  { kind: "word", term: "gago", suffixes: ["", "ng"] },
  { kind: "word", term: "ulol", suffixes: ["", "ng"] },
  { kind: "word", term: "ulul", suffixes: [""] },
  { kind: "word", term: "tarantado", suffixes: ["", "ng"] },
  { kind: "word", term: "tarantada", suffixes: [""] },
  { kind: "word", term: "punyeta", suffixes: ["", "ng"] },
  { kind: "word", term: "bobo", suffixes: ["", "ng"] },
  { kind: "word", term: "tanga", suffixes: ["", "ng"] },
  { kind: "word", term: "shunga", suffixes: ["", "ng"] },
  { kind: "word", term: "gunggong", suffixes: [""] },
  { kind: "word", term: "kupal", suffixes: ["", "ng"] },
  { kind: "word", term: "pokpok", suffixes: ["", "ng"] },
  { kind: "word", term: "hindot", suffixes: ["", "ng"] },
  { kind: "word", term: "jakol", suffixes: ["", "in"] },
  { kind: "word", term: "salsal", suffixes: [""] },
  { kind: "word", term: "bilat", suffixes: [""] },
  { kind: "word", term: "burat", suffixes: [""] },
  { kind: "word", term: "tite", suffixes: ["", "ng"] },
  { kind: "word", term: "pekpek", suffixes: [""] },
  { kind: "word", term: "iyot", suffixes: ["", "an", "in"] },
  // Tagalog/Filipino, consecutive words.
  { kind: "phrase", term: "tang ina", suffixes: [""] },
  { kind: "phrase", term: "puking ina", suffixes: [""] },
  { kind: "phrase", term: "puchang ina", suffixes: [""] },
  { kind: "phrase", term: "hayop ka", suffixes: [""] },
  { kind: "phrase", term: "hayup ka", suffixes: [""] },
  { kind: "phrase", term: "pak yu", suffixes: [""] },
  { kind: "phrase", term: "pak shet", suffixes: [""] },
];

/** Look-alike Cyrillic letters (both cases) mapped to Latin; same strings as the SQL translate(). */
export const HOMOGLYPH_FROM = "аеорсухікАЕОРСУХІК";
export const HOMOGLYPH_TO = "aeopcyxikaeopcyxik";

/** Symbol and number substitutions; same strings as the SQL translate(). */
export const LEET_FROM = "0134578@$!|+";
export const LEET_TO = "oieastbasiit";

function translate(value: string, from: string, to: string): string {
  let result = "";
  for (const character of value) {
    const index = from.indexOf(character);
    result += index === -1 ? character : to[index];
  }
  return result;
}

/** Every letter may repeat: "gago" -> "g+a+g+o+". */
function termPattern(term: string): string {
  return term.replace(/([a-z])/g, "$1+");
}

function alternation(values: readonly string[]): string {
  return values.join("|");
}

const containsPattern = new RegExp(
  alternation(
    PROFANITY_TERMS.filter((entry) => entry.kind === "contains").map((entry) => termPattern(entry.term)),
  ),
);

const wordPattern = new RegExp(
  `^(?:${alternation(
    PROFANITY_TERMS.filter((entry) => entry.kind === "word").map(
      (entry) => `${termPattern(entry.term)}(?:${alternation(entry.suffixes)})`,
    ),
  )})$`,
);

const phrasePatterns = PROFANITY_TERMS.filter((entry) => entry.kind === "phrase").map((entry) =>
  entry.term.split(" ").map((part) => new RegExp(`^${termPattern(part)}$`)),
);

/** Literal spellings tested against masked words such as "f**k". */
const termForms = PROFANITY_TERMS.filter((entry) => entry.kind !== "phrase").flatMap((entry) =>
  entry.suffixes.map((suffix) => `${entry.term}${suffix}`),
);

function normalizeText(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[​-‍﻿­]/g, "");
  return translate(normalized, HOMOGLYPH_FROM, HOMOGLYPH_TO);
}

function letterCandidateIsProfane(candidate: string): boolean {
  return containsPattern.test(candidate) || wordPattern.test(candidate);
}

function candidateIsProfane(candidate: string): boolean {
  if (!/[*#]/.test(candidate)) return letterCandidateIsProfane(candidate);

  const letters = candidate.replace(/[*#]/g, "");
  if (letters && letterCandidateIsProfane(letters)) return true;
  if (letters.length < 2 || candidate.length - letters.length > letters.length) return false;
  const pattern = new RegExp(`^${termPattern(candidate).replace(/[*#]/g, "[a-z]")}$`);
  return termForms.some((form) => pattern.test(form));
}

/** True when the message contains blocked English or Tagalog/Filipino language. */
export function containsProfanity(message: string): boolean {
  const candidates: string[] = [];
  const tokens: string[] = [];
  let letterRun = "";

  const flushLetterRun = () => {
    if (letterRun.length >= 3) candidates.push(letterRun);
    letterRun = "";
  };

  for (const rawWord of normalizeText(message).split(/\s+/)) {
    const trimmed = rawWord
      .replace(/^[^a-z0-9@$]+/, "")
      .replace(/[^a-z0-9*#$]+$/, "");
    const word = translate(trimmed, LEET_FROM, LEET_TO);
    const joined = word.replace(/[^a-z*#]/g, "");
    if (!joined) continue;

    tokens.push(joined);
    candidates.push(joined);
    for (const piece of word.split(/[^a-z*#]+/)) {
      if (piece) candidates.push(piece);
    }

    if (joined.length === 1) {
      letterRun += joined;
    } else {
      flushLetterRun();
    }
  }
  flushLetterRun();

  if (candidates.some(candidateIsProfane)) return true;

  return phrasePatterns.some((parts) => {
    for (let start = 0; start + parts.length <= tokens.length; start += 1) {
      if (parts.every((pattern, offset) => pattern.test(tokens[start + offset]))) return true;
    }
    return false;
  });
}
