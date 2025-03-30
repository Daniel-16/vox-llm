let geminiApiKey = null;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=";
const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// --- State ---
let isListening = false; // Tracks *intent* to listen, actual state managed via messages
let creatingOffscreenDocument = false; // Prevent race conditions

// --- Initialization ---
chrome.storage.sync.get(['geminiApiKey'], (result) => {
  if (result.geminiApiKey) {
    geminiApiKey = result.geminiApiKey;
    console.log("Gemini API Key loaded.");
  } else {
    console.error("Gemini API Key not found. Please set it in the extension options/popup.");
  }
  updatePopupState(); // Update popup with initial key status
});

// --- Offscreen Document Management ---

// Checks if an offscreen document is currently open.
async function hasOffscreenDocument() {
    // Check all existing contexts for a matching document URL
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)] // Match the specific URL
    });
    return existingContexts.length > 0;
}


async function setupOffscreenDocument() {
    console.log("Attempting to set up offscreen document...");
    if (creatingOffscreenDocument) {
        console.warn("Offscreen document creation already in progress.");
        return;
    }
    const hasDoc = await hasOffscreenDocument();
    if (hasDoc) {
        console.log("Offscreen document already exists.");
        return; // Already exists
    }

    creatingOffscreenDocument = true;
    try {
        console.log("Creating offscreen document...");
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: [chrome.offscreen.Reason.USER_MEDIA], // Reason required: Using microphone
            justification: 'Enable voice command input via Web Speech API.',
        });
        console.log("Offscreen document created successfully.");
    } catch (error) {
        console.error("Failed to create offscreen document:", error);
        chrome.runtime.sendMessage({ type: "ERROR", message: "Failed to initialize microphone." });
        updatePopupState({ isListening: false }); // Ensure state reflects failure
    } finally {
        creatingOffscreenDocument = false;
    }
}


async function closeOffscreenDocument() {
    if (!(await hasOffscreenDocument())) {
        console.log("No offscreen document to close.");
        return;
    }
    console.log("Closing offscreen document...");
    await chrome.offscreen.closeDocument();
     console.log("Offscreen document closed.");
}

// --- Message Handling (from Offscreen and Popup) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message.type, message);

    // Messages from Offscreen Document
    if (sender.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)) {
        switch (message.type) {
            case 'TRANSCRIPT_RECEIVED':
                processCommand(message.data); // Process the transcript using Gemini
                // Optional: Stop listening after one transcript if needed
                // stopListening();
                break;
            case 'REC_STARTED':
                isListening = true;
                updatePopupState();
                break;
            case 'REC_ENDED':
                 // Don't automatically close offscreen here, keep it ready
                if (isListening) { // Only update if we weren't explicitly stopping
                    isListening = false;
                    updatePopupState();
                }
                break;
            case 'REC_ERROR':
                console.error("Received speech recognition error from offscreen:", message.error);
                 isListening = false; // Ensure state is false on error
                 let userMessage = "Microphone error.";
                 if (message.error === 'no-speech') userMessage = "No speech detected.";
                 if (message.error === 'audio-capture') userMessage = "Microphone issue.";
                 if (message.error === 'not-allowed') userMessage = "Microphone permission denied.";
                 if (message.error === 'start_failed') userMessage = "Failed to start microphone.";
                 if (message.error === 'not_initialized') userMessage = "Mic API not ready.";
                 chrome.runtime.sendMessage({ type: "ERROR", message: userMessage });
                 updatePopupState();
                // Optional: closeOffscreenDocument(); // Close on error? Maybe not ideal.
                break;
        }
        // --- Messages from Popup ---
    } else if (message.type === 'TOGGLE_LISTENING') {
        if (isListening) {
            stopListening(); // Ask offscreen doc to stop
        } else {
            startListening(); // Ask offscreen doc to start
        }
        sendResponse({ success: true }); // Acknowledge toggle request
    } else if (message.type === 'GET_STATE') {
        sendResponse({ success: true, isListening: isListening, apiKeySet: !!geminiApiKey });
    } else if (message.type === 'SET_API_KEY') {
        if (message.apiKey) {
            geminiApiKey = message.apiKey;
            chrome.storage.sync.set({ geminiApiKey: geminiApiKey }, () => {
                console.log("Gemini API Key saved.");
                sendResponse({ success: true, apiKeySet: true });
                 updatePopupState(); // Update state in case popup needs it
            });
        } else {
            sendResponse({ success: false, message: "No API Key provided." });
        }
        return true; // Indicates async response
    }
     // Return true if you intend to use sendResponse asynchronously elsewhere
    // return true;
});

