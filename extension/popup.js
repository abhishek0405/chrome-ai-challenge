tailwind.config = {
  theme: {
    extend: {
      colors: {
        clifford: "#da373d",
      },
    },
  },
};

async function createSession() {
  const session = await chrome.aiOriginTrial.languageModel.create({
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        console.log(`Downloaded ${e.loaded} of ${e.total} bytes.`);
      });
    },
  });
  const summarizer = await ai.summarizer.create({
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        console.log(`Downloaded ${e.loaded} of ${e.total} bytes.`);
      });
    },
  });
}

createSession();

let transcript;
const systemPrompt =
  "You are a helpful and friendly meeting assistant. You will be provided a meeting transcript that is not perfect and might have some language errors and a follow up question. Make most sense out of the transcript and answer the user's question in the best possible way in simple English sentences.";

const cleanUpPrompt = `
  Here is a part of the transcript which is in English but is worded poorly due to poor transcription. It will have errors such as spelling mistakes, missing punctuations, mixed words etc.:

  {chunk}
  
  I want you to rephrase the transcript in proper English and output it back in English. Output only the corrected transcript, no need to provide any explanations.
  
  `;
const relevancePrompt = `
Here is a part of the transcript:
{chunk}

Question: {query}

If this part of the transcript is relevant to the question, provide an answer, no need to give the 'RELEVANT' phrase, just answer the question along with the question context. 

Example prompt: If question is when was the deadline?
Then answer with The deadline was on 10 January (notice how both answer and context is given)

Otherwise, just respond with 'NOT_RELEVANT', no other explanation is needed in this case.


`;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSCRIPT") {
    const receivedData = message.payload;
    transcript = receivedData.value;
    // console.log("saved transcript is ", transcript);
  } else if (message.type === "END_MEETING") {
    console.log("Recevied END Meeting Request");
    const receivedData = message.payload;
    transcript = receivedData.value;
    saveMeetingMinutes(transcript);
  }
});

if ("summarizer" in ai) {
  console.log("Summarisation API is supported : ", ai);
} else {
  console.log("Summarisation API is not supported : ");
}

const saveMeetingMinutes = (transcript) => {
  const doc = new jsPDF();

  // Add content to PDF
  doc.setFontSize(16);
  doc.text("Meeting Summary", 20, 20);

  doc.setFontSize(12);
  doc.text("Meeting Transcript:", 20, 40);

  // Add transcript content with word wrapping
  const splitText = doc.splitTextToSize(transcript.join("\n"), 170);
  doc.text(splitText, 20, 50);

  // Get current date/time for filename
  const date = new Date();
  const filename = `meeting-transcript-${date.toISOString().split("T")[0]}.pdf`;
  console.log("saving transcript");
  // Save the PDF
  doc.save(filename);
};

