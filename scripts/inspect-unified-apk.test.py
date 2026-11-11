import copy
import importlib.util
import unittest
from pathlib import Path
import json
spec=importlib.util.spec_from_file_location('inspector',Path(__file__).with_name('inspect-unified-apk.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
baseline=json.loads(Path('release/android-installed-baseline.json').read_text())
class BinaryGateTests(unittest.TestCase):
    def setUp(self):
        self.config={'version':'1.0.0','android':{'versionCode':1794427892},'updates':{'url':'https://u.expo.dev/'+baseline['expectedProjectId'],'requestHeaders':{'expo-channel-name':'preview-unified'}}}
        self.actual={'nativeUpdaterPresent':True,'package':baseline['package'],'versionName':'1.0.0','versionCode':1794427892,'certificateSha256':baseline['certificateSha256'],'updatesEnabled':True,'updateUrl':self.config['updates']['url'],'channel':'preview-unified','runtimeVersion':'native','antiBrickingEnabled':True,'hasEmbeddedUpdate':True,'checkOnLaunch':'ALWAYS','targetSdk':36,'minSdk':24,'launchableActivity':'com.swish.inventory.MainActivity','schemes':['onspaceapp'],'permissions':['android.permission.CAMERA','android.permission.INTERNET']}
    def verify(self,actual):
        return m.verify_binary(actual,self.config,baseline,baseline['certificateSha256'],'native')
    def test_valid_binary_metadata(self):
        self.verify(self.actual)
    def test_rejects_certificate_configuration_and_runtime_tampering(self):
        for key,value in [('certificateSha256','0'*64),('updatesEnabled',False),('channel','other'),('runtimeVersion','other'),('updateUrl','https://other.example'),('versionCode',1794427891),('versionName','9.0.0'),('antiBrickingEnabled',False),('hasEmbeddedUpdate',False),('launchableActivity',None),('permissions',[]),('schemes',[])]:
            with self.subTest(key=key),self.assertRaises(ValueError):
                self.verify({**self.actual,key:value})
if __name__=='__main__':unittest.main()
