export {}

declare var browser

// composeErr takes a series of inputs and composes them into a single string.
// Each element will be separated by a newline. If the input is not a string,
// it will be transformed into a string with JSON.stringify.
//
// Any object that cannot be stringified will be skipped, though an error will
// be logged.
function composeErr(...inputs: any): string {
	let result = "";
	for (let i = 0; i < inputs.length; i++) {
		// Prepend a newline if this isn't the first element.
		if (i !== 0) {
			result += "\n"
		}
		// Strings can be added without modification.
		if (typeof inputs[i] === "string") {
			result += inputs[i]
			continue
		}
		// Everything else needs to be stringified, log an error if it
		// fails.
		try {
			let str = JSON.stringify(inputs[i])
			result += str
		} catch {
			console.error("unable to stringify input to composeErr")
		}
	}
	return result
}

// blockUntilKernelLoaded is a promise that will resolve when the kernel sends
// a message indicating it has loaded. We store the resolve function in a
// global variable so the promise can be resolved by another frame.
var kernelLoaded
var kernelLoadedResolved = false
var blockUntilKernelLoaded = new Promise(x => { kernelLoaded = x })

// queryKernel returns a promise that will resolve when the kernel has
// responded to the query. The resolve function is stored in the kernelQueries
// object using the nonce as the key. It will be called by the listener that
// receives the kernel's response.
//
// NOTE: the queriesNonce and queries object is also shared by the
// bridgeListener.
//
// NOTE: queryKernel cannot be used if you need queryUpdates or
// responseUpdates, it's only intended to be used with single-message queries.
var queriesNonce = 1
var queries = new Object()
function queryKernel(query) {
	return new Promise((resolve, reject) => {
		let nonce = queriesNonce
		queriesNonce += 1
		let respond = function(data) {
			if (!("method" in data)) {
				console.error("received response without a method field", data)
				let cErr = composeErr("received response without a method field", data)
				reject(cErr)
				return
			}
			if (data.method !== "response") {
				console.error("received bad method, incompatible with queryKernel", data)
				let cErr = composeErr("received bad method in queryKernel", data)
				reject(cErr)
				return
			}
			if (!("err" in data)) {
				let cErr = composeErr("received response with no defined error", data)
				console.error("received response with no defined error", data)
				reject(cErr)
				return
			}
			if (data.err !== null) {
				let cErr = composeErr("queryKernel received an error", data.err)
				reject(cErr)
				return
			}
			resolve(data)
		}
		blockUntilKernelLoaded
		.then(x => {
			// Grab the next nonce and store a promise resolution in the
			// kernelQueries object.
			query.nonce = nonce
			queries[nonce] = respond
			kernelFrame.contentWindow.postMessage(query, "http://kernel.skynet")
		})
	})
}

// bridgeBridgeMessage and the related functions will receive and handle
// messages coming from the bridge. Note that many instances of the bridge can
// exist across many different web pages.
function handleBridgeMessage(port: any, data: any, domain: string) {
	// Input sanitization.
	if (!("nonce" in data)) {
		console.error("received message from", domain, "with no nonce")
		return
	}
	let originalNonce = data.nonce

	// Build the functions that will respond to any messages that come from
	// the kernel.
	//
	// NOTE: This has been structured so that you can use the same function
	// for both responseUpdate messages and also response messages.
	let respond = function(response) {
		response.nonce = originalNonce
		port.postMessage(response)
	}

	blockUntilKernelLoaded
	.then(x => {
		// Grab the next nonce and store a promise resolution in the
		// queries object.
		let nonce = queriesNonce
		queriesNonce += 1
		queries[nonce] = respond
		data.nonce = nonce
		data.domain = domain
		kernelFrame.contentWindow.postMessage(data, "http://kernel.skynet")
	})
}
function bridgeListener(port) {
	// Grab the domain of the webpage that's connecting to the background
	// page. The kernel needs to know the domain so that it can
	// conditionally apply restrictions or grant priviledges based on the
	// domain. This is especially important for modules, as admin access to
	// control the data of a module is typically only granted to a single
	// web domain.
	let domain = new URL(port.sender.url).hostname
	port.onMessage.addListener(function(data) { handleBridgeMessage(port, data, domain) })
}
// Add a listener that will catch messages from content scripts.
browser.runtime.onConnect.addListener(bridgeListener)

