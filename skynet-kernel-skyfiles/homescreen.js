// TODO: We already get access to the logging function don't we? And, should we
// be moving that from the extension code to here? Probably, because we really
// do want the extension to be as thin as possible.

// Overwrite the handleMessage object of the homescreen
// script so that we can add more communications to
// homescreen.
var handleMessage = function(event) {
	// TODO: Debugging logs only.
	if (event.data.kernelMethod === "receiveTest") {
		console.log("Homescreen: handleMessage override successful");
	}

	// Reload the homepage if the user has logged out, so that they can log
	// in again.
	if (event.data.kernelMethod === "logOutSuccess") {
		window.location.reload(true);
	}
}

// Send a message to perform a test ping and confirm that the script was loaded
// correctly.
kernel.contentWindow.postMessage({kernelMethod: "requestTest"}, "https://kernel.siasky.net");

// Create a doNothing function.
// 
// TODO: This is used in the onclick for disabled buttons, there might be a
// better way.
var doNothing = function() {}

// Create a function to update the logging buttons. It'll look at local storage
// and update all of the buttons according to the latest settings. Call this
// function after modifying the settings.
var updateLoggingButtons = function() {
	let logSettings = JSON.parse(localStorage.getItem("logSettings"));
	if (logSettings === null) {
		// Create a fake object to avoid null errors.
		logSettings = {};
	}
	if (logSettings.disableAllLogs === true) {
		// Update the suppress all logs button.
		document.getElementById("disableAllLogsButton").textContent = "Logging disabled, click to enable";
		document.getElementById("disableAllLogsButton").onclick = enableLogs;

		// Update all the other buttons.
		document.getElementById("messageLogsButton").textContent = "All logging disabled";
		document.getElementById("messageLogsButton").onclick = doNothing;
		document.getElementById("performanceLogsButton").textContent = "All logging disabled";
		document.getElementById("performanceLogsButton").onclick = doNothing;
		document.getElementById("progressLogsButton").textContent = "All logging disabled";
		document.getElementById("progressLogsButton").onclick = doNothing;
		return;
	} else {
		document.getElementById("disableAllLogsButton").textContent = "Click to disable all logs";
		document.getElementById("disableAllLogsButton").onclick = disableAllLogs;
	}
	if (logSettings.message !== false) {
		document.getElementById("messageLogsButton").textContent = "Enabled, click to disable";
		document.getElementById("messageLogsButton").onclick = disableMessageLogs;
	} else {
		document.getElementById("messageLogsButton").textContent = "Disabled, click to enable";
		document.getElementById("messageLogsButton").onclick = enableMessageLogs;
	}
	if (logSettings.performance !== false) {
		document.getElementById("performanceLogsButton").textContent = "Enabled, click to disable";
		document.getElementById("performanceLogsButton").onclick = disablePerformanceLogs;
	} else {
		document.getElementById("performanceLogsButton").textContent = "Disabled, click to enable";
		document.getElementById("performanceLogsButton").onclick = enablePerformanceLogs;
	}
	if (logSettings.progress !== false) {
		document.getElementById("progressLogsButton").textContent = "Enabled, click to disable";
		document.getElementById("progressLogsButton").onclick = disableProgressLogs;
	} else {
		document.getElementById("progressLogsButton").textContent = "Disabled, click to enable";
		document.getElementById("progressLogsButton").onclick = enableProgressLogs;
	}
}

// Create the pair of functions that manage the button to disable logging.
var disableAllLogs = function() {
	let logSettings = JSON.parse(localStorage.getItem("logSettings"));
	logSettings.disableAllLogs = true;
	localStorage.setItem("logSettings", JSON.stringify(logSettings));
	updateLoggingButtons();
}
var enableLogs = function() {
	let logSettings = JSON.parse(localStorage.getItem("logSettings"));
	logSettings.disableAllLogs = false;
	localStorage.setItem("logSettings", JSON.stringify(logSettings));
	updateLoggingButtons();
}

// enableXLogs is a generic function for enabling logs of type X.
var enableXLogs = function(type) {
	let logSettings = JSON.parse(localStorage.getItem("logSettings"));
	logSettings[type] = true;
	localStorage.setItem("logSettings", JSON.stringify(logSettings));
	updateLoggingButtons();
}
// disableXLogs is a generic function for enabling logs of type X.
var disableXLogs = function(type) {
	let logSettings = JSON.parse(localStorage.getItem("logSettings"));
	logSettings[type] = false;
	localStorage.setItem("logSettings", JSON.stringify(logSettings));
	updateLoggingButtons();
}

// Create the functions the various buttons.
var enableMessageLogs = function() {
	enableXLogs("message");
}
var disableMessageLogs = function() {
	disableXLogs("message");
}
var enablePerformanceLogs = function() {
	enableXLogs("performance");
}
var disablePerformanceLogs = function() {
	disableXLogs("performance");
}
var enableProgressLogs = function() {
	enableXLogs("progress");
}
var disableProgressLogs = function() {
	disableXLogs("progress");
}

// Add a log out action to the log out button.
var logOut = function() {
	kernel.contentWindow.postMessage({kernelMethod: "logOut"}, "https://kernel.siasky.net");
};
var button = document.getElementById("logOutButton");
button.onclick=logOut;

// Set the logging buttons.
updateLoggingButtons();
