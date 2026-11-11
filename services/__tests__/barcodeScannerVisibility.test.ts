// Scanner visibility and routing contracts; these do not verify device camera decoding.
import fs from 'node:fs';
import { quickBarcodeSupported, quickStartsWithBarcode } from '../quickListPolicyService';

const source = (path: string) => fs.readFileSync(path, 'utf8');

test('Collectibles opens in barcode mode while optional niches can choose it', () => {
  expect(quickStartsWithBarcode('collectibles')).toBe(true);
  for (const niche of ['tunes_flip', 'tech', 'beauty', 'clothing', 'surplus_flip'] as const) {
    expect(quickBarcodeSupported(niche)).toBe(true);
    expect(quickStartsWithBarcode(niche)).toBe(false);
  }
  expect(source('hooks/useQuickList.ts')).toContain('visual:!quickStartsWithBarcode(nicheId)');
});

test('optional retail barcode lookup does not replace specialist photo workflows', () => {
  for (const niche of ['coins', 'antiques', 'fossils', 'motocross', 'bicycles', 'trading_cards'] as const) {
    expect(quickBarcodeSupported(niche)).toBe(true);
    expect(quickStartsWithBarcode(niche)).toBe(false);
  }
  expect(source('components/feature/QuickListWorkspace.tsx')).toContain('{flow.barcodeSupported ? <View accessibilityRole="tablist"');
});

test('barcode mode, manual entry and product candidates are visible before More options', () => {
  const ui = source('components/feature/QuickListWorkspace.tsx');
  const more = ui.indexOf("more ? 'Hide options' : 'More options'");
  expect(more).toBeGreaterThan(0);
  for (const label of ['accessibilityLabel="Scan barcode"', 'Enter barcode manually', 'label="Product barcode"', 'state.leads.length ? <FlatList', 'BarcodeProductConfirmation']) {
    expect(ui.indexOf(label)).toBeGreaterThan(0);
    expect(ui.indexOf(label)).toBeLessThan(more);
  }
  expect(ui).toContain('onPress={flow.useBarcode}');
  expect(ui).toContain('Asking AI…');
  expect(ui).toContain("'Ask AI'");
  expect(ui).not.toContain('label="Optional barcode"');
});

test('camera scanning is focus, permission, session and mode gated on native and web', () => {
  const camera = source('hooks/useQuickListCamera.ts');
  expect(camera).toContain('focused&&ready&&permission?.granted&&!taking&&flow.scope&&flow.state.sessionId');
  expect(camera).toContain('!flow.state.visual&&!flow.state.lead&&!flow.state.leads.length');
  expect(camera).toContain('!flow.state.barcodeBusy&&!flow.state.processing&&!flow.state.draft&&!flow.state.itemId');
  expect(camera).toContain('if(!scanningRef.current)return');
  expect(camera).toContain("import('@zxing/browser')");
  expect(camera).toContain('scanning,flow.state.sessionId]');
  expect(source('components/feature/QuickListWorkspace.tsx')).toContain("onBarcodeScanned={camera.scanning && Platform.OS !== 'web' ? camera.onBarcode : undefined}");
});

test('switching to photos retains a selected lead for corroboration without publication', () => {
  const hook = source('hooks/useQuickList.ts');
  const visualAction = hook.slice(hook.indexOf('const useVisual='), hook.indexOf('const addPhoto='));
  expect(visualAction).toContain('barcodeSerial.current++');
  expect(visualAction).toContain('visual:true,leads:[],error');
  expect(visualAction).not.toContain('lead:null');
  expect(visualAction).not.toContain('publish(');
  expect(visualAction).not.toContain('createQuickInventory(');
  expect(hook).toContain('No barcode match found. Take photos or scan another barcode.');
  expect(hook).toContain('Barcode lookup unavailable. Take photos or try scanning again.');
});
