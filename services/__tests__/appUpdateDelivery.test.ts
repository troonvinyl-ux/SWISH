// Mocked update delivery regressions, not installed APK acceptance.
jest.mock('react-native',()=>({Platform:{OS:'android'},Linking:{openURL:jest.fn().mockResolvedValue(undefined)}}));
jest.mock('expo-constants',()=>({nativeAppVersion:'1.0.0',nativeBuildVersion:'7',expoConfig:{version:'9.0.0',android:{versionCode:99}}}));
jest.mock('expo-updates',()=>({isEnabled:true,isEmbeddedLaunch:true,runtimeVersion:'native-runtime',channel:'preview-unified',updateId:null,checkForUpdateAsync:jest.fn(),fetchUpdateAsync:jest.fn(),reloadAsync:jest.fn()}));
jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import fs from 'node:fs';
import * as Updates from 'expo-updates';
import { automaticUpdateIntervalMs, shouldCheckAutomatically, isNewerNativeRelease } from '../appUpdatePolicyService';
import { installedAppVersion, checkCompatibleUpdate, downloadCompatibleUpdate, applyCompatibleUpdate } from '../appUpdateService';
beforeEach(()=>jest.clearAllMocks());
test('installed native version is not overwritten by OTA app config',()=>{
 expect(installedAppVersion()).toMatchObject({version:'1.0.0',build:'7',channel:'preview-unified',runtime:'native-runtime',otaEnabled:true});
});
test('automatic checks are throttled and cannot discard a downloaded update',()=>{
 expect(shouldCheckAutomatically(true,false,false,0,10)).toBe(true);
 expect(shouldCheckAutomatically(true,false,false,100,100+automaticUpdateIntervalMs)).toBe(true);
 for(const args of [[false,false,false,0,100],[true,true,false,0,100],[true,false,true,0,100],[true,false,false,100,100+1000]]) expect(shouldCheckAutomatically(...args as [boolean,boolean,boolean,number,number])).toBe(false);
});
test('native release lookup never recommends reinstalling an older or identical binary',()=>{
 expect(isNewerNativeRelease('1.0.0','7','1.0.0','8')).toBe(true);
 expect(isNewerNativeRelease('1.0.0','7','1.1.0','1')).toBe(true);
 for(const [version,build] of [['1.0.0','7'],['1.0.0','6'],['0.9.0','50'],['unknown','50'],['1.0.0','abc']]) expect(isNewerNativeRelease('1.0.0','7',version,build)).toBe(false);
});
test('compatible downloads are staged and never restart automatically',async()=>{
 (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({isAvailable:true});
 (Updates.fetchUpdateAsync as jest.Mock).mockResolvedValue({isNew:true});
 expect(await checkCompatibleUpdate()).toEqual({available:true,error:null});
 expect(await downloadCompatibleUpdate()).toEqual({ready:true,error:null});
 expect(Updates.reloadAsync).not.toHaveBeenCalled();
});
test('failed checks or downloads leave the installed app intact',async()=>{
 (Updates.checkForUpdateAsync as jest.Mock).mockRejectedValue(new Error('offline'));
 (Updates.fetchUpdateAsync as jest.Mock).mockRejectedValue(new Error('offline'));
 expect((await checkCompatibleUpdate()).error).not.toBeNull();
 expect((await downloadCompatibleUpdate()).ready).toBe(false);
 expect(Updates.reloadAsync).not.toHaveBeenCalled();
});
test('restart failures are actionable and do not write app data',async()=>{
 (Updates.reloadAsync as jest.Mock).mockRejectedValue(new Error('restart failed'));
 expect(await applyCompatibleUpdate()).toContain('current bundle is retained');
});
test('one root provider shares the update with every screen and notices require confirmation',()=>{
 const root=fs.readFileSync('app/_layout.tsx','utf8'),hook=fs.readFileSync('hooks/useAppUpdateController.ts','utf8'),consumer=fs.readFileSync('hooks/useAppUpdates.ts','utf8'),notice=fs.readFileSync('components/feature/AppUpdateNotice.tsx','utf8');
 expect(root.match(/<AppUpdatesProvider>/g)).toHaveLength(1);
 expect(root).toContain('<AppUpdateNotice');
 expect(consumer).toContain('useContext(AppUpdatesContext)');
 expect(hook).toContain('nativeState.isUpdatePending');
 expect(hook).toContain('ready.current');
 expect(hook).toContain("value === 'active'");
 expect(hook).not.toContain('setInterval(');
 expect(notice).toContain('Save any capture, draft or listing edits');
 expect(notice).toContain("text: 'Not now'");
 expect(notice).not.toContain("position: 'absolute'");
});
test('publication is explicitly Android-targeted without weakening fingerprint or review gates',()=>{
 const workflow=fs.readFileSync('.github/workflows/publish-swish-ota.yml','utf8'),verifier=fs.readFileSync('scripts/verify-unified-ota.mjs','utf8');
 expect(workflow).toContain('default: android');
 expect(workflow).toContain('--platform "$SWISH_OTA_PLATFORM"');
 expect(workflow).toContain('environment: swish-ota-approval');
 expect(workflow).not.toContain('  push:');
 expect(verifier).toContain('assertCompatibleRuntime');
 expect(verifier).toContain('runtimeversion:resolve');
 expect(verifier).toContain('assertNoNativeOtaChanges');
});
