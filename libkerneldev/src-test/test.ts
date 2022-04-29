import { generateSeedPhrase, validSeedPhrase } from "../src/seed.js"
import { ed25519Keypair, ed25519KeypairFromEntropy, ed25519Sign, ed25519Verify } from "../src/ed25519.js"
import { taggedRegistryEntryKeys, deriveRegistryEntryID, resolverLink } from "../src/registry.js"
import { sha512 } from "../src/sha512.js"
import { bufToHex, bufToB64 } from "../src/encoding.js"
import { validateSkyfilePath } from "../src/upload.js"
import { parseSkylinkBitfield, skylinkV1Bitfield } from "../src/skylinkbitfield.js"

// Establish a global set of functions and objects for testing flow control.
let failed = false
function fail(errStr: string, ...inputs: any) {
	if (!t.failed) {
		console.error(t.testName, "has failed")
	}
	failed = true
	t.failed = true
	console.log("\t", errStr, ...inputs)
}
function log(...inputs: any) {
	console.log("\t", ...inputs)
}
let t = {
	failed: false,
	testName: "",
	fail,
	log,
}
function runTest(test: any) {
	t.failed = false
	t.testName = test.name
	console.log(t.testName, "is running")
	test(t)
	if (!t.failed) {
		console.log(t.testName, "has passed")
	}
}

// Helper functions.
function u8sEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false
		}
	}
	return true
}
function keypairsEqual(a: ed25519Keypair, b: ed25519Keypair): boolean {
	if (!u8sEqual(a.publicKey, b.publicKey)) {
		return false
	}
	if (!u8sEqual(a.secretKey, b.secretKey)) {
		return false
	}
	return true
}

// Smoke testing for generating a seed phrase.
function TestGenerateSeedPhrase(t: any) {
	// Generate two random seed phrases and check they are different.
	let [phraseNullInput, err1] = generateSeedPhrase(null)
	let [phraseNullInput2, err2] = generateSeedPhrase(null)
	if (err1 !== null) {
		t.fail(err1, "bad seed phase 1")
		return
	}
	if (err2 !== null) {
		t.fail(err2, "bad seed phrase 2")
		return
	}
	if (phraseNullInput === phraseNullInput2) {
		fail("null seed phrases match", phraseNullInput, "\n", phraseNullInput2)
	}

	let [phraseTestInput, err3] = generateSeedPhrase("Test")
	let [phraseTestInput2, err4] = generateSeedPhrase("Test")
	if (err3 !== null) {
		t.fail(err3, "bad seed phrase 3")
		return
	}
	if (err4 !== null) {
		t.fail(err4, "bad seed phrase 4")
		return
	}
	if (phraseTestInput !== phraseTestInput2) {
		t.fail("test seed phrases don't match", phraseTestInput, "\n", phraseTestInput2)
	}

	// Check that all of the seed phrases are valid.
	let [x1, errVSP1] = validSeedPhrase(phraseNullInput)
	let [x2, errVSP2] = validSeedPhrase(phraseNullInput2)
	let [x3, errVSP3] = validSeedPhrase(phraseTestInput)
	if (errVSP1 !== null) {
		t.fail("vsp1 is not a valid seed phrase")
	}
	if (errVSP2 !== null) {
		t.fail("vsp2 is not a valid seed phrase")
	}
	if (errVSP3 !== null) {
		t.fail("vsp3 is not a valid seed phrase")
	}
}

// Smoke testing for ed25519
function TestEd25519(t: any) {
	// Test some of the ed25519 functions by making some entropy, then making a
	// keypair, then signing some data and verifying the signature.
	let entropy = sha512(new TextEncoder().encode("fake entropy"))
	let [keypair, errKPFE] = ed25519KeypairFromEntropy(entropy.slice(0, 32))
	if (errKPFE !== null) {
		t.fail(errKPFE, "kpfe failed")
		return
	}
	let message = new TextEncoder().encode("fake message")
	let [signature, errS] = ed25519Sign(message, keypair.secretKey)
	if (errS !== null) {
		t.fail(errS, "sign failed")
		return
	}
	let validSig = ed25519Verify(message, signature, keypair.publicKey)
	if (!validSig) {
		t.fail("ed25519 sig not valid")
	}
}

