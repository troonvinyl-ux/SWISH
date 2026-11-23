import fs from 'node:fs';
import {
  listingClaimState, musicContentsEvidence, protectMusicListingCopy,
  physicalCategory, unattributedCoinCopy,
} from '../../shared/listingEvidence';

test('catalogue and AI claims never become independently confirmed from seller review',()=>{
 expect(listingClaimState({value:'Roman',origin:'suggestion',reviewed:true})).toBe('unconfirmed');
 expect(listingClaimState({value:'N#123',origin:'catalogue',reviewed:true})).toBe('catalogue');
 expect(listingClaimState({value:'2.5 g',origin:'seller_reported',reviewed:true})).toBe('reported');
 expect(listingClaimState({value:'',origin:'photo_observation',reviewed:true})).toBe('unknown');
});

test('physical disc count remains unknown unless the subscriber reports it',()=>{
 const unknown=musicContentsEvidence(2,'','Vinyl LP');
 expect(unknown.status).toBe('unknown');
 expect(unknown.observed).toBeNull();
 expect(unknown.disclosure).toContain('unknown');
});

test('one of two records is explicitly incomplete, without inventing missing disc identity',()=>{
 const contents=musicContentsEvidence(2,'1','Vinyl LP');
 expect(contents.status).toBe('incomplete');
 expect(contents.disclosure).toBe('Incomplete — 1 of 2 records included');
 const copy=protectMusicListingCopy('Various Artists album','Seller-observed sleeve wear. Playback not tested.',contents);
 expect(copy.title.startsWith(contents.disclosure)).toBe(true);
 expect(copy.title.length).toBeLessThanOrEqual(80);
 expect(copy.description).toContain(contents.disclosure);
 expect(copy.description).toContain('Missing disc identity is not assumed');
 expect(protectMusicListingCopy(copy.title,copy.description,contents)).toEqual(copy);
});

test('unknown measurements and unattributed culture are not guessed from photographs',()=>{
 const coin=unattributedCoinCopy('',undefined);
 expect(coin.title).toMatch(/Unattributed coin/);
 expect(coin.description).toMatch(/Weight: unknown/);
 expect(coin.description).toMatch(/Diameter: unknown/);
 expect(coin.description).not.toMatch(/Roman|Hellenistic/);
 expect(unattributedCoinCopy('1.51','16').description).toContain('Weight: 1.51 g (seller-measured)');
});

test('a book depicting Greek coins remains a book when its physical type is known',()=>{
 expect(physicalCategory('Hardback book','Greek coins')).toBe('books');
 expect(physicalCategory('Physical coin','Roman soldier')).toBe('coins');
 expect(physicalCategory('','Greek coin')).toBe('unknown');
});

test('native capture and saved listing route retain physical contents disclosures and canonical publishing',()=>{
 const music=fs.readFileSync('services/musicCaptureService.ts','utf8');
 const quick=fs.readFileSync('services/quickListService.ts','utf8');
 expect(music).toContain('_music_contents_disclosure');
 expect(quick).toContain('protectMusicListingCopy');
 expect(quick).toContain('No complete-set tracklisting');
 expect(quick).toContain('submitListingToMarketplace');
 expect(quick).toContain('confirmQuickLive');
 expect(quick).toContain('mode===\'draft\'');
});
