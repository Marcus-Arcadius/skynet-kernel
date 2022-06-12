import { randomBytes } from "crypto"
import { addContextToErr, bufToB64, error, generateSeedPhraseDeterministic } from "libskynet"

// generateSeedPhraseRandom will randomly generate and verify a seed phrase for the user.
function generateSeedPhraseRandom(): [string, error] {
	let buf = Uint8Array.from(randomBytes(32))
	let str = bufToB64(buf)
	let [sp, errGSPD] = generateSeedPhraseDeterministic(str)
	if (errGSPD !== null) {
		return ["", addContextToErr(errGSPD, "unable to generate seed from string")]
	}
	return [sp, null]
}

export { generateSeedPhraseRandom }
