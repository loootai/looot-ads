import { describe, expect, it } from "vitest";
import { demoReport } from "@/demo/seed";
import { adsToCsv, reportToMarkdown } from "./output";

describe("output", () => {
  const report = demoReport();
  it("writes one CSV row per ad with a header", () => {
    const lines = adsToCsv(report).trim().split("\n");
    expect(lines).toHaveLength(report.ads.length + 1);
    expect(lines[0]).toContain("landing_url");
  });
  it("quotes cells that hold commas or quotes", () => {
    const csv = adsToCsv({ ...report, ads: [{ ...report.ads[0], headline: 'Say "hi", friend' }] });
    expect(csv).toContain('"Say ""hi"", friend"');
  });
  it("writes a markdown brief with a section per competitor and a sources table", () => {
    const md = reportToMarkdown(report);
    for (const c of report.competitors) expect(md).toContain(`## ${c.name}`);
    expect(md).toContain("## Sources");
    expect(md).not.toMatch(/—/);
  });
});
