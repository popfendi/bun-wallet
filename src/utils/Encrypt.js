import {
  decodeAttestationObject,
  isoBase64URL,
} from "@simplewebauthn/server/helpers";
const crypto = window.crypto || window.msCrypto;

export async function encryptData(privateKey, masterKeyBase64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const masterKey = base64ToArrayBuffer(masterKeyBase64);

  const combinedKey = new Uint8Array([...new Uint8Array(masterKey), ...salt]);

  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", combinedKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const privateKeyArray =
    typeof privateKey === "string"
      ? new TextEncoder().encode(privateKey)
      : privateKey;
  const encryptedPrivateKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    privateKeyArray
  );

  return {
    encryptedPrivateKey: arrayBufferToBase64(encryptedPrivateKey),
    keyEncryptionIV: arrayBufferToBase64(iv),
    keyEncryptionSalt: arrayBufferToBase64(salt),
  };
}

export async function decryptData(encryptionData, masterKey) {
  const iv = base64ToArrayBuffer(encryptionData.keyEncryptionIV);
  const salt = base64ToArrayBuffer(encryptionData.keyEncryptionSalt);
  const encryptedPrivateKey = base64ToArrayBuffer(
    encryptionData.encryptedPrivateKey
  );
  const mk = base64ToArrayBuffer(masterKey);

  const combinedKey = new Uint8Array([
    ...new Uint8Array(mk),
    ...new Uint8Array(salt),
  ]);

  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", combinedKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decryptedPrivateKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encryptedPrivateKey
  );

  return new TextDecoder().decode(new Uint8Array(decryptedPrivateKey));
}

export async function decryptTempKey(encryptionData, masterKey) {
  const iv = base64ToArrayBuffer(encryptionData.keyEncryptionIV);
  const salt = base64ToArrayBuffer(encryptionData.keyEncryptionSalt);
  const encryptedPrivateKey = base64ToArrayBuffer(
    encryptionData.encryptedPrivateKey
  );
  const mk = base64ToArrayBuffer(masterKey);

  const combinedKey = new Uint8Array([
    ...new Uint8Array(mk),
    ...new Uint8Array(salt),
  ]);

  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", combinedKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decryptedPrivateKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encryptedPrivateKey
  );

  return decryptedPrivateKey;
}

// https://stackoverflow.com/a/11562550/9014097 or https://stackoverflow.com/a/9458996/9014097
export function arrayBufferToBase64(arrayBuffer) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(arrayBuffer)));
}

// https://stackoverflow.com/a/41106346 or https://stackoverflow.com/a/21797381/9014097
export function base64ToArrayBuffer(base64string) {
  return Uint8Array.from(atob(base64string), (c) => c.charCodeAt(0));
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

export async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array([...salt, ...passwordData])
  );
  return new Uint8Array(hashBuffer);
}

export async function deriveKeyFromPassword(password, salt) {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordData,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function verifyPassword(password, authData) {
  const salt = new Uint8Array(base64ToArrayBuffer(authData.salt));
  const passwordHash = await hashPassword(password, salt);
  return timingSafeEqual(
    passwordHash,
    new Uint8Array(base64ToArrayBuffer(authData.passwordHash))
  );
}

export async function generateTemporaryKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  return crypto.subtle.exportKey("raw", key);
}

export function extractPublicKey(attestationObject) {
  const attestationBuffer = isoBase64URL.toBuffer(attestationObject);
  const decodedAttestationObject = decodeAttestationObject(attestationBuffer);
  console.log(decodedAttestationObject);
  const authData = decodedAttestationObject.get("authData");
  console.log(authData);
  const dataView = new DataView(authData.buffer);
  const publicKeyLength = dataView.getUint16(53);
  return authData.slice(55, 55 + publicKeyLength);
}

export async function encryptMasterKey(masterKey, publicKey) {
  // Generate an ephemeral ECDH key pair
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // Import the stored public key
  const storedPublicKey = await crypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Perform ECDH to derive shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: storedPublicKey },
    ephemeralKeyPair.privateKey,
    256
  );

  // Derive AES key from shared secret
  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecretBits,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // Encrypt the master key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedMasterKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    aesKey,
    masterKey
  );

  // Export the ephemeral public key
  const ephemeralPublicKey = await crypto.subtle.exportKey(
    "raw",
    ephemeralKeyPair.publicKey
  );

  return {
    encryptedMasterKey: new Uint8Array(encryptedMasterKey),
    iv,
    ephemeralPublicKey: new Uint8Array(ephemeralPublicKey),
  };
}

export async function decryptMasterKey(publicKey, encryptionData) {
  // Import the stored public key
  const storedPublicKey = await crypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Import the ephemeral public key
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "raw",
    encryptionData.ephemeralPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Perform ECDH to derive shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: ephemeralPublicKey },
    storedPublicKey,
    256
  );

  // Derive AES key from shared secret
  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecretBits,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // Decrypt the master key
  const decryptedKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encryptionData.iv },
    aesKey,
    encryptionData.encryptedMasterKey
  );

  return new Uint8Array(decryptedKey);
}
