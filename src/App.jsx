// src/App.jsx
import React, { useState, useEffect } from 'react';
import './App.css'; // We'll add some basic styling

function App() {
  const [isListening, setIsListening] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
   const [processing, setProcessing] = useState(false); // New state for processing indicator

  // Function to clear messages after a delay
  const clearMessages = () => {
      setTimeout(() => {
          setStatusMessage('');
          setErrorMessage('');
      }, 5000); // Clear after 5 seconds
  };

  // Get initial state from background script when popup opens
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error getting state:", chrome.runtime.lastError.message);
        setErrorMessage("Error connecting to background script.");
        clearMessages();
        return;
      }
      if (response && response.success) {
        setIsListening(response.isListening);
        setApiKeySet(response.apiKeySet);
        setStatusMessage(response.apiKeySet ? "Ready." : "Please enter Gemini API Key.");
         // Don't clear initial status message immediately
      } else {
         setErrorMessage(response?.message || "Failed to get initial state.");
         clearMessages();
      }
    });

    // Listener for updates from the background script
    const messageListener = (request, sender, sendResponse) => {
      if (request.type === "BACKGROUND_STATE_UPDATE") {
        console.log("Popup received state update:", request);
        setIsListening(request.isListening);
        setApiKeySet(request.apiKeySet);
        if (request.processing !== undefined) {
             setProcessing(request.processing); // Update processing state
        }
        // Don't overwrite user-facing status/error messages unless necessary
         if (!request.apiKeySet) {
            setStatusMessage("API Key needed.");
         }
      } else if (request.type === "STATUS") {
         setStatusMessage(request.message);
         setErrorMessage(''); // Clear previous errors
         clearMessages();
      } else if (request.type === "ERROR") {
         setErrorMessage(request.message);
         setStatusMessage(''); // Clear previous status
         clearMessages();
         setProcessing(false); // Ensure processing stops on error
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup listener when the popup closes
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []); // Run only once when the popup mounts

  const handleToggleListen = () => {
    if (!apiKeySet) {
        setErrorMessage("Please set your Gemini API Key first.");
        clearMessages();
        return;
    }
    setProcessing(true); // Indicate something is happening
    setErrorMessage(''); // Clear error
    setStatusMessage(isListening ? "Stopping..." : "Starting..."); // Optimistic UI update

    chrome.runtime.sendMessage({ type: 'TOGGLE_LISTENING' }, (response) => {
       if (chrome.runtime.lastError) {
           console.error("Error toggling listening:", chrome.runtime.lastError.message);
           setErrorMessage("Error communicating with background.");
           setStatusMessage('');
           setProcessing(false); // Stop processing indicator on error
           // Attempt to fetch state again to resync
            chrome.runtime.sendMessage({ type: 'GET_STATE' }, (stateResponse) => {
                 if (stateResponse?.success) {
                    setIsListening(stateResponse.isListening);
                    setApiKeySet(stateResponse.apiKeySet);
                 }
             });
           clearMessages();
           return;
       }
      if (response && response.success) {
        // State update will come via BACKGROUND_STATE_UPDATE listener
        // setIsListening(response.isListening); // No longer needed here
        setStatusMessage(response.isListening ? "Listening..." : "Stopped.");
      } else {
         setErrorMessage(response?.message || "Failed to toggle listening.");
         setStatusMessage('');
      }
      // Processing state will be updated by background script message or error handling
       // setProcessing(false); // Let background message handle this
       clearMessages();
    });
  };

  const handleApiKeyChange = (event) => {
    setApiKeyInput(event.target.value);
  };

  const handleApiKeySave = () => {
      setErrorMessage('');
      setStatusMessage('Saving...');
      chrome.runtime.sendMessage({ type: 'SET_API_KEY', apiKey: apiKeyInput }, (response) => {
          if (chrome.runtime.lastError) {
              console.error("Error saving API key:", chrome.runtime.lastError.message);
              setErrorMessage("Error saving key.");
              setStatusMessage('');
              clearMessages();
              return;
          }
          if (response && response.success) {
              setApiKeySet(true);
              setApiKey(apiKeyInput); // Store locally in state if needed (though background is source of truth)
              setApiKeyInput(''); // Clear input field
              setStatusMessage("API Key Saved!");
              setErrorMessage('');
          } else {
              setErrorMessage(response?.message || "Failed to save API Key.");
              setStatusMessage('');
          }
          clearMessages();
      });
  };

  return (
    <div className="App">
      <h1>Voice Control</h1>

      {errorMessage && <p className="message error">{errorMessage}</p>}
      {statusMessage && <p className="message status">{statusMessage}</p>}

      {!apiKeySet ? (
        <div className="api-key-section">
          <p>Enter your Google Gemini API Key:</p>
          <input
            type="password" // Use password type for keys
            value={apiKeyInput}
            onChange={handleApiKeyChange}
            placeholder="Paste API Key here"
          />
          <button onClick={handleApiKeySave} disabled={!apiKeyInput.trim()}>Save Key</button>
          <p className="note">Your API key will be stored locally using `chrome.storage.sync`.</p>
           <p className="note"><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Get a Gemini API Key</a></p>
        </div>
      ) : (
         <div className='controls'>
             <button
                onClick={handleToggleListen}
                className={`mic-button ${isListening ? 'listening' : ''}`}
                disabled={processing} // Disable while processing
                >
                {processing ? 'Processing...' : (isListening ? 'Stop Listening' : 'Start Listening')}
             </button>
            {/* Optional: Add button to change API key */}
            {/* <button onClick={() => setApiKeySet(false)}>Change API Key</button> */}
         </div>
      )}
    </div>
  );
}

export default App;