// Import methods from libskynet. They are all namespaced to have a
// 'bootloader' prefix because the full kernel is also likely to use libskynet.
// As the full kernel is imported via 'eval', we need to make sure that methods
// declared inside of the kernel do not conflict with the bootloader. And as
// the bootloader is the one that is the most difficult to change, we go out of
// our way to namespace the bootloader.
//
// This cumbersome namespacing extends to other methods that we define inside
// of the bootloader as well.
import {
	addContextToErr as bootloaderAddContextToErr,
	b64ToBuf as bootloaderB64ToBuf,
	bufToStr as bootloaderBufToStr,
	defaultPortalList as bootloaderDefaultPortalList,
	error as bootloaderError,
	progressiveFetch as bootloaderProgressiveFetch,
	progressiveFetchResult as bootloaderProgressiveFetchResult,
	tryStringify as bootloaderTryStringify,
	validSkylink as bootloaderValidSkylink,
	verifyDownloadResponse as bootloaderVerifyDownloadResponse,
} from "libskynet"

// NOTE: The bootloader is somewhat unique because it contains both the code
// for the browser extension bootloader, and also for the skt.us bootloader.
// The main difference between the two is how localstorage is handled.

// TODO: Need to figure out if the full kernel needs to overwrite the handlers
// or if it can just add its own. And what the performance implications of that
// might be. Well, the kernel probably wants to do things like overwrite the
// localstorage handler behavior anyway.

// TODO: A whole bunch of 'event' objects have been given type 'any' because
// typescript was throwing weird errors like 'Object is possibly null' and
// 'Argument of type 'string' is not assignable to parameter of type
// 'WindowPostMessageOptions | undefined' - both of which I believe are
// incorrect.

// Set a title and a message which indicates that the page should only be
// accessed via an invisible iframe.
document.title = "kernel.skynet"
let header = document.createElement("h1")
header.textContent =
	"Something went wrong! You should not be visiting this page, this page should only be accessed via an invisible iframe."
document.body.appendChild(header)

// TODO: None of these exist, need to either implement or import them.
declare var deriveResolverLink: any
declare var initUserPortalPreferences: any
declare var writeNewOwnRegistryEntry: any

// Establish the skylink of the default kernel.
const bootloaderDefaultKernelResolverLink = "AQBY_5nSN_JhWCNcm7GrjENlNuaT-yUTTknWH4rtCnQO5A"

// bootloaderWLog is a function that gets wrapped by bootloaderLog and
// bootloaderErr.
function bootloaderWLog(isErr: boolean, ...inputs: any) {
	let message = "[bootloader]"
	for (let i = 0; i < inputs.length; i++) {
		message += "\n"
		message += bootloaderTryStringify(inputs[i])
	}
	window.parent.postMessage(
		{
			method: "log",
			data: {
				isErr,
				message,
			},
		},
		"*"
	)
}

// Establish logging functions for the bootloader. The bootloader is in an
// iframe and can't console.log directly, so instead we need to send a message
// to the background and request that the background create the log message.
function bootloaderLog(...inputs: any) {
	bootloaderWLog(false, ...inputs)
}

// bootloaderErr is a mirror of bootloaderLog, except that it reports the log
// as an error.
function bootloaderErr(...inputs: any) {
	bootloaderWLog(true, ...inputs)
}

