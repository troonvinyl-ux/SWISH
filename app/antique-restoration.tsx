import { AntiqueReference } from '@/components/feature/AntiqueReference';
const sections = [
 ['visibility','Document before touching','Photograph every side, marks, damage and repairs. Record dimensions and history before cleaning or dismantling.'],
 ['water-drop','Avoid aggressive cleaning','Do not polish, sand, use acids, solvents or abrasive products on unknown surfaces, patina, gilding or finishes.'],
 ['shield','Stabilise and protect','Keep fragile items supported, dry and away from direct sunlight, heat and rapid humidity changes. Use inert padded storage.'],
 ['search','Identify materials first','Unknown finishes, plated surfaces, ivory-like materials, ceramics and composites may need specialist identification before treatment.'],
 ['build','Use a qualified conservator','Important, signed, historically significant or structurally damaged objects need qualified assessment before intervention.'],
 ['payments','Estimate costs honestly','Separate professional quotations from AI estimates. Include transport, materials, labour and insurance; restoration can reduce value.'],
] as const;
export default function AntiqueRestorationScreen(){return <AntiqueReference title="Restoration & Care" subtitle="Conservation first. Never undertake irreversible treatment based only on photographs." sections={sections}/>;}
