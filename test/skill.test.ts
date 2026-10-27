import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateQuery } from "../src/query-policy.js";
import { validateResourceGraphQuery } from "../src/resource-graph-policy.js";

import { semanticErrors } from "./kusto-analyzer.js";

// The agent skill in skills/azure-query documents this server. These tests keep it in
// step with the code: valid Agent Skills frontmatter, every tool and prompt documented,
// and every example query accepted by the policy it describes.
const skillDirectory = fileURLToPath(new URL("../skills/azure-query/", import.meta.url));
const skillFiles = [
  join(skillDirectory, "SKILL.md"),
  ...readdirSync(join(skillDirectory, "references")).map((file) => join(skillDirectory, "references", file)),
];
const read = (file: string) => readFileSync(file, "utf8");

function frontmatter(markdown: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(match?.[1], "SKILL.md must start with YAML frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(": ");
    assert.ok(separator > 0, `unparseable frontmatter line: ${line}`);
    const value = line.slice(separator + 2);
    // Plain YAML scalars break on ": " and " #"; keep values simple so every parser agrees.
    assert.ok(!value.includes(": ") && !value.includes(" #") && !/^["'&*!|>%@`{[]/.test(value), `frontmatter value needs quoting: ${line}`);
    fields[line.slice(0, separator)] = value;
  }
  return fields;
}

test("SKILL.md frontmatter follows the Agent Skills specification", () => {
  const fields = frontmatter(read(join(skillDirectory, "SKILL.md")));
  const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

  for (const key of Object.keys(fields)) {
    assert.ok(allowed.has(key), `unknown frontmatter field ${key}`);
  }
  assert.match(fields.name ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok((fields.name ?? "").length <= 64);
  assert.equal(fields.name, basename(skillDirectory), "name must match the skill directory");
  assert.ok(fields.description && fields.description.length <= 1_024, "description is required and at most 1,024 characters");
  assert.ok(!fields.compatibility || fields.compatibility.length <= 500, "compatibility is at most 500 characters");
});

test("the skill documents every tool and prompt the server registers", () => {
  const server = read(fileURLToPath(new URL("../src/server.ts", import.meta.url)));
  const names = [...server.matchAll(/register(?:Tool|Prompt)\(\s*"(\w+)"/g)].map((match) => match[1] ?? "");
  const documentation = skillFiles.map(read).join("\n");

  assert.ok(names.length >= 13, "expected to find the registered tools and prompts");
  for (const name of names) {
    assert.ok(documentation.includes(`\`${name}\``), `${name} is not documented in the skill`);
  }
});

test("relative links in the skill resolve", () => {
  for (const file of skillFiles) {
    for (const [, target = ""] of read(file).matchAll(/\]\(([^)#\s]+)\)/g)) {
      if (!/^[a-z]+:/.test(target)) {
        assert.ok(existsSync(join(dirname(file), target)), `${basename(file)} links to missing ${target}`);
      }
    }
  }
});

function kustoBlocks(file: string): string[] {
  return [...read(file).matchAll(/```kusto\n([\s\S]*?)```/g)].map((match) => (match[1] ?? "").trim());
}

const logAnalyticsExamples = kustoBlocks(join(skillDirectory, "references", "log-analytics-kql.md"));
const resourceGraphExamples = kustoBlocks(join(skillDirectory, "references", "resource-graph.md"));

test("the skill has example queries for both data planes", () => {
  assert.ok(logAnalyticsExamples.length >= 5);
  assert.ok(resourceGraphExamples.length >= 5);
});

for (const query of logAnalyticsExamples) {
  test(`Log Analytics example passes the policy and resolves against table schemas: ${query.split("\n")[0]}`, () => {
    assert.doesNotThrow(() => validateQuery(query));
    assert.deepEqual(semanticErrors(query), []);
  });
}

for (const query of resourceGraphExamples) {
  test(`Resource Graph example passes the policy: ${query.split("\n")[0]}`, () => {
    assert.doesNotThrow(() => validateResourceGraphQuery(query));
  });
}
