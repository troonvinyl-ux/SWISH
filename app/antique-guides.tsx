import { AntiqueReference } from '@/components/feature/AntiqueReference';
const sections = [
 ['history','Periods & styles','Georgian, Victorian, Edwardian, Art Nouveau and Art Deco. Treat style as a clue, not proof of manufacturing date.'],
 ['verified','Maker marks & hallmarks','Photograph the complete mark, symbols, letter shapes and cartouche. Sponsor, retailer and maker marks are not necessarily the same.'],
 ['category','Ceramics, glass & pottery','Compare form, glaze, decoration, base construction and complete factory marks; partial resemblance does not establish a maker.'],
 ['chair','Furniture & construction','Inspect joints, drawer construction, veneers, hardware, underside and later repairs.'],
 ['watch','Clocks & metalware','Record accessible movement details, inscriptions, hallmarks and service history.'],
 ['palette','Art & sculpture','Distinguish original works, reproductions, impressions and attributions. Signatures require independent verification.'],
 ['menu-book','Books & collectables','Capture title and copyright pages, edition statements, number line, jacket and condition.'],
 ['gavel','Provenance & buying safely','Retain invoices and ownership history. Flag uncertain origin, export controls and cultural property concerns.'],
] as const;
export default function AntiqueGuidesScreen(){return <AntiqueReference title="Antique Guides" subtitle="Evidence-led reference for researching and describing antiques." sections={sections}/>;}