// --- Listening Control Functions (Interact with Offscreen) ---
async function startListening() {
    console.log("BG: Requesting Start Listening");
    if (!geminiApiKey) {
        console.error("Cannot start listening: Gemini API Key is not set.");
        chrome.runtime.sendMessage({ type: "ERROR", message: "API Key not set. Please set it first." });
        isListening = false; // Ensure state is correct
        updatePopupState();
        return;
    }

    // Ensure offscreen document is ready
    await setupOffscreenDocument(); // Creates if not exists

    // Send message to offscreen document to start recognition
     console.log("BG: Sending START_RECOGNITION to offscreen");
    chrome.runtime.sendMessage({ type: 'START_RECOGNITION' })
      .catch(error => {
           console.error("BG: Error sending START_RECOGNITION:", error);
           // This might happen if the offscreen doc isn't ready yet or closed unexpectedly
           isListening = false;
           updatePopupState();
           chrome.runtime.sendMessage({ type: "ERROR", message: "Mic not ready, try again." });
       });

    // Note: We don't set isListening=true here directly.
    // We wait for the 'REC_STARTED' message from the offscreen document.
    updatePopupState({ processing: true }); // Show processing until REC_STARTED
}

async function stopListening() {
     console.log("BG: Requesting Stop Listening");
    // Send message to offscreen document to stop recognition
    // Check if doc exists before sending? Optional, sending won't hurt if it doesn't exist.
    if (await hasOffscreenDocument()) {
         console.log("BG: Sending STOP_RECOGNITION to offscreen");
        chrome.runtime.sendMessage({ type: 'STOP_RECOGNITION' }).catch(error => {
             console.error("BG: Error sending STOP_RECOGNITION:", error);
        });
    } else {
       console.warn("BG: Stop requested but no offscreen document found.")
    }

    // We set isListening=false immediately for UI responsiveness.
    // The REC_ENDED message will confirm, but this makes the UI faster.
    isListening = false;
    updatePopupState();
}


// --- Gemini Processing (Remains the same) ---
async function processCommand(transcript) {
    if (!geminiApiKey) {
        console.error("Gemini API key not set.");
        chrome.runtime.sendMessage({ type: "ERROR", message: "API Key not set." });
         updatePopupState({ processing: false });
        return;
    }

    console.log(`Sending to Gemini: "${transcript}"`);
    chrome.runtime.sendMessage({ type: "STATUS", message: `Processing: "${transcript}"` });
     updatePopupState({ processing: true }); // Show processing

    const prompt = `
        Analyze the following user voice command and determine the browser action.
        Respond ONLY with a valid JSON object containing 'action' and optional 'params'.
        Do not include any explanations, markdown formatting, or anything outside the JSON object.

        Possible actions and their params:
        - "open_url": { "url": "string" } (Ensure URL starts with https://)
        - "new_tab": {}
        - "close_tab": {}
        - "scroll": { "direction": "up" | "down" }
        - "switch_tab": { "target": "first" | "last" | number (1-8) }

        User Command: "${transcript}"

        JSON Response:
      `;

    try {
        const response = await fetch(`${GEMINI_API_URL}${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 100 }
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Gemini API Error: ${response.status} ${response.statusText}`, errorBody);
            chrome.runtime.sendMessage({ type: "ERROR", message: `Gemini API Error: ${response.status}` });
             updatePopupState({ processing: false });
            return;
        }

        const data = await response.json();
        let commandJson = null;
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            const rawResponse = data.candidates[0].content.parts[0].text;
            console.log("Raw Gemini Response:", rawResponse);
            try {
                commandJson = JSON.parse(rawResponse.trim());
            } catch (parseError) {
                console.error("Failed to parse Gemini JSON:", parseError, "Raw:", rawResponse);
                chrome.runtime.sendMessage({ type: "ERROR", message: "Failed to understand command." });
                 updatePopupState({ processing: false });
                return;
            }
        } else {
            console.error("Invalid response structure from Gemini:", JSON.stringify(data, null, 2));
            chrome.runtime.sendMessage({ type: "ERROR", message: "Received invalid response from AI." });
             updatePopupState({ processing: false });
            return;
        }

        if (commandJson?.action) {
            console.log("Executing command:", commandJson);
            chrome.runtime.sendMessage({ type: "STATUS", message: `Executing: ${commandJson.action}` });
            executeBrowserAction(commandJson);
        } else {
            console.warn("Gemini did not return a valid action.", commandJson);
            chrome.runtime.sendMessage({ type: "ERROR", message: "Couldn't determine action." });
        }

    } catch (error) {
        console.error('Error calling Gemini API:', error);
        chrome.runtime.sendMessage({ type: "ERROR", message: `Network Error: ${error.message}` });
    } finally {
         updatePopupState({ processing: false }); // Ensure processing state is reset
    }
}