// Smoke testing for the basic registry functions.
function TestRegistry(t: any) {
	let [x1, x2, errREK1] = taggedRegistryEntryKeys(new TextEncoder().encode("not a seed"), "", "")
	if (errREK1 === null) {
		t.fail("expected error when using bad seed")
	}

	let [seedPhrase, errGSP] = generateSeedPhrase(null)
	if (errGSP !== null) {
		t.fail("could not get seed phrase")
		return
	}
	let [seed, errVSP] = validSeedPhrase(seedPhrase)
	if (errVSP !== null) {
		t.fail("seed phrase is not valid")
		return
	}

	// Check that keypairs are deterministic.
	let [keypair2, datakey2, errREK2] = taggedRegistryEntryKeys(seed, "test-keypair", "test-datakey")
	let [keypair3, datakey3, errREK3] = taggedRegistryEntryKeys(seed, "test-keypair", "test-datakey")
	if (errREK2 !== null) {
		t.fail(errREK2, "could not get tagged keys")
		return
	}
	if (errREK3 !== null) {
		t.fail(errREK3, "could not get tagged keys")
		return
	}
	if (!u8sEqual(datakey2, datakey3)) {
		t.fail("datakeys don't match for deterministic derivation")
		t.fail(datakey2)
		t.fail(datakey3)
	}
	if (!keypairsEqual(keypair2, keypair3)) {
		t.fail("keypairs don't match for deterministic derivation")
	}

	// Check that changing the keypair also changes the datakey even if the
	// datakeyTag is unchanged.
	let [keypair4, datakey4, errREK4] = taggedRegistryEntryKeys(seed, "test-keypair2", "test-datakey")
	if (errREK4 !== null) {
		t.fail(errREK4, "could not get tagged keys")
		return
	}
	if (keypairsEqual(keypair3, keypair4)) {
		t.fail("keypairs should be different")
	}
	if (u8sEqual(datakey3, datakey4)) {
		t.fail("datakeys should be different")
	}
	// Check that changing the datakey doesn't change the keypair.
	let [keypair5, datakey5, errREK5] = taggedRegistryEntryKeys(seed, "test-keypair2", "test-datakey2")
	if (errREK5 !== null) {
		t.fail(errREK5, "could not get tagged keys")
		return
	}
	if (!keypairsEqual(keypair4, keypair5)) {
		t.fail("keypairs should be equal")
	}
	if (u8sEqual(datakey4, datakey5)) {
		t.fail("datakeys should be different")
	}

	// Check that we can derive a registry entry id.
	let [entryID, errDREID] = deriveRegistryEntryID(keypair5.publicKey, datakey5)
	if (errDREID !== null) {
		t.fail(errDREID, "could not derive entry id")
		return
	}
	t.log("example entry id:     ", bufToHex(entryID))
	// Convert to resolver link.
	let [rl, errRL] = resolverLink(entryID)
	if (errRL !== null) {
		t.fail(errRL, "could not get resolver link")
		return
	}
	t.log("example resolver link:", rl)
}

