import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Microsoft's Kusto language service (the parser behind Azure Data Explorer and Log
// Analytics) resolves every table, column and function in a query against a snapshot of
// the official table schemas (scripts/update-table-schemas.mjs).
const require = createRequire(import.meta.url);
require("@kusto/language-service-next/bridge.js");
require("@kusto/language-service-next/Kusto.Language.Bridge.js");
const Kusto = (globalThis as any).Kusto.Language;

const schemas = JSON.parse(
  readFileSync(new URL("./fixtures/table-schemas.json", import.meta.url), "utf8"),
) as Record<string, Array<[string, string]>>;

const tables = Object.entries(schemas).map(([name, columns]) =>
  Kusto.Symbols.TableSymbol.From(`(${columns.map(([column, type]) => `['${column}']:${type.toLowerCase()}`).join(", ")})`).WithName(name),
);
const globals = Kusto.GlobalState.Default.WithDatabase(new Kusto.Symbols.DatabaseSymbol.$ctor1("Workspace", tables));

export function semanticErrors(query: string): string[] {
  const diagnostics = Kusto.KustoCode.ParseAndAnalyze(query, globals).GetDiagnostics();
  const errors: string[] = [];
  for (let index = 0; index < diagnostics.Count; index += 1) {
    const diagnostic = diagnostics.getItem(index);
    if (String(diagnostic.Severity) === "Error") {
      errors.push(`${diagnostic.Message} at "${query.substr(diagnostic.Start, Math.max(diagnostic.Length, 12))}"`);
    }
  }
  return errors;
}
