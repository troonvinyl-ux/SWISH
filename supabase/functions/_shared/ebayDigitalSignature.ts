// eBay Finances API digital signatures for UK/EU seller accounts.
// Configure EBAY_SIGNATURE_PRIVATE_KEY (Ed25519 PKCS#8 PEM) and
// EBAY_SIGNATURE_KEY_JWE (the matching Public Key as JWE from eBay Key Management API)
// as server-only Edge Function secrets. Never expose either value to clients.

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function ebayFinancesSignatureHeaders(
  url: URL,
  method = 'GET',
): Promise<Record<string, string>> {
  const privateKeyPem = Deno.env.get('EBAY_SIGNATURE_PRIVATE_KEY')?.trim();
  const publicKeyJwe = Deno.env.get('EBAY_SIGNATURE_KEY_JWE')?.trim();
  if (!privateKeyPem || !publicKeyJwe) {
    throw new Error('eBay Finances API digital-signature secrets are not configured. Set EBAY_SIGNATURE_PRIVATE_KEY and EBAY_SIGNATURE_KEY_JWE in the server secret store.');
  }

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(privateKeyPem),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const created = Math.floor(Date.now() / 1000);
  const covered = '("x-ebay-signature-key" "@method" "@path" "@authority")';
  const signatureParams = `${covered};created=${created}`;
  const path = `${url.pathname}${url.search}`;
  const signatureBase = [
    `"x-ebay-signature-key": ${publicKeyJwe}`,
    `"@method": ${method.toUpperCase()}`,
    `"@path": ${path}`,
    `"@authority": ${url.host.toLowerCase()}`,
    `"@signature-params": ${signatureParams}`,
  ].join('\n');
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(signatureBase),
  ));

  return {
    'x-ebay-signature-key': publicKeyJwe,
    'Signature-Input': `sig1=${signatureParams}`,
    'Signature': `sig1=:${toBase64(signature)}:`,
  };
}
