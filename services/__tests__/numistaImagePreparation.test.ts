jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG:'jpeg' } }));
import { manipulateAsync } from 'expo-image-manipulator';
import { prepareNumistaImages } from '../numistaImagePreparationService';
const manipulate = manipulateAsync as jest.Mock;
const jpeg = (width:number,height:number) => Buffer.from([255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,0,3,17,0,255,217]).toString('base64');
beforeEach(()=>{jest.clearAllMocks();manipulate.mockResolvedValue({uri:'file://analysis.jpg',base64:jpeg(768,1024),width:768,height:1024});});
test('stored HTTPS originals are decoded locally into provider-compatible JPEG bytes',async()=>{
  const originals=[{uri:'https://storage.example/one.jpg'},{uri:'https://storage.example/two.jpg'},{uri:'https://storage.example/detail.jpg'}];
  const result=await prepareNumistaImages(originals);
  expect(result).toHaveLength(2);expect(manipulate).toHaveBeenCalledTimes(2);
  expect(result[0].image_data).not.toContain('https:');expect(result[0].mime_type).toBe('image/jpeg');
  expect(originals[0].uri).toBe('https://storage.example/one.jpg');
});
test('portrait unknown dimensions are bounded again by their actual long edge',async()=>{
  manipulate.mockResolvedValueOnce({uri:'file://oversize.jpg',width:1024,height:2048,base64:jpeg(1024,2048)});
  const result=await prepareNumistaImages([{uri:'file://source.heic'}]);
  expect(manipulate.mock.calls[1][1]).toEqual([{resize:{width:512,height:1024}}]);expect(result[0].height).toBe(1024);
});
test('photo decoding failure does not fetch a raw remote fallback',async()=>{
  manipulate.mockRejectedValue(new Error('Decoder unavailable'));
  await expect(prepareNumistaImages([{uri:'file://source.heic'}])).rejects.toThrow('Decoder unavailable');
});
