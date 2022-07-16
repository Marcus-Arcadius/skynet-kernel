import { blake2b } from "./blake2b.js";
import { bufToB64, b64ToBuf, encodePrefixedBytes, encodeU64 } from "./encoding.js";
import { addContextToErr } from "./err.js";
import { Ed25519Keypair, ed25519KeypairFromEntropy, ed25519Sign, ed25519Verify } from "./ed25519.js";
import { SEED_BYTES } from "./seed.js";
import { sha512 } from "./sha512.js";
import { Err } from "./types.js";

// computeRegistrySignature will take a secret key and the required fields of a
// registry entry and use them to compute a registry signature, returning both
// the signature and the encoded data for the registry entry.
function computeRegistrySignature(
  secretKey: Uint8Array,
  dataKey: Uint8Array,
  data: Uint8Array,
  revision: bigint
): [signature: Uint8Array, err: Err] {
  // Check that the data is the right size.
  if (data.length > 86) {
    return [new Uint8Array(0), "registry data must be at most 86 bytes"];
  }

  // Build the encoded data.
  const [encodedData, errEPB] = encodePrefixedBytes(data);
  if (errEPB !== null) {
    return [new Uint8Array(0), addContextToErr(errEPB, "unable to encode provided registry data")];
  }
  const [encodedRevision, errEU64] = encodeU64(revision);
  if (errEU64 !== null) {
    return [new Uint8Array(0), addContextToErr(errEU64, "unable to encode the revision number")];
  }

  // Build the signing data.
  const dataToSign = new Uint8Array(32 + 8 + data.length + 8);
  dataToSign.set(dataKey, 0);
  dataToSign.set(encodedData, 32);
  dataToSign.set(encodedRevision, 32 + 8 + data.length);
  const sigHash = blake2b(dataToSign);

  // Sign the data.
  const [sig, errS] = ed25519Sign(sigHash, secretKey);
  if (errS !== null) {
    return [new Uint8Array(0), addContextToErr(errS, "unable to sign registry entry")];
  }
  return [sig, null];
}

// deriveRegistryEntryID derives a registry entry ID from a provided pubkey and
// datakey.
function deriveRegistryEntryID(pubkey: Uint8Array, datakey: Uint8Array): [Uint8Array, string | null] {
  // Check the lengths of the inputs.
  if (pubkey.length !== 32) {
    return [new Uint8Array(0), "pubkey is invalid, length is wrong"];
  }
  if (datakey.length !== 32) {
    return [new Uint8Array(0), "datakey is not a valid hash, length is wrong"];
  }

  // Establish the encoding. First 16 bytes is a specifier, second 8
  // bytes declares the length of the pubkey, the next 32 bytes is the
  // pubkey and the final 32 bytes is the datakey. This encoding is
  // determined by the Sia protocol.
  const encoding = new Uint8Array(16 + 8 + 32 + 32);
  // Set the specifier.
  encoding[0] = "e".charCodeAt(0);
  encoding[1] = "d".charCodeAt(0);
  encoding[2] = "2".charCodeAt(0);
  encoding[3] = "5".charCodeAt(0);
  encoding[4] = "5".charCodeAt(0);
  encoding[5] = "1".charCodeAt(0);
  encoding[6] = "9".charCodeAt(0);
  // Set the pubkey.
  const [encodedLen, errU64] = encodeU64(32n);
  if (errU64 !== null) {
    return [new Uint8Array(0), addContextToErr(errU64, "unable to encode pubkey length")];
  }
  encoding.set(encodedLen, 16);
  encoding.set(pubkey, 16 + 8);
  encoding.set(datakey, 16 + 8 + 32);

  // Get the final ID by hashing the encoded data.
  const id = blake2b(encoding);
  return [id, null];
}

// entryIDToSkylink converts a registry entry id to a resolver skylink.
function entryIDToSkylink(entryID: Uint8Array): string {
  const v2Skylink = new Uint8Array(34);
  v2Skylink.set(entryID, 2);
  v2Skylink[0] = 1;
  return bufToB64(v2Skylink);
}

// skylinkToResolverEntryData will convert a skylink to the Uint8Array that can
// be set as the entry data of a resolver link to create a working resolver
// link.
//
// It's just a passthrough to b64ToBuf, but that's not obvious unless you are
// familiar with the internals of how resolver skylinks work. This function is
// provided as an intuitive alternative.
function skylinkToResolverEntryData(skylink: string): [Uint8Array, Err] {
  return b64ToBuf(skylink);
}

