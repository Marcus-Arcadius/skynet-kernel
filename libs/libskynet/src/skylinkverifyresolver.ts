import { b64ToBuf, hexToBuf } from "./encoding.js"
import { addContextToErr } from "./err.js"
import { objAsString } from "./objAsString.js"
import { deriveRegistryEntryID, verifyRegistrySignature } from "./registry.js"
import { parseSkylinkBitfield } from "./skylinkbitfield.js"
import { validSkylink } from "./skylinkvalidate.js"

// verifyResolverLinkProof will check that the given resolver proof matches the
// provided skylink. If the proof is correct and the signature matches, the
// data will be returned. The returned link will be a verified skylink.
function verifyResolverLinkProof(skylink: Uint8Array, proof: any): [Uint8Array, string | null] {
	// Verify the presented skylink is formatted correctly.
	if (skylink.length !== 34) {
		return [new Uint8Array(0), "skylink is malformed, expecting 34 bytes"]
	}

	// Verify that all of the required fields are present in the proof.
	if (
		!("data" in proof) ||
		!("datakey" in proof) ||
		!("publickey" in proof) ||
		!("signature" in proof) ||
		!("type" in proof) ||
		!("revision" in proof)
	) {
		return [new Uint8Array(0), "proof is malformed, fields are missing"]
	}
	if (!("algorithm" in proof.publickey) || !("key" in proof.publickey)) {
		return [new Uint8Array(0), "pubkey is malformed"]
	}

	// Verify the typing of the fields.
	if (typeof proof.data !== "string") {
		return [new Uint8Array(0), "data is malformed"]
	}
	let dataStr = <string>proof.data
	if (typeof proof.datakey !== "string") {
		return [new Uint8Array(0), "datakey is malformed"]
	}
	let datakeyStr = <string>proof.datakey
	if (proof.publickey.algorithm !== "ed25519") {
		return [new Uint8Array(0), "pubkey has unrecognized algorithm"]
	}
	if (typeof proof.publickey.key !== "string") {
		return [new Uint8Array(0), "pubkey key is malformed"]
	}
	let pubkeyStr = <string>proof.publickey.key
	if (typeof proof.signature !== "string") {
		return [new Uint8Array(0), "signature is malformed"]
	}
	if (proof.type !== 1n) {
		return [new Uint8Array(0), "registry entry has unrecognized type: " + objAsString(proof.type)]
	}
	let sigStr = <string>proof.signature
	if (typeof proof.revision !== "bigint") {
		return [new Uint8Array(0), "revision is malformed"]
	}
	let revision = <bigint>proof.revision

	// Decode all of the fields. They are presented in varied types and
	// encodings.
	let [data, errD] = hexToBuf(dataStr)
	if (errD !== null) {
		return [new Uint8Array(0), addContextToErr(errD, "data is invalid hex")]
	}
	let [datakey, errDK] = hexToBuf(datakeyStr)
	if (errDK !== null) {
		return [new Uint8Array(0), addContextToErr(errDK, "datakey is invalid hex")]
	}
	let [pubkey, errPK] = b64ToBuf(pubkeyStr)
	if (errPK !== null) {
		return [new Uint8Array(0), addContextToErr(errPK, "pubkey key is invalid base64")]
	}
	let [sig, errS] = hexToBuf(sigStr)
	if (errS !== null) {
		return [new Uint8Array(0), addContextToErr(errS, "signature is invalid hex")]
	}

	// Verify that the data is a skylink - this is a proof for a resolver,
	// which means the proof is pointing to a specific skylink.
	if (!validSkylink(data)) {
		return [new Uint8Array(0), "this skylink does not resolve to another skylink"]
	}

	// Verify that the combination of the datakey and the public key match
	// the skylink.
	let [entryID, errREID] = deriveRegistryEntryID(pubkey, datakey)
	if (errREID !== null) {
		return [new Uint8Array(0), addContextToErr(errREID, "proof pubkey is malformed")]
	}
	let linkID = skylink.slice(2, 34)
	for (let i = 0; i < entryID.length; i++) {
		if (entryID[i] !== linkID[i]) {
			return [new Uint8Array(0), "proof pubkey and datakey do not match the skylink root"]
		}
	}

	// Verify the signature.
	if (!verifyRegistrySignature(pubkey, datakey, data, revision, sig)) {
		return [new Uint8Array(0), "signature does not match"]
	}
	return [data, null]
}

// verifyResolverLinkProofs will verify a set of resolver link proofs provided
// by a portal after performing a resolver link lookup. Each proof corresponds
// to one level of resolution. The final value returned will be the V1 skylink
// at the end of the chain.
//
// This function treats the proof as untrusted data and will verify all of the
// fields that are provided.
function verifyResolverLinkProofs(skylink: Uint8Array, proof: any): [Uint8Array, string | null] {
	// Check that the proof is an array.
	if (!Array.isArray(proof)) {
		return [new Uint8Array(0), "provided proof is not an array: " + objAsString(proof)]
	}
	if (proof.length === 0) {
		return [new Uint8Array(0), "proof array is empty"]
	}

	// Check each proof in the chain, returning the final skylink.
	for (let i = 0; i < proof.length; i++) {
		let errVRLP
		;[skylink, errVRLP] = verifyResolverLinkProof(skylink, proof[i])
		if (errVRLP !== null) {
			return [new Uint8Array(0), addContextToErr(errVRLP, "one of the resolution proofs is invalid")]
		}
	}

	// Though it says 'skylink', the verifier is actually just returning
	// whatever the registry data is. We need to check that the final value
	// is a V1 skylink.
	if (skylink.length !== 34) {
		return [new Uint8Array(0), "final value returned by the resolver link is not a skylink"]
	}
	let [version, , , errPSB] = parseSkylinkBitfield(skylink)
	if (errPSB !== null) {
		return [new Uint8Array(0), addContextToErr(errPSB, "final value returned by resolver link is not a valid skylink")]
	}
	if (version !== 1n) {
		return [new Uint8Array(0), "final value returned by resolver link is not a v1 skylink"]
	}

	return [skylink, null]
}

export { verifyResolverLinkProofs }