// --- Action Execution (Remains mostly the same) ---
async function executeBrowserAction(command) {
      const { action, params } = command;

      try {
          switch (action) {
            case 'open_url':
              if (params && params.url) {
                let url = params.url;
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                  url = 'https://' + url;
                }
                await chrome.tabs.create({ url: url }); // Use await for consistency
              } else {
                 console.error("Missing URL for open_url action");
                 chrome.runtime.sendMessage({ type: "ERROR", message: "No URL provided." });
              }
              break;

            case 'new_tab':
              await chrome.tabs.create({});
              break;

            case 'close_tab':
              { const [currentTabToClose] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (currentTabToClose) {
                await chrome.tabs.remove(currentTabToClose.id);
              } else { console.warn("No active tab found to close."); }
              break; }

            case 'scroll':
              if (params && params.direction) {
                const [currentTabToScroll] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (currentTabToScroll?.id) {
                    console.log("Sending scroll", params.direction, "to tab", currentTabToScroll.id);
                    try {
                         await chrome.scripting.executeScript({
                            target: { tabId: currentTabToScroll.id },
                            func: (dir) => { // Renamed arg to avoid conflict
                                const scrollAmount = window.innerHeight * 0.8;
                                window.scrollBy(0, dir === 'down' ? scrollAmount : -scrollAmount);
                            },
                            args: [params.direction]
                         });
                    } catch (e) {
                       console.error(`Failed script injection/scroll on tab ${currentTabToScroll.id}:`, e);
                       chrome.runtime.sendMessage({ type: "ERROR", message: `Cannot scroll on this page (${e.message}).` });
                    }
                } else { console.warn("No active tab found to scroll."); }
              } else {
                 console.error("Missing direction for scroll");
                 chrome.runtime.sendMessage({ type: "ERROR", message: "Scroll direction missing." });
              }
              break;

            case 'switch_tab':
              if (params && params.target) {
                const target = params.target;
                const tabs = await chrome.tabs.query({ currentWindow: true });
                if (tabs.length <= 1) break;

                let tabIndex = -1;
                if (target === 'first') tabIndex = 0;
                else if (target === 'last') tabIndex = tabs.length - 1;
                else if (typeof target === 'number' && target >= 1 && target <= Math.min(tabs.length, 8) ) { // Ensure target is within bounds
                    tabIndex = target - 1;
                } else {
                    console.warn(`Invalid/out-of-bounds tab target: ${target}`);
                     chrome.runtime.sendMessage({ type: "ERROR", message: `Invalid tab target: ${target}.` });
                     break; // Don't proceed
                }

                if (tabs[tabIndex]) {
                  await chrome.tabs.update(tabs[tabIndex].id, { active: true });
                }
              } else {
                 console.error("Missing target for switch_tab");
                 chrome.runtime.sendMessage({ type: "ERROR", message: "Tab target missing." });
              }
              break;

            default:
              console.warn(`Unknown action: ${action}`);
              chrome.runtime.sendMessage({ type: "ERROR", message: `Unknown action: ${action}.` });
          }
       } catch (error) {
          console.error(`Error executing action ${action}:`, error);
          chrome.runtime.sendMessage({ type: "ERROR", message: `Failed to execute '${action}'.` });
       }
}


// --- Utility ---
// Function to update the popup's state
function updatePopupState(additionalState = {}) {
    const state = {
        type: "BACKGROUND_STATE_UPDATE",
        isListening: isListening,
        apiKeySet: !!geminiApiKey,
        ...additionalState // Merge additional state like 'processing'
    };
    // console.log("Sending state update to popup:", state); // Debug logging
    chrome.runtime.sendMessage(state).catch(error => {
       // Ignore errors if the popup isn't open
       if (error.message !== "Could not establish connection. Receiving end does not exist.") {
           console.warn("Could not send state update to popup:", error);
       }
    });
}

// --- Lifecycle ---
chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === "install") {
        console.log("Extension installed. Configure Gemini API Key.");
    }
    // Clean up any existing offscreen documents on update/reload? Maybe not necessary.
});

chrome.runtime.onStartup.addListener(async () => {
    console.log("Extension starting up...");
    // Clean up potentially lingering offscreen docs from a previous crash?
     await closeOffscreenDocument();
});


console.log("Background service worker loaded.");
// Initial check and state update when script loads/reloads
updatePopupState();