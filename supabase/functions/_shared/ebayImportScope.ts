// Pure conservative classification for unified imports. Not an entitlement grant.
export function inferImportNiche(categoryName: unknown, title: unknown): string | null {
 const category=String(categoryName ?? '').toLowerCase();const text=String(title ?? '').toLowerCase();
 const stamps=/\b(stamps|postage stamp|postage stamps|philately|philatelic|first day cover|postal history|miniature sheet|stamp booklet)\b/i;
 const crafting=/rubber stamps?|craft stamps?|embossing|stamp duty|stamping tool/i;
 const rules:[string,RegExp][]=[
 ['stamps',stamps],
 ['tunes_flip',/\b(vinyl|vinyl record|audio cassette|compact disc|music cd|lp record|7[- ]inch single|12[- ]inch single)\b/i],
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
 ['collectibles',/\b(giftware|memorabilia|jasperware|wedgwood|royal doulton|collectible bear|silver-plated|action figures?|comic books?|comics|board games?|diecast|model cars?|model trains?|toy soldiers?|vintage toys?|funko pop|hot wheels|toys)\b/i],
 ];
 const categoryMatches=rules.filter(([id,test])=>test.test(category)&&(id!=='stamps'||!crafting.test(category))).map(([id])=>id);
 const titleMatches=rules.filter(([id,test])=>test.test(text)&&(id!=='stamps'||!crafting.test(text))).map(([id])=>id);
 const combined=new Set([...categoryMatches,...titleMatches]);
 // A philatelic job lot is still Stamps, not a pallet/manifest business; explicit other-product conflicts stay in review.
 if(combined.has('stamps')&&!/\b(pallet|manifest|liquidation)\b/i.test(category+' '+text))combined.delete('surplus_flip');
 return combined.size===1?[...combined][0]:null;
}
