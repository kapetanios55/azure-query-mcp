import assert from "node:assert/strict";
import test from "node:test";

import type { LogsTable } from "@azure/monitor-query-logs";

import { shapeTable } from "../src/result-shaper.js";

test("caps rows and long cells", () => {
  const table: LogsTable = {
    name: "PrimaryResult",
    columnDescriptors: [{ name: "Message", type: "string" }],
    rows: [["abcdef"], ["second"]],
  };

  assert.deepEqual(shapeTable(table, { maxRows: 1, maxCellCharacters: 3 }), {
    name: "PrimaryResult",
    columns: [{ name: "Message", type: "string" }],
    rows: [["abc...[truncated]"]],
    returnedRows: 1,
    truncatedRows: 1,
  });
});