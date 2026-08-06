import type { LogsTable } from "@azure/monitor-query-logs";

export interface ResultLimits {
  maxRows: number;
  maxCellCharacters: number;
}

export interface ShapedTable {
  name: string;
  columns: Array<{ name?: string; type?: string }>;
  rows: unknown[][];
  returnedRows: number;
  truncatedRows: number;
}

const defaultLimits: ResultLimits = {
  maxRows: 1_000,
  maxCellCharacters: 2_000,
};

function shapeCell(value: unknown, maxCharacters: number): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  const rendered = value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

  return rendered.length <= maxCharacters
    ? rendered
    : `${rendered.slice(0, maxCharacters)}...[truncated]`;
}

export function shapeTable(
  table: LogsTable,
  limits: ResultLimits = defaultLimits,
): ShapedTable {
  const rows = table.rows.slice(0, limits.maxRows).map((row) =>
    row.map((cell) => shapeCell(cell, limits.maxCellCharacters)),
  );

  return {
    name: table.name,
    columns: table.columnDescriptors.map(({ name, type }) => ({ name, type })),
    rows,
    returnedRows: rows.length,
    truncatedRows: Math.max(0, table.rows.length - rows.length),
  };
}