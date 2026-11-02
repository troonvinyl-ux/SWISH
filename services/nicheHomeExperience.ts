export interface NicheHomeExperience {
  headline: string;
  focusTitle: string;
  focusBody: string;
  evidenceChecks: string[];
  cautionTitle: string;
  cautionBody: string;
}

const EXPERIENCES: Record<string, NicheHomeExperience> = {
  trading_cards: {
    headline: 'Identify the card. Record its condition. Decide whether grading is worth it.',
    focusTitle: 'Card evidence checklist',
    focusBody: 'Capture the front and back before making a condition or value decision.',
    evidenceChecks: ['Set, number, language and edition', 'Front and back centering', 'All four corners and edge wear', 'Surface scratches, dents and print defects'],
    cautionTitle: 'Do not promise a professional grade',
    cautionBody: 'Photo review is an evidence aid, not a grading certificate. Keep raw-card and graded-card scenarios separate.',
  },
  fossils: {
    headline: 'Document the specimen, its anatomy and its provenance before pricing it.',
    focusTitle: 'Specimen evidence checklist',
    focusBody: 'A useful record shows the specimen, the surrounding matrix and enough scale to assess its features.',
    evidenceChecks: ['Main specimen and diagnostic anatomy', 'Ruler or scale reference', 'Matrix, reverse and preparation', 'Repairs, composites, casts and restoration', 'Reported locality and provenance evidence'],
    cautionTitle: 'Provenance comes before a confident claim',
    cautionBody: 'Image analysis cannot certify species, geological age or collection rights. Record the seller’s evidence and check protected-site and export restrictions before listing.',
  },
  beauty: {
    headline: 'Check the product, packaging and dates before deciding whether it is safe to resell.',
    focusTitle: 'Product and packaging checklist',
    focusBody: 'Record the exact product identity and its condition; packaging details can materially affect resale eligibility.',
    evidenceChecks: ['Brand, product line, shade or variant', 'Seal and packaging condition', 'Batch or lot code and expiry / period-after-opening details', 'Ingredients, volume and included accessories', 'Signs of tampering, leakage or counterfeit risk'],
    cautionTitle: 'Safety is a listing gate',
    cautionBody: 'Do not list expired, recalled, opened or suspect products as new or safe. Verify applicable restrictions and product authenticity independently; photographs alone cannot establish either.',
  },
  tech: {
    headline: 'Identify the exact model, test what works and record what is included.',
    focusTitle: 'Device test checklist',
    focusBody: 'A model match is only the start. Record functional tests and disclose anything that could not be checked.',
    evidenceChecks: ['Exact model, model number and serial label', 'Power-on, display, buttons and ports', 'Battery health / charging where applicable', 'Accessories, cables, storage and packaging', 'Activation lock, account lock and reset status'],
    cautionTitle: 'A photograph cannot prove functionality',
    cautionBody: 'Do not describe an untested device as working. Confirm account and activation locks are removed, disclose faults and keep serial-number evidence private where appropriate.',
  },
};

export function getNicheHomeExperience(nicheId: string | null | undefined): NicheHomeExperience | null {
  if (!nicheId) return null;
  return EXPERIENCES[nicheId] ?? null;
}