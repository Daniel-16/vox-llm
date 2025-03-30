let recognition;
let ongoingRecognition = false; // Track internal state

// --- getUserMedia Test Function ---
async function testGetUserMedia() {
    console.log("Offscreen: Attempting direct getUserMedia test...");
    try {
        // Request audio stream
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Offscreen: getUserMedia SUCCESSFUL!", stream);
        // We got the stream, now stop the tracks immediately as we just wanted to test permission
        stream.getTracks().forEach(track => track.stop());
        // Send success message back
        chrome.runtime.sendMessage({ type: "GUM_TEST_SUCCESS" }).catch(e => console.warn("Offscreen: Could not send GUM_TEST_SUCCESS", e));

    } catch (error) {
        console.error("Offscreen: getUserMedia FAILED:", error.name, error.message, error);
        // Send detailed error back
        chrome.runtime.sendMessage({ type: "GUM_TEST_FAILURE", errorName: error.name, errorMessage: error.message }).catch(e => console.warn("Offscreen: Could not send GUM_TEST_FAILURE", e));
    }
}


// Check if the API is available
if (!('webkitSpeechRecognition' in window)) {
    console.error("Offscreen: Web Speech API not supported here.");
    // Send error back? Maybe unnecessary if getUserMedia test runs.
    chrome.runtime.sendMessage({ type: "REC_ERROR", error: "api_not_supported" }).catch(e => console.warn("Offscreen: Could not send REC_ERROR", e));

} else {
    const SpeechRecognition = window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        ongoingRecognition = true;
        console.log('Offscreen: Speech recognition started.');
        chrome.runtime.sendMessage({ type: "REC_STARTED" }).catch(e => console.warn("Offscreen: Could not send REC_STARTED", e));
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        console.log('Offscreen: Transcript:', transcript);
        if (transcript) {
            chrome.runtime.sendMessage({ type: "TRANSCRIPT_RECEIVED", data: transcript }).catch(e => console.warn("Offscreen: Could not send TRANSCRIPT_RECEIVED", e));
        }
    };

    recognition.onerror = (event) => {
        ongoingRecognition = false; // Ensure state is reset
        console.error('Offscreen: Speech recognition error:', event.error);
        chrome.runtime.sendMessage({ type: "REC_ERROR", error: event.error }).catch(e => console.warn("Offscreen: Could not send REC_ERROR", e));
    };

    recognition.onend = () => {
        ongoingRecognition = false;
        console.log('Offscreen: Speech recognition ended.');
        chrome.runtime.sendMessage({ type: "REC_ENDED" }).catch(e => console.warn("Offscreen: Could not send REC_ENDED", e));
    };
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_RECOGNITION') {
        console.log("Offscreen: Received START_RECOGNITION");
        if (recognition && !ongoingRecognition) {
            try {
                 console.log("Offscreen: Calling recognition.start()");
                 recognition.start();
            } catch (e) {
                 console.error("Offscreen: Error starting recognition:", e);
                 chrome.runtime.sendMessage({ type: "REC_ERROR", error: "start_failed" }).catch(err => console.warn("Offscreen: Could not send REC_ERROR", err));
            }
        } else if (ongoingRecognition) {
             console.warn("Offscreen: Recognition already active.");
        } else {
             console.error("Offscreen: Recognition API not initialized or not supported.");
             chrome.runtime.sendMessage({ type: "REC_ERROR", error: "not_initialized" }).catch(err => console.warn("Offscreen: Could not send REC_ERROR", err));
        }

    } else if (message.type === 'STOP_RECOGNITION') {
         console.log("Offscreen: Received STOP_RECOGNITION");
         if (recognition && ongoingRecognition) {
             console.log("Offscreen: Calling recognition.stop()");
             recognition.stop();
         } else {
            console.warn("Offscreen: Recognition not active or not initialized.");
            if (!ongoingRecognition) {
                 chrome.runtime.sendMessage({ type: "REC_ENDED" }).catch(e => console.warn("Offscreen: Could not send REC_ENDED", e)); // Notify background it's stopped if needed
            }
         }
    } else if (message.type === 'TEST_GETUSERMEDIA') {
        console.log("Offscreen: Received TEST_GETUSERMEDIA");
        testGetUserMedia(); // Call the test function
    }
});

console.log("Offscreen script loaded.");
// Optional: Run test automatically when script loads for debugging
// testGetUserMedia();