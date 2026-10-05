/**
 * Replaces KQL string literals with empty literals and comments with spaces, so policy
 * checks only inspect query code. Keywords that appear inside strings (for example
 * `where OperationName has "delete"`) must not be treated as operators.
 *
 * Handles regular strings ('...' and "..." with backslash escapes), verbatim strings
 * (@'...' and @"..." where a doubled quote escapes), multi-line strings (```...```) and
 * line comments (//...). Throws on an unterminated literal so malformed input fails closed.
 */
export function stripLiteralsAndComments(query: string): string {
  let output = "";
  let index = 0;

  while (index < query.length) {
    const char = query[index];
    const next = query[index + 1];

    if (char === "/" && next === "/") {
      const end = query.indexOf("\n", index);
      index = end === -1 ? query.length : end;
      output += " ";
      continue;
    }

    if (query.startsWith("```", index)) {
      const end = query.indexOf("```", index + 3);
      if (end === -1) {
        throw new Error("KQL query contains an unterminated multi-line string.");
      }
      index = end + 3;
      output += '""';
      continue;
    }

    if (char === "@" && (next === '"' || next === "'")) {
      index = skipVerbatimString(query, index + 1, next);
      output += '""';
      continue;
    }

    if (char === '"' || char === "'") {
      index = skipEscapedString(query, index, char);
      output += '""';
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function skipEscapedString(query: string, start: number, quote: string): number {
  for (let index = start + 1; index < query.length; index += 1) {
    if (query[index] === "\\") {
      index += 1;
    } else if (query[index] === quote) {
      return index + 1;
    } else if (query[index] === "\n") {
      break;
    }
  }

  throw new Error("KQL query contains an unterminated string literal.");
}

function skipVerbatimString(query: string, start: number, quote: string): number {
  for (let index = start + 1; index < query.length; index += 1) {
    if (query[index] !== quote) {
      continue;
    }
    if (query[index + 1] === quote) {
      index += 1;
      continue;
    }
    return index + 1;
  }

  throw new Error("KQL query contains an unterminated string literal.");
}