// reloadKernel gets called if the kernel issues a signal indicating that it
// should be reloaded. That will be the last message emitted by the kernel
// until it is reloaded.
var reloading = false
function reloadKernel() {
	// Reset the kernel loading variables. This will cause all new messages
	// to block until the reload is complete.
	kernelLoadedResolved = false
	blockUntilKernelLoaded = new Promise(x => { kernelLoaded = x })
	queriesNonce = 1

	// Reset the queries array. All open queries need to be rejected, as
	// the kernel will no longer be processing them.
	Object.keys(queries).forEach((key, i) => {
		queries[key].respond({
			nonce: queries[key].nonce,
			method: "response",
			err: "kernel was refreshed due to auth event, query has been cancelled",
		})
		delete queries[key]
	})

	// If we reset the kernel immediately, there is a race condition where
	// the old kernel may have emitted a 'skynetKernelLoaded' message that
	// hasn't been processed yet. If that message gets processed before the
	// new kernel has loaded, we may start sending messages that will get
	// lost.
	//
	// To mitigate this risk, we wait a full second before reloading the
	// kernel. This gives the event loop a full second to reach any
	// messages which may be from the old kernel indicating that the kernel
	// finished loading. If a 'skynetKernelLoaded' message is received
	// while 'reloading' is set to false, it will be ignored.
	//
	// For UX, waiting 300 milliseconds is not ideal, but this should only
	// happen in the rare event of a login or log out, something that a
	// user is expected to do less than once a month. I could not find any
	// other reliable way to ensure a 'skynetKernelLoaded' message would
	// not be processed incorrectly, and even this method is not totally
	// reliable.
	reloading = true
	setTimeout(function() {
		reloading = false
		// This is a neat trick to reload the iframe.
		kernelFrame.src += ''
	}, 300)
}

// Create a handler for all kernel responses. The responses are all keyed by a
// nonce, which gets matched to a promise that's been stored in 'queries'.
function handleKernelResponse(event) {
	// Ignore all messages that aren't coming from the kernel.
	if (event.origin !== "http://kernel.skynet") {
		return
	}
	if (!("method" in event.data) || typeof event.data.method !== "string") {
		return
	}
	let data = event.data
	let method = data.method

	// Check for the kernel requesting a log event. This infrastructure is
	// in place because calling 'console.log' from the kernel itself does
	// not seem to result in the log actually getting displayed in the
	// console of the background page.
	if (method === "log") {
		if (!("data" in data) || !("isErr" in data.data) || typeof data.data.isErr !== "boolean") {
			console.error("kernel sent a log message with no 'isErr' field", data)
			return
		}
		if (!("message" in data.data)) {
			console.error("kernel sent a log message with no 'message' field", data)
			return
		}
		if (data.data.isErr === false) {
			console.log(data.data.message)
		} else {
			console.error(data.data.message)
		}
		return
	}

	// If the kernel is reporting anything to indicate a change in auth
	// status, reload the extension.
	if (method === "authStatusChanged") {
		console.log("received authStatusChanged signal, reloading the kernel")
		reloadKernel()
		return
	}

	// Listen for the kernel successfully loading. If we know that a
	// reloading signal was received, we will ignore messages indicating
	// that the kernel has loaded, because those messages are from the
	// previous kernel, which we have already reset.
	if (method === "skynetKernelLoaded" && reloading === false) {
		console.log("kernel has loaded")
		if (kernelLoadedResolved !== true) {
			kernelLoaded() // This is resolving a promise
			kernelLoadedResolved = true
		}
		return
	}

	// The only other methods we are expecting from the kernel are
	// 'response' and 'responseUpdate'.
	if (method !== "response" && method !== "responseUpdate") {
		console.error("received a message from the kernel with unrecognized method:", event.data)
		return
	}

	// Grab the nonce, determine the status of the response, and then
	// resolve or reject accordingly.
	if (!("nonce" in event.data) || typeof event.data.nonce !== "number") {
		console.log("received a kernel message without a nonce\n", event.data)
		return
	}
	if (!(event.data.nonce in queries)) {
		console.log("received a kernel message without a corresponding query\n", event.data)
		return
	}
	let result = queries[event.data.nonce]
	if (method === "response") {
		delete queries[event.data.nonce]
	}
	result(event.data)
}
// Create a listener to handle responses coming from the kernel.
window.addEventListener("message", handleKernelResponse)

