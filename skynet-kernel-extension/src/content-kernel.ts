export {};

// TODO: Right now every application that opens an iframe to the kernel is
// going to load a separate instance of the kernel, it may make more sense to
// have the kernel operate entirely from shared workers. Still need to explore
// that.

// Set a title and a message which indicates that the page should only be
// accessed via an invisible iframe.
console.log("progress", "kernel has been opened");
document.title = "kernel.siasky.net"
var header = document.createElement('h1');
header.textContent = "Something went wrong! You should not be visiting this page, this page should only be accessed via an invisible iframe.";
document.body.appendChild(header);

// import:::skynet-kernel-extension/lib/sha512.ts

// import:::skynet-kernel-extension/lib/ed25519.ts

// getUserSeed will return the seed that is stored in localStorage. This is the
// first function that gets called when the kernel iframe is openend. The
// kernel will not be loaded if no seed is present, as it means that the user
// is not logged in.
var getUserSeed = function(): [Uint8Array, string] {
	let userSeedString = window.localStorage.getItem("v1-seed");
	if (userSeedString === null) {
		return [null, "no user seed in local storage"];
	}
	let userSeed: Uint8Array;
	try {
		userSeed = new TextEncoder().encode(userSeedString);
	} catch(err) {
		return [null, "user seed is not valid"];
	}
	return [userSeed, ""];
}

// logOut will erase the localStorage, which means the seed will no longer be
// available, and any sensistive data that the kernel placed in localStorage
// will also be cleared.
var logOut = function() {
	console.log("progress", "clearing local storage after logging out");
	localStorage.clear();
}

// downloadV1Skylink will download the raw data for a skylink and then verify
// that the downloaded content matches the hash of the skylink.
// 
// TODO: Figure out how to use the user's preferred portal at this point
// instead of using siasky. We probably do that by checking localstorage. If
// there is no list of portals specified, default to siasky.
//
// TODO: I have no idea how to get this to return an error, but it needs to
// return an error if validation fails.
var downloadV1Skylink = function(skylink: string) {
	// TODO: Verify that the input is a valid V1 skylink.

	// TODO: Actually verify the download.

	return fetch(skylink).then(response => response.text())
}

// deriveKernelEntry will derive the keypair and tweak for the registry entry
// that holds the kernel.
var deriveKernelEntry = function(): [Uint8Array, Uint8Array] {
	// TODO:
	//
	// We can use the sha512 function to derive some unique data, then we
	// can pass that data to the keyPairFromSeed() function. This will
	// create a keypair, which we can pull the pubkey from to figure out
	// what key we are supposed to look up.
	//
	// We can use the sha512 function to derive the datakey.
	//
	// We can sign the entry using sign when we're pushing an update, and
	// we can verify the entry using verify.
	return [null, null]
}

// loadSkynetKernel handles loading the rest of the skynet-kernel from the user's
// skynet storage. This will include loading all installed modules. A global
// variable is used to ensure that the loading process only happens once.
//
// We have the variables kernelLoaded and kernelLoading to prevent race
// conditions if multiple threads attempt to trigger a kernel load
// simultaneously. kernelLoading is set initially to indicate that we are
// attempting to load the kernel. It may fail, which will cause the value to be
// un-set.
//
// TODO: Need to switch the kernelLoaded and kernelLoading variables to use
// atomics.
var kernelLoaded = false;
var kernelLoading = false;
var loadSkynetKernel = function() {
	console.log("progress", "kernel is loading");

	// Check the loading status of the kernel. If the kernel is loading,
	// block until the loading is complete and then send a message to the
	// caller indicating a successful load.
	//
	// TODO: I'm not sure this flow is correct.
	if (kernelLoaded || kernelLoading) {
		return;
	}
	kernelLoading = true;
	console.log("progress", "kernel loading passed the safety race condition");

	// TODO: Check localstorage (or perhaps an encrypted indexededdb) for
	// the kernel to see if it is already loaded.

	// TODO: Grab the registry entry that should be holding the location of
	// the user's kernel.

	// Load the rest of the script from Skynet.
	// 
	// TODO: Instead of loading a hardcoded skylink, fetch the data from
	// the user's Skynet account. If there is no data in the user's Skynet
	// account, fall back to a hardcoded default. The default can save a
	// round trip by being the full javascript instead of being a v1
	// skylink.
	//
	// TODO: If there is some sort of error, need to set kernelLoading to
	// false and then send a 'authFailed' message or some other sort of
	// error notification.
	downloadV1Skylink("https://siasky.net/branch-file:::skynet-kernel-skyfiles/skynet-kernel.js/")
		.then(text => {
			console.log("progress", "full kernel loaded");
			console.log(text);
			eval(text);
			console.log("progress", "full kernel eval'd");
			kernelLoaded = true;
			window.parent.postMessage({kernelMethod: "skynetKernelLoaded"}, "*");
		});
}

