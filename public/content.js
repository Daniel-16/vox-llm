// public/content.js

// This script doesn't need to do anything on load for this specific project.
// It could be used for more complex page interactions if needed later.
// The scrolling logic is directly injected by the background script using `chrome.scripting.executeScript`
// for better control and because content scripts loaded via manifest might not always
// have the guarantee of running *before* the user issues a scroll command immediately
// after page load. Injecting ensures the function exists when called.

console.log("Voice Control content script loaded (minimal functionality).");

// Example of how you *could* listen for messages if needed for other actions:
/*
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SOME_ACTION_ON_PAGE') {
    console.log("Content script received:", request);
    // Do something with the DOM
    // document.body.style.backgroundColor = 'lightblue';
    sendResponse({ success: true, message: "Action completed on page." });
  }
  // return true; // if using async response
});
*/