// onBeforeRequestListener processes requests that are sent to us by the
// onBeforeRequest hook. The page 'kernel.skynet' is hardcoded and will be
// completely swallowed, returning a blank page. The content script for
// 'kernel.skynet' will inject code that loads the kernel.
//
// For all other pages, the kernel will be consulted. The kernel will either
// indicate that the page should be ignored and therefore loaded as the server
// presents it, or the kernel will indicate that an alternate response should
// be provided.
//
// NOTE: The implementation details for the use of the filterResponseData
// object, in particular around the 'filter.onstart', 'filter.ondata',
// 'filter.onstop', 'filter.write', 'filter.close', and 'filter.disconnect' are
// quite tempermental. It has been my experience that these things don't behave
// quite like explained in the MDN documentation. I also found
// music.youtube.com to be particularly useful when debugging, as it was very
// sensitive to any mistakes that were made in this function.
let headers: any = new Object()
function onBeforeRequestListener(details) {
	// Set up a promise that will be used by onHeadersReceived to inject
	// the right headers into the response. onHeadersReceived will compare
	// the requestId that it gets to the 'headers' hashmap, and will do
	// nothing unless there's a promise in the hashmap. This code is
	// guaranteed to fire before onHeadersReceived fires.
	let resolveHeaders
	headers[details.requestId] = new Promise((resolve, reject) => {
		resolveHeaders = resolve
	})

	// Grab the filter for this request. As soon as we call it, the
	// behavior of the webpage changes such that no data will be served and
	// the request will hang. It is now our responsibility to ensure that
	// we call filter.write and filter.close.
	//
	// NOTE: In my experience, filter.disconnect didn't work as described
	// in the docs. We therefore avoid its use here and instead make
	// explicit calls to filter.close, using promises to ensure that we
	// don't call filter.close until we've finished writing everything that
	// we intend to write.
	let filter = browser.webRequest.filterResponseData(details.requestId)

	// Set filter.onerror so we can log anything that goes wrong.
	filter.onerror = event => {
		console.error(filter.error)
	}

	// If the request is specifically for the kernel iframe, we swallow the
	// request entirely. The content scripts will take over and ensure the
	// kernel loads properly.
	if (details.url === "http://kernel.skynet/") {
		resolveHeaders([{
			name: "content-type",
			value: "text/html; charset=utf8",
		}])
		filter.onstart = function(event) {
			// Calling filter.close() immediately as the filter
			// starts will ensure that no data is served.
			filter.close()
		}
		return {}
	}

	// If the kernel is still starting up, don't intercept any requests. If
	// we try to intercept requests at this stage, the kernel won't be able
	// to complete startup until our queryKernel call resolves, and our
	// queryKernel call will block until kernel startup is complete,
	// resulting in deadlock.
	//
	// TODO: This is sloppy, because we really do want to intercept all
	// requests except for the requests made by the kernel, and have those
	// requests block until the kernel has loaded fully. There might be a
	// way to accomplish this by changing the startup progression of the
	// kernel. 'kernelLoaded' would indicate that the kernel is ready to
	// receive requests, and the kernel would internally know which inbound
	// requests are intended to be parsed pre-auth.
	if (kernelLoadedResolved === false) {
		console.log("ignoring OBR because kernel has not loaded", details.url)
		resolveHeaders(null)
		filter.ondata = function(event) {
			filter.write(event.data)
		}
		filter.onstop = event => {
			filter.close()
		}
		return {}
	}

	// Set up a query to the kernel that will ask what response should be
	// used for this page. The kernel will provide information about both
	// what the response body should be, and also what the response headers
	// should be.
	//
	// We need to set filter.onstart and filter.onstop inside of this
	// frame, therefore we cannot set them after the queryKernel promise
	// resolves. But we need to make sure that the code inside of
	// filter.onstart and filter.onstop doesn't run until after we have our
	// response from the kernel, so we need to use a promise to coordinate
	// the timings. The 'blockFilter' promise will block any filter
	// operations until the kernel query has come back.
	let resolveFilter
	let blockFilter = new Promise((resolve, reject) => {
		resolveFilter = resolve
	})
	queryKernel({
		method: "requestOverride",
		data: {
			url: details.url,
			method: details.method,
		},
	})
	.then((response: any) => {
		// Check for correct inputs from the kernel. Any error
		// will result in ignoring the request, which we can do
		// by resolving 'null' for the headers promise, and by
		// disconnecting from the filter.
		if (!("data" in response) || !("override" in response.data)) {
			console.error("requestOverride response has no 'override' field\n", response)
			resolveHeaders(null)
			resolveFilter(null)
			return
		}
		if (!("err" in response) || response.err !== null) {
			console.error("requestOverride returned an error\n", response.err)
			resolveHeaders(null)
			resolveFilter(null)
			return
		}
		// If the kernel doesn't explicitly tell us to override
		// this request, then we ignore the request.
		if (response.data.override !== true) {
			resolveHeaders(null)
			resolveFilter(null)
			return
		}
		if (!("body" in response.data)) {
			console.error("requestOverride response is missing 'body' field\n", response)
			resolveHeaders(null)
			resolveFilter(null)
			return
		}
		if (!("headers" in response.data)) {
			console.error("requestOverride response is missing 'headers' field\n", response)
			resolveHeaders(null)
			resolveFilter(null)
			return
		}

		// We have a set of headers and a response body from
		// the kernel, we want to inject them into the
		// response. We resolve the headers promise with the
		// headers provided by the kernel, and we write the
		// response data to the filter. After writing the
		// response data we close the filter so that no more
		// data from the server can get through.
		resolveHeaders(response.data.headers)
		resolveFilter(response.data.body)
	})
	.catch(err => {
		console.error("requestOverride query to kernel failed:", err)
		resolveHeaders(null)
		resolveFilter(null)
	})

	// Set the filter.ondata and the filter.onstop functions. filter.ondata
	// will block until the kernel query returns, and then it will write
	// the webpage based on what the kernel responds.
	//
	// The blockClose promise will block the call to filter.close until the
	// full data has been written.
	let closeFilter
	let blockClose = new Promise((resolve, reject) => {
		closeFilter = resolve
	})
	filter.ondata = function(event) {
		blockFilter.then(response => {
			if (response === null) {
				filter.write(event.data)
			} else {
				filter.write(response)
			}
			closeFilter()
		})
	}
	filter.onstop = function(event) {
		blockClose.then(x => {filter.close()})
	}
	return {}
}
browser.webRequest.onBeforeRequest.addListener(
	onBeforeRequestListener,
	{urls: ["<all_urls>"]},
	["blocking"]
)