// bootloaderDownloadSkylink will download the provided skylink.
function bootloaderDownloadSkylink(skylink: string): Promise<[data: Uint8Array, err: bootloaderError]> {
	return new Promise((resolve) => {
		// Get the Uint8Array of the input skylink.
		let [u8Link, errBBTB] = bootloaderB64ToBuf(skylink)
		if (errBBTB !== null) {
			resolve([new Uint8Array(0), bootloaderAddContextToErr(errBBTB, "unable to decode skylink")])
			return
		}
		if (!bootloaderValidSkylink(u8Link)) {
			resolve([new Uint8Array(0), "skylink appears to be invalid"])
			return
		}

		// Prepare the download call.
		let endpoint = "/skynet/trustless/basesector/" + skylink
		let portals = bootloaderDefaultPortalList
		let fileDataPtr = { fileData: new Uint8Array(0), err: null }
		let verifyFunction = function (response: Response): Promise<bootloaderError> {
			return bootloaderVerifyDownloadResponse(response, u8Link, fileDataPtr)
		}

		// Perform the download call.
		bootloaderProgressiveFetch(endpoint, null, portals, verifyFunction).then(
			(result: bootloaderProgressiveFetchResult) => {
				// Return an error if the call failed.
				if (result.success !== true) {
					let err = bootloaderTryStringify(result.messagesFailed)
					resolve([new Uint8Array(0), bootloaderAddContextToErr(err, "unable to complete download")])
					return
				}
				// Check if the portal is honest but the download is corrupt.
				if (fileDataPtr.err !== null) {
					resolve([new Uint8Array(0), bootloaderAddContextToErr(fileDataPtr.err, "download is corrupt")])
					return
				}
				resolve([fileDataPtr.fileData, null])
			}
		)
	})
}

// bootloaderDownloadDefaultKernel will attempt to download the default kernel
// and return the code that can be eval'd.
function bootloaderDownloadDefaultKernel(): Promise<[kernelCode: string, err: bootloaderError]> {
	return new Promise((resolve) => {
		bootloaderDownloadSkylink(bootloaderDefaultKernelResolverLink).then(([fileData, err]) => {
			// Check the error.
			if (err !== null) {
				resolve(["", bootloaderAddContextToErr(err, "unable to download the default kernel")])
				return
			}

			// Decode the fileData to text and return the text.
			let [kernelCode, errBBTS] = bootloaderBufToStr(fileData)
			if (errBBTS !== null) {
				resolve(["", bootloaderAddContextToErr(err, "unable to decode the default kernel")])
				return
			}
			resolve([kernelCode, null])
		})
	})
}

// bootloaderDownloadUserKernel will download the user's kernel and return the
// code that can be eval'd.
function bootloaderDownloadUserKernel(): Promise<[kernelCode: string, err: bootloaderError]> {
}

// downloadUserKernel will download the user's kernel, falling back to the
// default if necessary.
let downloadUserKernel = function (): Promise<string> {
	return new Promise((resolve, reject) => {
		// Get the resolver link for the user's kernel.
		let [skylink, errDRL] = deriveResolverLink("v1-skynet-kernel", "v1-skynet-kernel-datakey")
		if (errDRL !== null) {
			reject(bootloaderAddContextToErr(errDRL, "unable to get resovler link for user's portal prefs"))
			return
		}

		// Attempt the download.
		downloadSkylink(skylink)
			.then((output: any) => {
				processUserKernelDownload(output)
					.then((kernel) => resolve(kernel))
					.catch((err) => {
						reject(bootloaderAddContextToErr(err, "unable to download kernel for the user"))
					})
			})
			.catch((err: any) => {
				reject(bootloaderAddContextToErr(err, "unable to download user's kernel"))
			})
	})
}

// Establish a singleton which tracks whether the kernel has loaded.
//
// TODO: Need to rename this to namespace it better.
let kernelHasLoaded = false