// handleMessage is called by the message event listener when a new message
// comes in. This function is intended to be overwritten by the kernel that we
// fetch from the user's Skynet account.
//
// TODO: This doesn't have to be 'any' I just don't know what type to put here.
var handleMessage = function(event: any) {
	console.log("progress", "Skynet Kernel: handleMessage is being called with unloaded kernel");
	return;
}

// Establish the event listener for the kernel. There are several default
// requests that are supported, namely everything that the user needs to create
// a seed and log in with an existing seed, because before we have the user
// seed we cannot load the rest of the skynet kernel.
//
// TODO: This doesn't have to be 'any' I just don't know what type to put here.
window.addEventListener("message", (event: any) => {
	// Log every incoming message to help app developers debug their
	// applications.
	//
	// TODO: Switch this to only logging when debug mode is set.
	console.log("Skynet Kernel: message received");
	console.log(event.data);
	console.log(event.origin);

	// Check that the authentication suceeded. If authentication did not
	// suceed, send a postMessage indicating that authentication failed.
	let [userSeed, err] = getUserSeed();
	if (err !== "") {
		console.log("progress", "auth has failed, sending an authFailed message", err);
		window.parent.postMessage({kernelMethod: "authFailed"}, "*");
		return;
	}
	console.log("progress", "user is authenticated");

	// Establish a handler to handle a request which states that
	// authentication has been completed. Because we have already called
	// hasUserSeed() earlier in the function, we know that the correct seed
	// exists. We therefore just need to load the rest of the Skynet kernel.
	// 
	// TODO: Need to check the origin here.
	if (event.data.kernelMethod === "authCompleted") {
		loadSkynetKernel();
		return;
	}

	// Establish a debugging handler that a developer can call to verify
	// that round-trip communication has been correctly programmed between
	// the kernel and the calling application.
	if (event.data.kernelMethod === "requestTest") {
		console.log("progress", "sending receiveTest message to source");
		console.log("progress", event.source);
		event.source.postMessage({kernelMethod: "receiveTest"}, "*");
		return;
	}

	// Establish a means for the user to logout. Only logout requests
	// provided by home are allowed.
	if (event.data.kernelMethod === "logOut" && event.origin === "https://home.siasky.net") {
		logOut();
		console.log("progress", "sending logOutSuccess message to home");
		try {
			event.source.postMessage({kernelMethod: "logOutSuccess"}, "https://home.siasky.net");
		} catch (err) {
			console.log("ERROR:", err);
		}
		return;
	}

	// handleMessage will be overwritten after the kernel is loaded and can
	// add additional API calls.
	handleMessage(event);
}, false);

// If the user seed is in local storage, we'll load the kernel. If the user seed
// is not in local storage, we'll report that the user needs to perform
// authentication.
let [userSeed, err] = getUserSeed()
if (err !== "") {
	console.log("progress", "auth failed, sending message");
	window.parent.postMessage({kernelMethod: "authFailed"}, "*");
} else {
	console.log("progress", "auth succeeded, loading kernel");
	loadSkynetKernel();
}