// registryEntryKeys will use the user's seed to derive a keypair and a datakey
// using the provided seed and tags. The keypairTag is a tag which salts the
// keypair. If you change the input keypairTag, the resulting public key and
// secret key will be different. The dataKey tag is the salt for the datakey,
// if you provide a different datakey tag, the resulting datakey will be
// different.
//
// Note that changing the keypair tag will also change the resulting datakey.
// The purpose of the keypair tag is to obfuscate the fact that two registry
// entries are owned by the same identity. This obfuscation would break if two
// different public keys were using the same datakey. Changing the datakey does
// not change the public key.
function taggedRegistryEntryKeys(
  seed: Uint8Array,
  keypairTagStr: string,
  datakeyTagStr?: string
): [Ed25519Keypair, Uint8Array, string | null] {
  if (seed.length !== SEED_BYTES) {
    return [{} as Ed25519Keypair, new Uint8Array(0), "seed has the wrong length"];
  }
  if (keypairTagStr.length > 255) {
    return [{} as Ed25519Keypair, new Uint8Array(0), "keypairTag must be less than 256 characters"];
  }
  // If no datakey tag was provided, use the empty string.
  if (datakeyTagStr === undefined) {
    datakeyTagStr = "";
  }

  // Generate a unique set of entropy using the seed and keypairTag.
  const keypairTag = new TextEncoder().encode(keypairTagStr);
  const entropyInput = new Uint8Array(keypairTag.length + seed.length);
  entropyInput.set(seed, 0);
  entropyInput.set(keypairTag, seed.length);
  const keypairEntropy = sha512(entropyInput);

  // Use the seed to dervie the datakey for the registry entry. We use
  // a different tag to ensure that the datakey is independently random, such
  // that the registry entry looks like it could be any other registry entry.
  //
  // We don't want it to be possible for two different combinations of
  // tags to end up with the same datakey. If you don't use a length
  // prefix, for example the tags ["123", "456"] and ["12", "3456"] would
  // have the same datakey. You have to add the length prefix to the
  // first tag otherwise you can get pairs like ["6", "4321"] and ["65",
  // "321"] which could end up with the same datakey.
  const datakeyTag = new TextEncoder().encode(datakeyTagStr);
  const datakeyInput = new Uint8Array(seed.length + 1 + keypairTag.length + datakeyTag.length);
  const keypairLen = new Uint8Array(1);
  keypairLen[0] = keypairTag.length;
  datakeyInput.set(seed);
  datakeyInput.set(keypairLen, seed.length);
  datakeyInput.set(keypairTag, seed.length + 1);
  datakeyInput.set(datakeyTag, seed.length + 1 + keypairTag.length);
  const datakeyEntropy = sha512(datakeyInput);

  // Create the private key for the registry entry.
  const [keypair, errKPFE] = ed25519KeypairFromEntropy(keypairEntropy.slice(0, 32));
  if (errKPFE !== null) {
    return [{} as Ed25519Keypair, new Uint8Array(0), addContextToErr(errKPFE, "unable to derive keypair")];
  }
  const datakey = datakeyEntropy.slice(0, 32);
  return [keypair, datakey, null];
}

// verifyRegistrySignature will verify the signature of a registry entry.
function verifyRegistrySignature(
  pubkey: Uint8Array,
  datakey: Uint8Array,
  data: Uint8Array,
  revision: bigint,
  sig: Uint8Array
): boolean {
  const [encodedData, errEPB] = encodePrefixedBytes(data);
  if (errEPB !== null) {
    return false;
  }
  const [encodedRevision, errU64] = encodeU64(revision);
  if (errU64 !== null) {
    return false;
  }
  const dataToVerify = new Uint8Array(32 + 8 + data.length + 8);
  dataToVerify.set(datakey, 0);
  dataToVerify.set(encodedData, 32);
  dataToVerify.set(encodedRevision, 32 + 8 + data.length);
  const sigHash = blake2b(dataToVerify);
  return ed25519Verify(sigHash, sig, pubkey);
}

export {
  computeRegistrySignature,
  deriveRegistryEntryID,
  entryIDToSkylink,
  skylinkToResolverEntryData,
  taggedRegistryEntryKeys,
  verifyRegistrySignature,
};
