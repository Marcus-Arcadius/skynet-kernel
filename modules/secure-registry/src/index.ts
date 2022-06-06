import { activeQuery, addContextToErr, addHandler, handleMessage } from "libkmodule"
import {
	bufToHex,
	defaultPortalList,
	error,
	hexToBuf,
	progressiveFetch,
	progressiveFetchResult,
	tryStringify,
	verifyRegistrySignature,
} from "libskynet"

// Let libkmodule handle the message processing.
onmessage = handleMessage

// Establish the handlers for the methods.
addHandler("readEntry", handleReadEntry)
// addHandler("writeEntry", handleWriteEntry)

// verifyDecodedResp will verify the decoded response from a portal for a
// regRead call.
function verifyDecodedResp(resp: Response, data: any, pubkey: Uint8Array, datakey: Uint8Array): error {
	// Status is expected to be 200.
	if (resp.status !== 200) {
		return "expected 200 response status, got: " + tryStringify(resp.status)
	}

	// Verify that all required fields were provided.
	if (!("data" in data)) {
		return "expected data field in response"
	}
	if (typeof data.data !== "string") {
		return "expected data field to be a string"
	}
	if (!("revision" in data)) {
		return "expected revision in response"
	}
	// TODO: Actually we want this to be a bigint, need to change the json
	// decoder though.
	if (typeof data.revision !== "number") {
		return "expected revision to be a number"
	}
	if (!("signature" in data)) {
		return "expected signature in response"
	}
	if (typeof data.signature !== "string") {
		return "expected signature to be a string"
	}

	// Parse out the fields we need.
	let revision = BigInt(data.revision)
	let [entryData, errHTB] = hexToBuf(data.data)
	if (errHTB !== null) {
		return "could not decode registry data from response"
	}
	let [sig, errHTB2] = hexToBuf(data.signature)
	if (errHTB2 !== null) {
		return "could not decode signature from response"
	}

	// Verify the signature.
	if (!verifyRegistrySignature(pubkey, datakey, entryData, revision, sig)) {
		return "signature mismatch"
	}

	// TODO: Need to be handling type 2 registry entries here otherwise we will
	// be flagging non malicious portals as malicious.

	return null
}

// verifyRegReadResp will verify that the registry read response from the
// portal was correct.
function verifyRegReadResp(resp: Response, pubkey: Uint8Array, datakey: Uint8Array): Promise<error> {
	return new Promise((resolve) => {
		resp
			.json()
			.then((j: any) => {
				let errVDR = verifyDecodedResp(resp, j, pubkey, datakey)
				if (errVDR !== null) {
					resolve(addContextToErr(errVDR, "response failed verification"))
					return
				}
				resolve(null)
			})
			.catch((err: any) => {
				resolve(addContextToErr(err, "unable to decode response"))
			})
	})
}

// handleReadEntry will process a call to 'readEntry'.
//
// TODO: Need to support reading registry entries by their entryID. I'm not
// sure if the API supports this.
function handleReadEntry(aq: activeQuery) {
	// Perform the input validation.
	let data = aq.callerInput
	if (!("publicKey" in data)) {
		aq.reject("input should contain a publicKey field")
		return
	}
	if (!(data.publicKey instanceof Uint8Array)) {
		aq.reject("publicKey input should be a Uint8Array")
		return
	}
	if (!("dataKey" in data)) {
		aq.reject("input should contain a dataKey field")
		return
	}
	if (!(data.dataKey instanceof Uint8Array)) {
		aq.reject("datakKey input should be a Uint8Array")
		return
	}

	// Compose the endpoint.
	let pubkeyHex = bufToHex(data.publicKey)
	let datakeyHex = bufToHex(data.dataKey)
	let endpoint = "/skynet/registry?publickey=ed25519%3A" + pubkeyHex + "&datakey=" + datakeyHex

	// Establish the verification function.
	let verifyFunc = function (response: Response): Promise<error> {
		return verifyRegReadResp(response, data.publicKey, data.dataKey)
	}

	// Perform the fetch.
	progressiveFetch(endpoint, {}, defaultPortalList, verifyFunc).then((result: progressiveFetchResult) => {
		if (result.success === true) {
			// TODO: response.json() is not fully correct because it doesn't
			// properly parse  large revision numbers. We need to use a custom
			// json library here that will pull the numbers in to bigints.
			result.response
				.json()
				.then((j: any) => {
					aq.accept({
						exists: true,
						data: j.data,
						revision: BigInt(j.revision),
					})
				})
				.catch((err: any) => {
					let errStr = tryStringify(err)
					aq.reject(<string>addContextToErr(errStr, "unable to parse final response despite passing verification"))
				})
			return
		}

		// Check for a 404.
		for (let i = 0; i < result.responsesFailed.length; i++) {
			if (result.responsesFailed[i].status === 404) {
				aq.accept({
					exists: false,
					data: new Uint8Array(0),
					revision: 0n,
				})
				return
			}
		}

		aq.reject("unable to read registry entry\n" + tryStringify(result))
	})
}