// TestValidateSkyfilePath runs basic testing for the skyfile path validator.
function TestValidateSkyfilePath(t: any) {
	let tests = [
		{ trial: "test", expect: true },
		{ trial: "test/subtrial", expect: true },
		{ trial: "test/subtrial.ext", expect: true },
		{ trial: "test/trial.ext/subtrial.ext", expect: true },
		{ trial: "", expect: false },
		{ trial: ".", expect: false },
		{ trial: "./", expect: false },
		{ trial: "a//b", expect: false },
		{ trial: "a/./b", expect: false },
		{ trial: "a/../b", expect: false },
		{ trial: "../a/b", expect: false },
		{ trial: "/sometrial", expect: false },
		{ trial: "sometrial/", expect: false },
	]
	for (let i = 0; i < tests.length; i++) {
		let err = validateSkyfilePath(tests[i].trial)
		if (err !== null && tests[i].expect === true) {
			t.fail("expected trial to succeed validation: ", tests[i].trial)
		}
		if (err === null && tests[i].expect === false) {
			t.fail("expected trial to fail validation: ", tests[i].trial)
		}
	}
}

// TestSkylinkV1Bitfield checks that skylinkV1Bitfield is working correctly. It
// uses parseSkylinkBitfield as a helper function to verify things.
function TestSkylinkV1Bitfield(t: any) {
	let skylink = new Uint8Array(34)

	let tests = [
		{ trial: 0, expect: 4096 },
		{ trial: 1, expect: 4096 },
		{ trial: 100, expect: 4096 },
		{ trial: 200, expect: 4096 },
		{ trial: 4095, expect: 4096 },
		{ trial: 4096, expect: 4096 },
		{ trial: 4097, expect: 8192 },
		{ trial: 8191, expect: 8192 },
		{ trial: 8192, expect: 8192 },
		{ trial: 8193, expect: 12288 },
		{ trial: 12287, expect: 12288 },
		{ trial: 12288, expect: 12288 },
		{ trial: 12289, expect: 16384 },
		{ trial: 16384, expect: 16384 },
		{ trial: 32767, expect: 32768 },
		{ trial: 32768, expect: 32768 },
		{ trial: 32769, expect: 36864 },
		{ trial: 36863, expect: 36864 },
		{ trial: 36864, expect: 36864 },
		{ trial: 36865, expect: 40960 },
		{ trial: 45056, expect: 45056 },
		{ trial: 45057, expect: 49152 },
		{ trial: 65536, expect: 65536 },
		{ trial: 65537, expect: 73728 },
		{ trial: 106496, expect: 106496 },
		{ trial: 106497, expect: 114688 },
		{ trial: 163840, expect: 163840 },
		{ trial: 163841, expect: 180224 },
		{ trial: 491520, expect: 491520 },
		{ trial: 491521, expect: 524288 },
		{ trial: 720896, expect: 720896 },
		{ trial: 720897, expect: 786432 },
		{ trial: 1572864, expect: 1572864 },
		{ trial: 1572865, expect: 1703936 },
		{ trial: 3407872, expect: 3407872 },
		{ trial: 3407873, expect: 3670016 },
	]

	for (let i = 0; i < tests.length; i++) {
		let [bitfield, errSVB] = skylinkV1Bitfield(tests[i].trial)
		if (errSVB !== null) {
			t.fail("unable to create bitfield")
			return
		}
		skylink.set(bitfield, 0)
		let [version, offset, fetchSize, errPSB] = parseSkylinkBitfield(skylink)
		if (errPSB !== null) {
			t.fail("parseSkylinkBitfield has failed on generated skylink", tests[i])
			return
		}
		if (version !== 1) {
			t.fail("skylinkV1Bitfield is setting the wrong version", version, tests[i])
		}
		if (offset !== 0) {
			t.fail("skylinkV1Bitfield is setting the wrong offset", offset, tests[i])
		}
		if (fetchSize !== tests[i].expect) {
			t.fail("the wrong fetchSize has been set", fetchSize, tests[i])
		}
	}
}

runTest(TestGenerateSeedPhrase)
runTest(TestEd25519)
runTest(TestRegistry)
runTest(TestValidateSkyfilePath)
runTest(TestSkylinkV1Bitfield)

console.log()
if (failed) {
	console.log("tests had errors")
	process.exit(1)
}
console.log("tests have passed")

export {}
