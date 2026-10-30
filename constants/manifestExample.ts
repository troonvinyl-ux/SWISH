// Nine real supplier lines supplied in this conversation, condensed for reproducible demonstrations.
// No auction price, condition tests or completed-sale evidence was supplied.
import { normaliseManifest } from '@/services/manifestParser';
export function suppliedManifestExample() {
  const products: Array<[string,string,string,number,number,number,string,string,string]> = [
    ['020525-00001-451164','Bike Helmet with LED Light','B0D6Y6D18B',1,19.62,0.43,'Sports & Outdoors','Outdoor Recreation','eMyn0aD8nxFoA08k3vtaV7HWH2OQfUEXlBToq80z'],
    ['140425-00001-395028','Peppy 4K Action Camera','B0DGPLH36F',2,25.84,0.42,'Electronics','Cameras & Photography','R74fQTru3AxyI8g9To8Xkjcar3Ov6EXU0hPrr6fR'],
    ['020525-00001-451171','3 in 1 Woodworking Router Jig','B0D8FG5H7T',2,19.99,0.40,'Tools & DIY','Hand Tools','pUrH302SkykXzxYBI3P58PWFy03WddyLdqNJsLlg'],
    ['020525-00001-451168','3-Way Dimmable Bedside Lamp with USB Ports','B0D73MJLHK',2,17.54,0.70,'Electronics','Lighting','uri5MfZ5RFYaKH4FmSl6TAPu8T9kjaf8BggFxDJJ'],
    ['020525-00001-451169','Cordless Heated Knee Massager','B0DFBSHGD7',3,26.76,0.41,'Health & Beauty','First Aid','mGG2s1dkfmb95a8QNyWqHe9NnSIOpYOGzc83KFVO'],
    ['020525-00001-451167','Peppy Mini WiFi Camera','B0D6VWVM2Q',3,26.60,0.09,'Electronics','Cameras & Photography','KSsILcaMvQyT9iPdlyLh6qPSgRnMd3LN7wlkkfUG'],
    ['020525-00001-451170','Rechargeable Heated Socks','B0DHH53PPL',3,22.78,0.43,'Sports & Outdoors','Outdoor Recreation','JztT2QAIrSq4l3jqJCrpwa8PwhjPTS2npPP0PCPc'],
    ['020525-00001-451166','3-Speed Electric Drill Pen with 20 Bits','B0DJY29GXX',4,18.99,0.18,'Tools & DIY','Hand Tools','NPzX9iTwNPICOvXmg5cfrjswLB5GWG5lzfAXQbQ6'],
    ['020525-00001-451165','Hidden Camera Detector','B0DGG653DG',5,23.99,0.07,'Electronics','Cameras & Photography','vYOanHkbzf1cGvA3sWPGMugLxLYy0ji6YK0ViMkn'],
  ];
  return normaliseManifest([
    ['Product SKU','Manifest SKU','Product Title','ASIN','EAN','Brand','Category Name','Sub Category Name','Image 1','Quantity','Condition','Grade','Unit Weight (kg)','Currency','Unit RRP','Total RRP','Product Description'],
    ...products.map(([sku,title,asin,quantity,rrp,weight,category,sub,image], i) => [sku,'spW91E1008R',title,asin,[0,2,3,5].includes(i) ? '7.890499e+11' : '7.999044e+11','Peppy',category,sub,`https://jobalots-production-bucket.s3.eu-west-2.amazonaws.com/product_image/${image}.png`,quantity,'Customer Return','NaN',weight,'GBP',rrp,rrp*quantity,i===1 ? 'Supplier advertises 4K; specification states 1920*1080 video.' : i===7 ? 'Supplier description claims 30 drills, while title states 20 bits.' : 'Supplier-provided details. Inspect actual item.']),
    ['','','','','','','','','','','','','','','Total',570.69],
  ]);
}
