// Pure conservative classification for unified imports. Not an entitlement grant.
export function inferImportNiche(categoryName: unknown, title: unknown): string | null {
 const category=String(categoryName ?? '').toLowerCase();const text=String(title ?? '').toLowerCase();
 const rules:[string,RegExp][]=[
 ['coins',/\b(coin|coins|numismatic|banknote|banknotes|denarius|dirham|tanka|bullion)\b/i],
 ['motocross',/\b(motocross|enduro|motorcycle|motorbike|pit bike|dirt bike)\b/i],
 ['bicycles',/\b(bicycle|bicycles|cycling|mountain bike|road bike|bmx)\b/i],
 ['clothing',/\b(clothing|fashion|garment|jacket|parka|trousers|jeans|dress|sneakers|trainers|t-shirt)\b/i],
 ['trading_cards',/\b(trading cards?|pokemon|pokémon|ccg|tcg|yu-gi-oh|magic the gathering)\b/i],
 ['antiques',/\b(antique|antiques|antiquarian|antique furniture)\b/i],
 ['fossils',/\b(fossil|fossils|ammonite|trilobite|mineral specimen)\b/i],
 ['beauty',/\b(beauty|cosmetic|cosmetics|skincare|makeup|perfume|fragrance|lipstick|serum)\b/i],
 ['tech',/\b(electronics|laptop|computer|smartphone|tablet|console|graphics card)\b/i],
 ['surplus_flip',/\b(pallet|job lot|surplus|manifest|liquidation|wholesale lot)\b/i],
 ['collectibles',/\b(giftware|memorabilia|jasperware|wedgwood|royal doulton|collectible bear|silver-plated|action figures?|figurines?|comic books?|comics|board games?|pop culture|diecast|model cars?|model trains?|toy soldiers?|vintage toys?|souvenirs?|lego sets?|star wars figures?|transformers figures?|funko pops?|hot wheels|matchbox cars?|movie memorabilia|music memorabilia|sports memorabilia|collectables)\b/i],
 ];
 const categoryMatches=rules.filter(([,test])=>test.test(category)).map(([id])=>id);
 const titleMatches=rules.filter(([,test])=>test.test(text)).map(([id])=>id);
 const combined=new Set([...categoryMatches,...titleMatches]);
 return combined.size===1?[...combined][0]:null;
}
