import { logErr } from "./log.js"
import { tryStringify } from "./stringify.js"

// Define helper state for tracking the nonces of queries we open to the kernel
// and to other modules. queriesNonce is a counter that ensures every query has
// a unique nonce, and queries is a hashmap that maps nonces to their
// corresponding queries.
let queriesNonce = 0
let queries = {} as any

// Define an empty function because the linter does not like when you use '() => {}'
let emptyFn = function () {
	return
}

// callModule is a generic function to call a module. It will return whatever
// response is provided by the module.
//
// callModule can only be used for query-response communications, there is no
// support for handling queryUpdate or responseUpdate messages - they will be
// ignored if received. If you need those messages, use 'connectModule'
// instead.
function callModule(module: string, method: string, data: any): Promise<[any, string | null]> {
	let moduleCallData = {
		module,
		method,
		data,
	}
	// We omit the 'receiveUpdate' function because this is a no-op. If the
	// value is not defined, newKernelQuery will place in a no-op for us.
	let [, query] = newKernelQuery("moduleCall", moduleCallData, emptyFn)
	return query
}

// handleResponse will take a response and match it to the correct query.
//
// NOTE: The kernel guarantees that an err field and a data field and a nonce
// field will be present in any message that gets sent using the "response"
// method.
function handleResponse(event: MessageEvent) {
	// Look for the query with the corresponding nonce.
	if (!(event.data.nonce in queries)) {
		logErr("no open query found for provided nonce: " + tryStringify(event.data.data))
		return
	}

	// Check if the response is an error.
	if (event.data.err !== null) {
		logErr("there's an error in the data")
		queries[event.data.nonce].resolve([{}, event.data.err])
		delete queries[event.data.nonce]
		return
	}

	// Call the handler function using the provided data, then delete the query
	// from the query map.
	queries[event.data.nonce].resolve([event.data.data, null])
	delete queries[event.data.nonce]
}

// handleResponseUpdate currently discards all responseUpdates.
//
// TODO: Implement this.
function handleResponseUpdate(event: MessageEvent) {
	return event
}

// handleQueryUpdate currently discards all queryUpdates.
//
// TODO: Implement this.
function handleQueryUpdate(event: MessageEvent) {
	return event
}

// newKernelQuery will send a postMessage to the kernel, handling details like
// the nonce. The first input value is the data that should be sent to the
// kernel. The second input value is an update function that should be called
// to process any 'responseUpdate' messages. The first return value is a
// function that can be called to provide a 'queryUpdate' and the final return
// value is a promise that gets resolved when a 'response' is sent that closes
// out the query.
//
// NOTE: Typically developers should not use this function. Instead use
// 'callModule' or 'connectModule'.
function newKernelQuery(method: any, data: any, receiveUpdate: any): [any, Promise<[any, string | null]>] {
	let nonce = queriesNonce
	queriesNonce += 1
	let sendUpdate = function (updateData: any) {
		// TODO: Implement
		return updateData
	}

	// Check that receiveUpdate is set.
	if (receiveUpdate === null || receiveUpdate === undefined) {
		receiveUpdate = emptyFn
	}

	// Establish the query in the queries map and then send the query to the
	// kernel.
	let p = new Promise((resolve) => {
		queries[nonce] = { resolve, receiveUpdate }
		postMessage({
			method,
			nonce,
			data,
		})
	})
	return [sendUpdate, p as any]
}

export { callModule, handleQueryUpdate, handleResponse, handleResponseUpdate, newKernelQuery }
