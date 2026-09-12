import fs from "fs";
import path from "path";
import prisma from "./db";

export interface StandardData {
  standard_id: string;
  standard_name: string;
  commodity: string;
  accrediting_authority: string;
  authoritative_source: string;
  authoritative_source_url: string;
  regulatory_citation: string;
  covered_dimensions: string[];
  excluded_dimensions: string[];
  covered_dimension_citations: Record<string, string>;
  excluded_dimension_rationales: Record<string, string>;
}

export async function seedStandards(filePath?: string): Promise<void> {
  const defaultPath = path.resolve(__dirname, "../../contracts/data/standards.json");
  const targetPath = filePath || defaultPath;

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Standards data file not found at ${targetPath}`);
  }

  const raw = fs.readFileSync(targetPath, "utf-8");
  const parsed = JSON.parse(raw);
  const standards: StandardData[] = parsed.standards || [];

  for (const s of standards) {
    await prisma.standard.upsert({
      where: { standardID: s.standard_id },
      update: {
        standardName: s.standard_name,
        commodity: s.commodity,
        accreditingAuthority: s.accrediting_authority,
        authoritativeSource: s.authoritative_source,
        authoritativeSourceUrl: s.authoritative_source_url,
        regulatoryCitation: s.regulatory_citation,
        coveredDimensions: s.covered_dimensions,
        excludedDimensions: s.excluded_dimensions,
        coveredCitations: s.covered_dimension_citations,
        excludedRationales: s.excluded_dimension_rationales,
      },
      create: {
        standardID: s.standard_id,
        standardName: s.standard_name,
        commodity: s.commodity,
        accreditingAuthority: s.accrediting_authority,
        authoritativeSource: s.authoritative_source,
        authoritativeSourceUrl: s.authoritative_source_url,
        regulatoryCitation: s.regulatory_citation,
        coveredDimensions: s.covered_dimensions,
        excludedDimensions: s.excluded_dimensions,
        coveredCitations: s.covered_dimension_citations,
        excludedRationales: s.excluded_dimension_rationales,
      },
    });
    console.log(`[SeedStandards] Upserted standard: ${s.standard_id} (${s.standard_name})`);
  }
}

if (require.main === module) {
  seedStandards()
    .then(() => {
      console.log("[SeedStandards] Standards ingestion complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[SeedStandards] Ingestion failed:", err);
      process.exit(1);
    });
}