// onHeadersReceivedListener will replace the headers provided by the portal
// with trusted headers, preventing the portal from providing potentially
// malicious information through the headers.
function onHeadersReceivedListener(details) {
	// There is an item for this request. Return a promise that will
	// resolve to updated headers when we know what the updated headers are
	// supposed to be.
	//
	// We aren't going to know until the kernel has finished downloading
	// the original page, this typically completes after we need the
	// headers, which is why we use promises rather than using the desired
	// values directly.
	return new Promise((resolve, reject) => {
		// Do nothing if there's no item for this request in the headers
		// object.
		if (!(details.requestId in headers)) {
			// TODO: If the query was _just_ a headers query, we
			// may need to ask the kernel anyway.
			resolve({responseHeaders: details.responseHeaders})
			return
		}

		let h = headers[details.requestId]
		delete headers[details.requestId]
		h.then(response => {
			if (response !== null) {
				resolve({responseHeaders: response})
			} else {
				resolve({responseHeaders: details.responseHeaders})
			}
		})
		.catch(err => {
			console.error("headers promise failed", details.url, "\n", err)
			resolve({responseHeaders: details.responseHeaders})
		})
	})
}
browser.webRequest.onHeadersReceived.addListener(
	onHeadersReceivedListener,
	{urls: ["<all_urls>"]},
	["blocking", "responseHeaders"]
)

