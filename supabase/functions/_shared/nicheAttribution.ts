type NicheProductSpecialists = {
  specialists?: string[];
  legacySpecialists?: string[];
};

export function nicheForSpecialist(
  specialistId: string | null | undefined,
  products: Record<string, NicheProductSpecialists>,
): string | null {
  if (!specialistId) return null;
  const matches = Object.entries(products)
    .filter(([, product]) => [...(product.specialists ?? []), ...(product.legacySpecialists ?? [])].includes(specialistId))
    .map(([nicheId]) => nicheId);
  return matches.length === 1 ? matches[0] : null;
}