// processUserKernelDownload handles the result of attempting to download the
// kernel stored at the user's seed. This is a 'success' response, meaning that
// the network query succeeded without any malice from the portals. That is
// still not the same as the download completing, the result of the query may
// have been a 404, for example.
let processUserKernelDownload = function (output: any): Promise<string> {
	return new Promise((resolve, reject) => {
		// Handle the success case.
		let response = output.response
		if (response.status === 200) {
			let [text, errBTS] = bootloaderBufToStr(output.fileData)
			if (errBTS !== null) {
				reject(bootloaderAddContextToErr(errBTS, "kernel data is invalid"))
				return
			}
			resolve(text)
			return
		}

		// Handle the 404 case, which invovles writing the default
		// kernel to the user's kernel registry entry and then
		// downloading the default kernel and returning it. We write
		// the default kernel as the user's kernel because we want the
		// user to have a consistent experience between browsers. If
		// the first kernel they ever used was of a particular
		// distribution, we want the next time they log in (even if on
		// a different device with a different extension) to use the
		// same kernel.
		if (response.status === 404) {
			bootloaderLog("lifecycle", "user has no established kernel, trying to set the default")

			// Perform the registry write.
			let [defaultKernelSkylink, err64] = bootloaderB64ToBuf(bootloaderDefaultKernelResolverLink)
			if (err64 !== null) {
				bootloaderLog("lifecycle", "could not convert defaultKernelSkylink to a uin8array")
				reject(bootloaderAddContextToErr(err64, "could not convert defaultKernelSkylink"))
				return
			}
			writeNewOwnRegistryEntry("v1-skynet-kernel", "v1-skynet-kernel-datakey", defaultKernelSkylink)
				.then(() => {
					bootloaderLog("lifecycle", "succesfully set the user's kernel to the default kernel")
				})
				.catch((err: any) => {
					bootloaderLog("lifecycle", "unable to set the user's kernel\n", err)
				})

			// Need to download and eval the default kernel.
			downloadDefaultKernel()
				.then((text) => {
					resolve(text)
				})
				.catch((err) => {
					reject(bootloaderAddContextToErr(err, "unable to download default kernel"))
				})
			return
		}

		// Handle every other response status.
		bootloaderLog("lifecycle", "response not recognized when reading user kernel\n", response)
		reject("response not recognized when reading user's kernel")
		return
	})
}

// kernelDiscoveryFailed defines the callback that is called in
// readRegistryAndLoadKernel after we were unable to read the user's registry
// entry from Skynet. Note that this is different from a 404, it means that we
// could not get a reliable read at all.
//
// If we can't figure out what kernel the user wants to load, we are going to
// abort and send an error message to the parent, because we don't want the UX
// of loading the default kernel for the user if there's a different kernel
// that they are already used to.
let kernelDiscoveryFailed = function (err: any) {
	// Set kernelLoading to false. This needs to happen before the call to
	// postMessage so that when the parent initiates a new kernel load, the
	// attempt will not be blocked.
	kernelLoading = false

	// Log the error and send a failure notification to the parent.
	bootloaderLog("auth", "unable to load user's kernel", err)
	window.parent.postMessage(
		{
			method: "kernelAuthStatus",
			data: {
				userAuthorized: true,
				err: err.message,
			},
		},
		"*"
	)
	kernelHasLoaded = true
}

// evalKernel will call 'eval' on the provided kernel code.
let evalKernel = function (kernel: string) {
	// The eval will throw if the userSeed is not available. This shouldn't
	// happen, but we catch the throw here anyway.
	try {
		eval(kernel)
	} catch (err) {
		bootloaderErr("kernel could not be loaded", err)
		return
	}

	// Only send a message indicating that the kernel was successfully
	// loaded if the auth status hasn't changed in the meantime.
	if (authChangeMessageSent === false) {
		window.parent.postMessage(
			{
				method: "kernelAuthStatus",
				data: {
					userAuthorized: true,
					err: null,
				},
			},
			"*"
		)
		kernelHasLoaded = true
	}
}

// loadSkynetKernel handles loading the the skynet-kernel from the user's
// skynet storage. We use 'kernelLoading' to ensure this only happens once. If
// loading fails, 'kernelLoading' will be set to false, and an error will be
// sent to the parent, allowing the parent a chance to fix whatever is wrong
// and try again. Usually a failure means the user is not logged in.
var kernelLoading = false
let loadSkynetKernel = function () {
	// Check the loading status of the kernel. If the kernel is loading,
	// block until the loading is complete and then send a message to the
	// caller indicating a successful load.
	if (kernelLoading) {
		return
	}
	kernelLoading = true

	// Load the user's preferred portals from their skynet data. Add a
	// callback which will load the user's preferred kernel from Skynet
	// once the preferred portal has been established.
	initUserPortalPreferences()
		.then(() => {
			return downloadUserKernel()
		})
		.then((kernel: any) => {
			evalKernel(kernel)
			bootloaderLog("auth", "kernel is loaded")
		})
		.catch((err: any) => {
			bootloaderLog("auth", "unable to load kernel", err)
			kernelDiscoveryFailed(err)
		})
}

