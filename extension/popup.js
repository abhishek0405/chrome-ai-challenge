let transcript;
const systemPrompt =
  "You are a helpful and friendly meeting assistant. You will be provided a meeting transcript and a follow up question, use the transcript and general knowledge to best answer the question.";
tailwind.config = {
  theme: {
    extend: {
      colors: {
        clifford: "#da373d",
      },
    },
  },
};

const relevancePrompt = `
Here is a part of the transcript:
{chunk}

Question: {query}

If this part of the transcript is relevant to the question, provide an answer.
Otherwise, respond with 'NOT_RELEVANT'.
`;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSCRIPT") {
    const receivedData = message.payload;
    transcript = receivedData.value;
    console.log("saved transcript is ", transcript);
  }
});

function chunkTranscript(transcript, maxTokens = 80) {
  const chunks = [];
  let currentChunk = [];
  let currentChunkTokensCount = 0;

  transcript.forEach((dialogue) => {
    const dialogueTokens = Math.ceil(dialogue.length / 4);

    if (currentChunkTokensCount + dialogueTokens > maxTokens) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(""));
      }
      currentChunk = [dialogue];
      currentChunkTokensCount = dialogueTokens;
    } else {
      currentChunk.push(dialogue);
      currentChunkTokensCount += dialogueTokens;
    }
  });

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(""));
  }
  console.log("Chunks created ", chunks);
  return chunks;
}

async function queryChunk(chunk, query, index) {
  try {
    console.log(`Processing chunk ${index}:`);
    console.log("Chunk content:", chunk);
    console.log("Query:", query);

    const session = await chrome.aiOriginTrial.languageModel.create({
      systemPrompt: systemPrompt,
    });

    const message = relevancePrompt
      .replace("{chunk}", chunk)
      .replace("{query}", query);

    const response = await session.prompt(message);
    console.log(`Response for chunk ${index}:`, response.trim());
    console.log("----------------------------------------");
    return response.trim();
  } catch (error) {
    console.error(`Error processing chunk ${index}:`, error);
    return "ERROR";
  }
}

function summarizeResponses(responses) {
  console.log("Responses before summarizing:", responses);
  const combinedText = responses.join("\n\n");
  const summarizedText =
    combinedText.length > 2000
      ? combinedText.substring(0, 2000) + "..."
      : combinedText;
  console.log("Response after summarizing:", summarizedText);
  return summarizedText;
}
async function handleQuery(userPrompt) {
  const query = userPrompt;
  const currentTranscript = transcript;
  if (!query || !currentTranscript) {
    outputDiv.innerText = "Please provide both a query and a transcript.";
    return;
  }
  const chunks = chunkTranscript(currentTranscript);
  const promises = chunks.map((chunk, index) =>
    queryChunk(chunk, query, index)
  );

  try {
    const responses = await Promise.all(promises);
    console.log("All responses before filtering:", responses);
    const relevantResponses = responses.filter(
      (response) => response !== "NOT_RELEVANT" && response !== "ERROR"
    );
    console.log("Relevant responses after filtering:", relevantResponses);

    if (relevantResponses.length) {
      const summary = summarizeResponses(relevantResponses);
      console.log("summarised response is ", summary);
    } else {
      console.log("No summary found");
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

const toggleSwitch = document.getElementById("toggle-switch");
toggleSwitch.addEventListener("change", async function () {
  var isChecked = this.checked;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {
      action: "extensionEnabled",
      isEnabled: isChecked,
    });
  });
  chrome.storage.sync.set({ extensionEnabled: isChecked }, function () {
    setTimeout(function () {
      setExtensionView();
    }, 500);
  });
});

chrome.storage.sync.get(["extensionEnabled"], function (result) {
  toggleSwitch.checked = result.extensionEnabled || false; 
  setExtensionView();
});

function loggedInView() {
  let contentDiv = document.getElementById("content");
  let authDiv = document.getElementById("auth");
  authDiv.style.display = "none";
  contentDiv.style.display = "block";

  chrome.storage.sync.get(["subtitleWarning"], function (result) {
    setExtensionView();
  });
}

function updateUIElements(enabled) {
  const chatInput = document.getElementById("chat-input");
  const sendButton = document.getElementById("send-button");

  if (enabled) {
    chatInput.disabled = false;
    sendButton.disabled = false;
    chatInput.style.backgroundColor = "";
    sendButton.style.background = "";
    chatInput.style.cursor = "text";
    sendButton.style.cursor = "pointer";
  } else {
    chatInput.disabled = true;
    sendButton.disabled = true;
    chatInput.style.backgroundColor = "#ccc";
    sendButton.style.background = "#ccc";
    chatInput.style.cursor = "not-allowed";
    sendButton.style.cursor = "not-allowed";
  }
}

function toggleCaptionsVisibility(visible, text) {
  const alertMessageElement = document.getElementById("alert-message");
  alertMessageElement.style.display = visible ? "block" : "none";
  if (text) {
    const paragraphElement = alertMessageElement.querySelector("p");
    paragraphElement.textContent = text;
  }
}

