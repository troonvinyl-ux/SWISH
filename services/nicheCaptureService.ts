// One photo-role contract for ordinary capture and Universal Quick List.
// Niche prompts and evidence requirements remain the existing SPECIALISTS configuration.
import { NICHE_MODULES, type ProductionNicheId } from '@/constants/niches';
import { SPECIALISTS, type SpecialistId, type CaptureRequirement } from '@/constants/specialists';
import { musicCaptureSlots } from './musicCaptureService';
export function nicheCaptureSlots(niche: ProductionNicheId, specialistId: string = NICHE_MODULES[niche]?.defaultSpecialist, mode = 'item', discCount?: string | number): CaptureRequirement[] {
  const product = NICHE_MODULES[niche];
  if (!product || !product.specialists.includes(specialistId)) return [];
  let source: CaptureRequirement[];
  if (niche === 'tunes_flip') source = musicCaptureSlots(mode, discCount);
  else if (mode === 'part' && (niche === 'motocross' || niche === 'bicycles')) source = [
    { id: 'main', label: 'Complete component', description: 'Show shape, mounting points and all included hardware', required: true },
    { id: 'part_number', label: 'Part number / label', description: 'Read the exact printed or stamped identifier', required: true },
    { id: 'back', label: 'Reverse / connections', description: 'Show the reverse, connectors and wear', required: true },
    { id: 'mounts', label: 'Mounts and connections', description: 'Show mounts, connectors and scale', required: false },
    { id: 'condition', label: 'Wear / damage', description: 'Show defects and missing parts', required: false },
  ];
  else source = SPECIALISTS[specialistId as SpecialistId]?.captureRequirements ?? [];
  const slots = source.map(slot => ({ ...slot }));
  // Preserve every configured role and requirement; baseline never replaces specialist evidence.
  const back = slots.find(slot => ['back', 'reverse', 'non_drive_side', 'right_side', 'back_sleeve'].includes(slot.id));
  if (back) back.required = true;
  else if (niche !== 'coins') slots.push({ id: 'back', label: 'Back / reverse', description: 'Photograph the reverse and physical condition', required: true });
  return slots;
}