// handleSkynetKernelRequestOverride is defined for two pages when the user
// hasn't logged in: the home page, and the authentication page.
let handleSkynetKernelRequestOverride = function (event: any) {
	// Define the headers that need to be injected when responding to the
	// GET request. In this case (pre-auth), the headers will be the same
	// for all pages that we inject.
	let headers = [
		{
			name: "content-type",
			value: "text/html; charset=utf8",
		},
	]

	// Define a helper function for returning an error.
	let data = event.data
	let respondErr = function (err: string) {
		event.source.postMessage(
			{
				nonce: data.nonce,
				method: "response",
				err,
			},
			event.origin
		)
	}
	let respondBody = function (body: any) {
		let msg: any = {
			nonce: data.nonce,
			method: "response",
			err: null,
		}
		if (body === null) {
			msg["data"] = {
				override: false,
			}
		} else {
			msg["data"] = {
				override: true,
				headers,
				body,
			}
		}
		event.source.postMessage(msg, event.origin)
	}

	// Input checking.
	if (!("data" in data) || !("url" in data.data) || typeof data.data.url !== "string") {
		respondErr("no url provided: " + JSON.stringify(data))
		return
	}
	if (!("method" in data.data) || typeof data.data.method !== "string") {
		respondErr("no data.method provided: " + JSON.stringify(data))
		return
	}

	// Handle the auth page.
	//
	// TODO: Change the authpage to a v2link so that we can update the
	// without having to modify the file.
	let url = data.data.url
	if (url === "http://kernel.skynet/auth.html") {
		downloadSkylink("OAC7797uTAoG25e9psL6ejA71VLKinUdF4t76sMkYTj8IA")
			.then((result: any) => {
				respondBody(result.fileData)
			})
			.catch((err: any) => {
				let errStr = bootloaderTryStringify(err)
				respondErr("unable to fetch skylink for kernel page: " + errStr)
			})
		return
	}
	respondBody(null)
}

// handleSkynetKernelProxyInfo responds to a DNS query. The default kernel
// always responds that there should be no proxy for the given domain - the
// background script already has special carveouts for all required domains.
let handleSkynetKernelProxyInfo = function (event: any) {
	event.source.postMessage(
		{
			nonce: event.data.nonce,
			method: "response",
			err: null,
			data: {
				proxy: false,
			},
		},
		event.origin
	)
}

// Establish the event listener for the kernel. There are several default
// requests that are supported, namely everything that the user needs to create
// a seed and log in with an existing seed, because before we have the user
// seed we cannot load the rest of the skynet kernel.
var handleMessage = function (event: any) {
	// Establish some error handling helpers.
	let respondUnknownMethod = function (method: string) {
		event.source.postMessage(
			{
				nonce: event.data.nonce,
				method: "response",
				err: "unrecognized method (user may need to log in): " + method,
			},
			event.origin as any
		)
	}
	// Check that there's a nonce.
	if (!("nonce" in event.data)) {
		return
	}
	if (!("method" in event.data)) {
		respondUnknownMethod("[no method provided]")
		return
	}

	// Create default handlers for the requestOverride and proxyInfo
	// methods.  These methods are important during bootloading to ensure
	// that the default login page can be loaded for the user.
	//
	// TODO: Only select versions of these methods should actually run, we
	// don't want to do everything prior to boostrap just the requests that
	// directly pertain to the bootstrapping process.
	if (event.data.method === "requestOverride") {
		handleSkynetKernelRequestOverride(event)
		return
	}
	if (event.data.method === "proxyInfo") {
		handleSkynetKernelProxyInfo(event)
		return
	}

	// This message is not supposed to be handled until the kernel has
	// loaded. If the kernel is already loaded, then we respond with an
	// error. If the kernel has not yet loaded, we wait until the kernel is
	// loaded. Then we call 'handleMessage' again because the full kernel
	// will overwrite the function, and we want to use the new rules.
	if (kernelHasLoaded === true) {
		respondUnknownMethod(event.data.method)
	} else {
		bootloaderLog("received a message before the kernel was ready", event.data)
	}
}
window.addEventListener("message", (event) => {
	handleMessage(event)
})