async function setExtensionView() {
  chrome.storage.sync.get(
    ["subtitleWarning", "extensionEnabled"],
    function (result) {
      const captionsEnabled = !result.subtitleWarning;
      const extensionEnabled = result.extensionEnabled;

      if (captionsEnabled && extensionEnabled) {
        updateUIElements(true);
        toggleCaptionsVisibility(false, null);
      } else if (!captionsEnabled && extensionEnabled) {
        updateUIElements(false);
        toggleCaptionsVisibility(true, "Enable Captions to get started");
      } else if (captionsEnabled && !extensionEnabled) {
        updateUIElements(false);
        toggleCaptionsVisibility(true, "Toggle to get started");
      } else if (!captionsEnabled && !extensionEnabled) {
        updateUIElements(false);
        toggleCaptionsVisibility(true, "Toggle to get started");
      }
      if (chatContainer && howToUseSection) {
        chatContainer.classList.remove("hidden");
        howToUseSection.classList.add("hidden");
      }
      scrollToBottom();
    }
  );
}

function loggedOutView() {
  let contentDiv = document.getElementById("content");
  let authDiv = document.getElementById("auth");
  authDiv.style.display = "block";
  contentDiv.style.display = "none";
}

chrome.storage.sync.get(["subtitleWarning"], function (result) {
  var viewStatus = !result.subtitleWarning;
  setExtensionView(viewStatus);
});

document.getElementById("send-button").addEventListener("click", sendMessage);
document.getElementById("chat-input").addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

async function sendMessage(event) {
  const input = document.getElementById("chat-input");
  const message = input.value.trim();
  if (message === "") {
    return;
  }
  console.log("askING ai");

  handleQuery(message);
}

const chatWindow = document.getElementById("chat-window");
let isScrolling;

chatWindow.addEventListener("scroll", () => {
  chatWindow.classList.remove("custom-scrollbar-hidden");

  clearTimeout(isScrolling);

  isScrolling = setTimeout(() => {
    chatWindow.classList.add("custom-scrollbar-hidden");
  }, 2000);
});

// Function to scroll to the bottom
const scrollToBottom = () => {
  if (chatWindow) {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
};

// Call this function whenever a new message is added
const addMessage = (messageElement) => {
  chatWindow.appendChild(messageElement);
  scrollToBottom();
};

// Add these functions at the end of the file

const helpButton = document.getElementById("help-button");
const howToUseSection = document.getElementById("how-to-use");
const chatContainer = document.querySelector(".chat-container");
const alertMessage = document.getElementById("alert-message");

if (helpButton) {
  helpButton.addEventListener("click", toggleHowToUse);
}

function toggleHowToUse() {
  console.log(howToUseSection);
  console.log(chatContainer);
  console.log(alertMessage);
  if (howToUseSection && chatContainer && alertMessage) {
    if (howToUseSection.classList.contains("hidden")) {
      // Show How to Use section
      howToUseSection.classList.remove("hidden");
      chatContainer.classList.add("hidden");
      alertMessage.classList.add("hidden");
      helpButton.classList.add("text-purple-600"); // Add purple color
    } else {
      // Hide How to Use section
      howToUseSection.classList.add("hidden");
      chatContainer.classList.remove("hidden");
      setExtensionView(); // This will show/hide the alert message based on the current state
      helpButton.classList.remove("text-purple-600"); // Remove purple color
    }
  } else {
    console.error("One or more required elements are missing");
  }
}

// Ensure the chat window is scrolled to the bottom when the extension is opened
document.addEventListener("DOMContentLoaded", () => {
  scrollToBottom();
});

// MutationObserver to watch for changes in the chat window
const observer = new MutationObserver(scrollToBottom);
observer.observe(chatWindow, { childList: true, subtree: true });

// Scroll to bottom after a short delay to ensure all content is loaded
setTimeout(scrollToBottom, 100);

// Add CSS for typing indicator animation
const style = document.createElement("style");
style.textContent = `
  .typing-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .typing-indicator span {
    height: 8px;
    width: 8px;
    margin: 0 2px;
    background-color: #ffffff;
    display: block;
    border-radius: 50%;
    opacity: 0.4;
    animation: typing 1s infinite ease-in-out;
  }
  .typing-indicator span:nth-child(1) {
    animation-delay: 200ms;
  }
  .typing-indicator span:nth-child(2) {
    animation-delay: 300ms;
  }
  .typing-indicator span:nth-child(3) {
    animation-delay: 400ms;
  }
  @keyframes typing {
    0% {
      transform: translateY(0px);
      opacity: 0.4;
    }
    50% {
      transform: translateY(-5px);
      opacity: 0.8;
    }
    100% {
      transform: translateY(0px);
      opacity: 0.4;
    }
  }
`;
document.head.appendChild(style);