// Establish a proxy that enables the user to visit non-existent TLDs, such as
// '.hns' and '.eth' and '.skynet'. The main idea behind this proxy is that we
// proxy non-existant URLs to a URL that does exist, so that the page still
// loads.
//
// We use proxies as a workaround for a fundamental limitation of
// onBeforeRequest - you cannot replace or inject a webpage that does not
// exist. We can't support imaginary domains like 'kernel.skynet' without a
// proxy because they don't actually exist, which means any calls to
// 'filter.write()' in an 'onBeforeRequest' response will fail. If we could
// cancel a request in onBeforeRequest while also still being able to write a
// response and injecting headers with 'onHeadersReceived', we could drop the
// proxy requirement.
//
// Similary, we need to use 'type: "http"' instead of 'type: "https"' because
// the proxy server does not have TLS certs for the imaginary domains. This
// will result in the user getting an insecure icon in the corner of their
// browser. Even though the browser thinks the communication is insecure, the
// truth is that the whole page is being loaded from a secure context (the
// kerenl) and is being authenticated and often (though not always) encrypted
// over transport. So the user is safe from MitM attacks and some forms of
// snooping despite the insecure warning.
//
// The proxy itself has a hard-coded carve-out for 'kernel.skynet' to allow the
// kernel to load, and all other requests are routed to the kernel so that the
// kernel can decide whether a proxy should be used for that page.
//
// TODO: Need to add an extension-level override for the proxy destination. The
// kernel reports one option for where the proxy should go, but for example you
// can massively speed up skynet by setting up a proxy server on localhost and
// pointing to that. The kernel is global, but the proxy server will only be
// available on one machine. Therefore, you need to be able to configure on a
// per-machine level (meaning, through the extension not through the kernel)
// where the proxies should redirect to. Defintely a post-launch sort of thing.
function handleProxyRequest(info) {
	// Hardcode an exception for 'kernel.skynet'. We need this exception
	// because that's where the kernel exists, and the kernel needs to be
	// loaded before we can ask the kernel whether we should be proxying
	// something.
	//
	// TODO: We need some sort of failover resiliency here. The major
	// challenge that I see is identifying when the primary destination is
	// down / unusable. If we can easily know if it's up or down, we can
	// easily swap in a failover url. And we will also want some sort of
	// in-extenion UI that allows the user to set their failover options.
	// And we'll also want to load the set of failover options from
	// localstorage, and get that list of failover options from the kernel.
	let hostname = new URL(info.url).hostname
	if (hostname === "kernel.skynet") {
		return {type: "http", host: "siasky.net", port: 80}
	}

	// If the kernel is still starting up, we don't proxy anything.
	//
	// TODO: This is bad, because it means that users going to .skynet URLs
	// during startup are going to be presented with a 'could not find
	// page' warning rather than having the page wait to load until the
	// kernel is ready. The only way to solve this is to have some way to
	// distinguish between requests that are coming from the kernel during
	// startup and requests that aren't.
	//
	// I wonder if one option is to use a different method during startup
	// where the kernel will block if its not making its own request, and
	// otherwise continue. That's a lot of work though, we're going to
	// leave it imperfect for MVP and we'llcome back to it later
	if (kernelLoadedResolved === false) {
		return {type: "direct"}
	}

	// Ask the kernel whether there should be a proxy for this url.
	let query = queryKernel({
		method: "proxyInfo",
		data: { url: info.url },
	})
	query.then((response: any) => {
		// Input sanitization.
		if (!("data" in response)) {
			console.error("kernel did not include a 'data' field in the data\n", response)
			return {type: "direct"}
		}
		let data = response.data
		if (!("proxy" in data) || typeof data.proxy !== "boolean") {
			console.error("kernel did not include a 'proxy' in the data\n", response)
			return {type: "direct"}
		}
		if (data.proxy === false) {
			return {type: "direct"}
		}
		if (!("destinationType" in data) || typeof data.destinationType !== "string") {
			console.error("kernel did not include a destinationType in the data\n", response)
			return {type: "direct"}
		}
		if (!("destinationHost" in data) || typeof data.destinationHost !== "string") {
			console.error("kernel did not include a destinationHost in the data\n", response)
			return {type: "direct"}
		}
		if (!("destinationPort" in data) || typeof data.destinationPort !== "number") {
			console.error("kernel did not include a destinationPort in the data\n", response)
			return {type: "direct"}
		}
		return {
			type: data.destinationType,
			host: data.destinationHost,
			port: data.destinationPort,
		}
	})
	.catch(errQK => {
		console.error("error after sending proxyInfo message:", errQK)
		return {type: "direct"}
	})
}
browser.proxy.onRequest.addListener(handleProxyRequest, {urls: ["<all_urls>"]})

// Open an iframe containing the kernel.
var kernelFrame = document.createElement("iframe")
kernelFrame.src = "http://kernel.skynet"
document.body.appendChild(kernelFrame)