function chunkTranscript(transcript, maxTokens = 800) {
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

async function cleanupChunk(chunk, index) {
  try {
    console.log(`Cleaning up chunk ${index}:`);
    console.log("Unclean Chunk content:", chunk);

    const session = await chrome.aiOriginTrial.languageModel.create({
      systemPrompt:
        "You are a powerful model capable of receiving poorly phrased English transcripts and converting back to high quality english transcripts without any grammatical errors",
    });

    const message = cleanUpPrompt.replace("{chunk}", chunk);

    const response = await session.prompt(message);
    console.log(`Cleaned chunk ${index}:`, response.trim());
    console.log("----------------------------------------");
    return response.trim();
  } catch (error) {
    console.error(`Error cleaning up chunk ${index}:`, error);
    return "ERROR";
  }
}

async function queryChunk(chunk, query, index) {
  try {
    console.log(`Processing chunk ${index}:`);
    // console.log("Chunk content:", chunk);
    // console.log("Query:", query);

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

const summarizeResponses = async (userQuery, responses) => {
  console.log("Responses before summarizing:", responses);
  const summarisationContext = responses.join(" ");
  const options = {
    sharedContext: "This is a meeting transcript discussion",
    type: "tl;dr",
    format: "plain-text",
    length: "short",
  };

  const available = (await ai.summarizer.capabilities()).available;
  let summarizer;
  if (available === "no") {
    // console.log("Summarizer API is not available.");
    return;
  }
  if (available === "readily") {
    // console.log("Summarizer API is ready for immediate use.");
    summarizer = await ai.summarizer.create(options);
  } else {
    // console.log("Summarizer API requires model download before use.");
    summarizer = await ai.summarizer.create(options);
    summarizer.addEventListener("downloadprogress", (e) => {
      // console.log(`Download progress: ${e.loaded}/${e.total}`);
    });
    await summarizer.ready;
  }

  const summary = await summarizer.summarize(summarisationContext, {
    context: `Use the context to give a summarised answer for the question ${userQuery}. Give a crisp answer covering all key points from the context shared. `,
  });

  return summary;
};
async function handleQuery(userPrompt) {
  const query = userPrompt;
  console.log("query is ", query);
  const currentTranscript = transcript;
  if (!query || !currentTranscript) {
    console.log("Empty query/transcript, not processing further");
    return;
  }
  const chunks = chunkTranscript(currentTranscript);
  const promises = chunks.map(async (chunk, index) => {
    return queryChunk(chunk, query, index);
  });

  try {
    const responses = await Promise.all(promises);
    const relevantResponses = responses.filter(
      (response) => !response.includes("NOT_RELEVANT") && response !== "ERROR"
    );

    if (relevantResponses.length) {
      const summary = await summarizeResponses(query, relevantResponses);
      console.log("Final Summarised response is ", summary);
      return summary;
    } else {
      console.log("No summary found");
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }

  //
}

const summarizeTranscript = async () => {
  const currentTranscript = transcript;
  if (!currentTranscript || !currentTranscript.length) {
    console.log("Empty transcript dialogues, not processing further");
    return;
  }
  const options = {
    sharedContext: "This is a meeting transcript discussion",
    type: "tl;dr",
    format: "plain-text",
    length: "short",
  };

  const available = (await ai.summarizer.capabilities()).available;
  let summarizer;
  if (available === "no") {
    // console.log("Summarizer API is not available.");
    return;
  }
  if (available === "readily") {
    // console.log("Summarizer API is ready for immediate use.");
    summarizer = await ai.summarizer.create(options);
  } else {
    // console.log("Summarizer API requires model download before use.");
    summarizer = await ai.summarizer.create(options);
    summarizer.addEventListener("downloadprogress", (e) => {
      // console.log(`Download progress: ${e.loaded}/${e.total}`);
    });
    await summarizer.ready;
  }

  const transcriptChunks = chunkTranscript(currentTranscript);
  const promises = transcriptChunks.map((chunk, index) =>
    summarizer.summarize(chunk, {
      context: `Use the context to give a summarize the entire transcript. Provide the meeting minutes along with action items.`,
      chunk: chunk,
    })
  );

  try {
    const responses = await Promise.all(promises);
    const finalSummary = await summarizeResponses(
      "summarize this list of summaries of a meeting transcript.Ensure that you give meeting minutes along with action items",
      responses
    );
    return finalSummary;
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
};

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

  const chatWindow = document.getElementById("chat-window");

  // Create user message element
  const userMessage = document.createElement("div");
  userMessage.className =
    "relative mb-2 p-2 bg-green-600 text-white self-end rounded-xl rounded-br-none mr-3 ml-2";
  userMessage.innerText = message;
  chatWindow.appendChild(userMessage);
  scrollToBottom();

  // Store user message
  try {
    const chatHistory = await new Promise((resolve) => {
      chrome.storage.local.get(["chatHistory"], (result) => {
        resolve(result.chatHistory || []);
      });
    });

    const updatedHistory = [
      ...chatHistory,
      {
        type: "user",
        message: message,
        timestamp: new Date().toISOString(),
      },
    ];

    await new Promise((resolve) => {
      chrome.storage.local.set({ chatHistory: updatedHistory }, resolve);
    });
  } catch (error) {
    console.error("Error storing chat history:", error);
  }

  input.value = "";

  // Create typing indicator
  const typingIndicator = document.createElement("div");
  typingIndicator.className =
    "relative mb-2 p-2 bg-emerald-600 text-white self-start rounded-xl rounded-bl-none mr-3 ml-2";
  typingIndicator.innerHTML = `
    <div class="typing-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
  chatWindow.appendChild(typingIndicator);
  scrollToBottom();

  try {
    const response = await handleQuery(message);

    // Remove typing indicator
    chatWindow.removeChild(typingIndicator);

    // Create bot response element
    const botMessage = document.createElement("div");
    botMessage.className =
      "relative mb-2 p-2 bg-emerald-600 text-white self-start rounded-xl rounded-bl-none mr-3 ml-2";
    let botResponse = response;
    if (!botResponse || botResponse === "No relevant information found.") {
      chatWindow.appendChild(typingIndicator);
      const session = await chrome.aiOriginTrial.languageModel.create({
        systemPrompt:
          "You are a helpful assistant. Follow these guidelines for different types of questions:\n\n" +
          "1. For questions requiring meeting context (e.g. 'What was discussed about the project timeline?', 'Who is responsible for the UI design?'), respond with 'NEEDS_CONTEXT'\n\n" +
          "2. For general knowledge questions:\n" +
          "- Factual queries (e.g. 'What is the capital of India?') -> Provide direct answers ('The capital of India is New Delhi')\n" +
          "- Technical questions (e.g. 'What is JavaScript?') -> Give concise explanations\n" +
          "- Math/calculations -> Show working and final answer\n\n" +
          "3. For greetings/casual conversation:\n" +
          "- Hello/Hi -> Respond warmly ('Hello! How can I help you today?')\n" +
          "- How are you -> Be friendly but professional ('I'm doing well, thank you! How may I assist you?')\n\n" +
          "4. For unclear/ambiguous questions:\n" +
          "- Ask for clarification\n" +
          "- Suggest how the question could be rephrased\n\n" +
          "Keep responses concise, helpful and natural. If unsure about meeting-specific details, respond with 'NEEDS_CONTEXT'.",
      });
      const genericResponse = await session.prompt(message);
      if (!genericResponse.includes("NEEDS_CONTEXT")) {
        botResponse = genericResponse;
      } else {
        botResponse = "No relevant information found.";
      }
      chatWindow.removeChild(typingIndicator);
    }

    botMessage.innerText = botResponse;
    chatWindow.appendChild(botMessage);

    // Store bot message
    const currentHistory = await new Promise((resolve) => {
      chrome.storage.local.get(["chatHistory"], (result) => {
        resolve(result.chatHistory || []);
      });
    });

    const updatedHistory = [
      ...currentHistory,
      {
        type: "bot",
        message: botResponse,
        timestamp: new Date().toISOString(),
      },
    ];

    await new Promise((resolve) => {
      chrome.storage.local.set({ chatHistory: updatedHistory }, resolve);
    });

    scrollToBottom();
  } catch (error) {
    console.error("Error:", error);

    // Remove typing indicator
    chatWindow.removeChild(typingIndicator);

    // Create error message element
    const errorMessage = document.createElement("div");
    errorMessage.className =
      "relative mb-2 p-2 bg-red-500 text-white self-start rounded-xl rounded-bl-none mr-3 ml-2";
    errorMessage.innerText = "Sorry, something went wrong.";
    chatWindow.appendChild(errorMessage);

    // Store error message
    const currentHistory = await new Promise((resolve) => {
      chrome.storage.local.get(["chatHistory"], (result) => {
        resolve(result.chatHistory || []);
      });
    });

    const updatedHistory = [
      ...currentHistory,
      {
        type: "error",
        message: "Sorry, something went wrong.",
        timestamp: new Date().toISOString(),
      },
    ];

    await new Promise((resolve) => {
      chrome.storage.local.set({ chatHistory: updatedHistory }, resolve);
    });

    scrollToBottom();
  }
}

// Load chat history when popup opens
function loadChatHistory() {
  console.log("loading chats");
  chrome.storage.local.get(["chatHistory"], function (result) {
    const chatHistory = result.chatHistory || [];

    chatHistory.forEach((chat) => {
      const messageElement = document.createElement("div");

      if (chat.type === "user") {
        messageElement.className =
          "relative mb-2 p-2 bg-green-600 text-white self-end rounded-xl rounded-br-none mr-3 ml-2";
      } else if (chat.type === "bot") {
        messageElement.className =
          "relative mb-2 p-2 bg-emerald-900 text-white self-start rounded-xl rounded-bl-none mr-3 ml-2";
      } else if (chat.type === "error") {
        messageElement.className =
          "relative mb-2 p-2 bg-red-500 text-white self-start rounded-xl rounded-bl-none mr-3 ml-2";
      }

      messageElement.innerText = chat.message;
      addMessage(messageElement);
    });
  });
}

// Call loadChatHistory when popup opens
document.addEventListener("DOMContentLoaded", loadChatHistory);

const chatWindow = document.getElementById("chat-window");
let isScrolling;

chatWindow.addEventListener("scroll", () => {
  chatWindow.classList.remove("custom-scrollbar-hidden");

  clearTimeout(isScrolling);

  isScrolling = setTimeout(() => {
    chatWindow.classList.add("custom-scrollbar-hidden");
  }, 2000);
});

const scrollToBottom = () => {
  if (chatWindow) {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
};

const addMessage = (messageElement) => {
  chatWindow.appendChild(messageElement);
  scrollToBottom();
};

const helpButton = document.getElementById("help-button");
const howToUseSection = document.getElementById("how-to-use");
const chatContainer = document.querySelector(".chat-container");
const alertMessage = document.getElementById("alert-message");

if (helpButton) {
  helpButton.addEventListener("click", toggleHowToUse);
}

function toggleHowToUse() {
  if (howToUseSection && chatContainer && alertMessage) {
    if (howToUseSection.classList.contains("hidden")) {
      // Show How to Use section
      howToUseSection.classList.remove("hidden");
      chatContainer.classList.add("hidden");
      alertMessage.classList.add("hidden");
      helpButton.classList.add("text-purple-600");
    } else {
      // Hide How to Use section
      howToUseSection.classList.add("hidden");
      chatContainer.classList.remove("hidden");
      setExtensionView();
      helpButton.classList.remove("text-purple-600");
    }
  } else {
    console.error("One or more required elements are missing");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  scrollToBottom();
});

const observer = new MutationObserver(scrollToBottom);
observer.observe(chatWindow, { childList: true, subtree: true });

setTimeout(scrollToBottom, 100);

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

// const cleanText = (input) => {
//   console.log("cleaning text")
//   return nlp(input).normalize().out("text");
// }

// let answer  = cleanText("You : Hey, how are we doing today? We'rgonna talk about some stuff and we'rgonna see how this is gonThe transcripts. I am making sure speak fast enough and I don't speavery clear enough so that there arsome spelling errors in or evegrammar errors in the sentence aextension should correct it, righOkay, let's see how this goes. Okay.")
// console.log(answer)

// const dictionary = new Typo("en_US");

// function correctSpelling(text) {
//   console.log('correcting spelling')
//     return text.split(" ").map(word => {
//         return dictionary.check(word) ? word : dictionary.suggest(word)[0] || word;
//     }).join(" ");
// }
// let typoAnswer = correctSpelling("You : Hey, how are we doing today? We'rgonna talk about some stuff and we'rgonna see how this is gonThe transcripts. I am making sure speak fast enough and I don't speavery clear enough so that there arsome spelling errors in or evegrammar errors in the sentence aextension should correct it, righOkay, let's see how this goes. Okay.")
// console.log(typoAnswer)

// audio capture
// let tabId;

// // Fetch tab immediately
// chrome.runtime.sendMessage({command: 'query-active-tab'}, (response) => {
//     tabId = response.id;
// });

// // On command, get the stream ID and forward it back to the service worker
// chrome.commands.onCommand.addListener((command) => {
//     chrome.tabCapture.getMediaStreamId({consumerTabId: tabId}, (streamId) => {
//       console.log(tabId)
//         chrome.runtime.sendMessage({
//             command: 'tab-media-stream',
//             tabId: tabId,
//             streamId: streamId
//         })
//     });
// });