// Establish a storage listener for the kernel that listens for any changes to
// the userSeed storage key. In the event of a change, we want to emit an
// 'kernelAuthStatusChanged' method to the parent so that the kernel can be
// refreshed.
var authChangeMessageSent = false
var handleStorage = function (event: StorageEvent) {
	// If the event is that the v1-seed has changed, then this is a login
	// event. If the user was already logged in, it may mean they switched
	// accounts.
	if (event.key === "v1-seed") {
		authChangeMessageSent = true
		window.parent.postMessage(
			{
				method: "kernelAuthStatusChanged",
				data: {
					userAuthorized: true,
				},
			},
			"*"
		)

		// Attempt to load the kernel again.
		if (kernelHasLoaded === false) {
			loadSkynetKernel()
			kernelHasLoaded = true
		}
	}

	// If the event is null, it means the localStorage was cleared, which means
	// the user has logged out.
	if (event.key === null) {
		authChangeMessageSent = true
		window.parent.postMessage(
			{
				method: "kernelAuthStatusChanged",
				data: {
					userAuthorized: false,
				},
			},
			"*"
		)
		window.location.reload()
	}
}
window.addEventListener("storage", (event) => handleStorage(event))

// If the user seed is in local storage, we'll load the kernel. If the user
// seed is not in local storage, we'll report that the user needs to perform
// authentication. Kernel loading will resume once the user has authenticated.
//
// NOTE: Depending on which browser is being used we need to call
// requestStorageAccess.
function bootloaderAuthFailed() {
	window.parent.postMessage(
		{
			method: "kernelAuthStatus",
			data: {
				userAuthorized: false,
				err: null,
			},
		},
		"*"
	)
}

// bootloaderGetSeed will return the seed that is stored in localStorage. If
// there is no seed, it means the user is not logged in.
function bootloaderGetSeed(): [Uint8Array, bootloaderError] {
	// Pull the string version of the seed from localstorage.
	let userSeedString = window.localStorage.getItem("v1-seed")
	if (userSeedString === null) {
		return [new Uint8Array(0), "no user seed in local storage"]
	}

	// Parse the string into a Uint8Array and return the result.
	let userSeed = Uint8Array.from([...userSeedString].map((ch) => ch.charCodeAt(0)))
	return [userSeed, null]
}

// bootloaderLoadKernel will attempt to load the kernel from the user's seed.
// If the seed isn't available, it will declare that auth failed.
function bootloaderLoadKernel() {
	// Try to load the user's seed.
	let [, errGSU] = bootloaderGetSeed()
	if (errGSU !== null) {
		bootloaderLog("auth", "user is not logged in", errGSU)
		bootloaderAuthFailed()
		return
	}

	// Attempt to load the skynet kernel.
	bootloaderLog("auth", "user is logged in, attempting to load kernel")
	loadSkynetKernel()
}

// If the browser supports requesting storage access, try to get storage
// access. Otherwise, the user will need to disable strict privacy in their
// browser for skt.us to work. If the user has the extension, disabling strict
// privacy is not needed.
if (Object.prototype.hasOwnProperty.call(document, "requestStorageAccess") && window.origin === "https://skt.us") {
	document
		.requestStorageAccess()
		.then(() => {
			bootloaderLoadKernel()
		})
		.catch((err) => {
			bootloaderLog("auth", "could not get access to localStorage", err)
			bootloaderAuthFailed()
		})
} else {
	bootloaderLoadKernel()
}
