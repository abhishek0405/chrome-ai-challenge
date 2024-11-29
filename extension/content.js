let ON_CALL = false;
let IS_SUBTITLE_ON = false;
let script = [];
let last_speaker = "";
chrome.storage.sync.set({
  ON_CALL: false,
  subtitleWarning: true,
});
let lastStreamedTimestamp = Math.floor(Date.now() / 1000);
const INTERVAL = 10;

const observerMap = new Map();

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "extensionEnabled") {
    const isExtensionEnabled = message.isEnabled;
    const captionsButton = contains(
      ".material-icons-extended",
      "closed_caption_off"
    )[0];
    chrome.storage.sync.get(["subtitleWarning"], function (result) {
      console.log("toggling");

      const isSubtitleOff = result.subtitleWarning;
      if (isExtensionEnabled && isSubtitleOff) {
        if (captionsButton) {
          captionsButton.click();
        }
      } else if (!isExtensionEnabled && !isSubtitleOff) {
        if (captionsButton) {
          captionsButton.click();
        }
      }
    });
  }
});

function contains(selector, text) {
  var elements = document.querySelectorAll(selector);
  return Array.prototype.filter.call(elements, function (element) {
    return RegExp(text).test(element.textContent);
  });
}

window.addEventListener("load", function () {
  const observer = new MutationObserver(() => {
    const captionsButton = contains(
      ".material-icons-extended",
      "closed_caption_off"
    )[0];
    if (captionsButton) {
      captionsButton.click();
      observer.disconnect();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
});

const docObserver = new MutationObserver(() => {
  if (document.body.querySelector("div[jscontroller='kAPMuc']")) {
    if (!ON_CALL) {
      ON_CALL = true;
      chrome.runtime.sendMessage({
        action: "activate",
      });

      chrome.storage.sync.set({
        ON_CALL: true,
      });
      callStarts();
    }
  } else {
    if (ON_CALL) {
      ON_CALL = false;
      callEnds();
    }
  }
});

docObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

function whenSubtitleOff() {
  chrome.storage.sync.set({
    subtitleWarning: true,
  });
}

function callStarts() {
  console.log("call started");
  const subtitleDiv = document.querySelector("div[jscontroller='D1tHje']");
  IS_SUBTITLE_ON = subtitleDiv.style.display === "none" ? false : true;
  if (IS_SUBTITLE_ON) whenSubtitleOn();
  else whenSubtitleOff();

  const subtitleOnOff = new MutationObserver(() => {
    IS_SUBTITLE_ON = subtitleDiv.style.display === "none" ? false : true;
    if (IS_SUBTITLE_ON) whenSubtitleOn();
    else whenSubtitleOff();
  });

  subtitleOnOff.observe(subtitleDiv, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["style"],
  });
}

function whenSubtitleOn() {
  console.log("subtitle on");
  chrome.storage.sync.set({
    subtitleWarning: false,
  });
  const subtitleDiv = document.querySelector("div[jscontroller='D1tHje']");
  const subtitleObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.target.classList &&
        mutation.target.classList.contains("bh44bd")
      ) {
        if (mutation.addedNodes.length) {
          var newNodes = mutation.addedNodes;
          var speaker =
            newNodes["0"]?.parentNode?.parentNode?.parentNode?.querySelector(
              ".KcIKyf.jxFHg"
            )?.textContent;
          if (speaker) {
            setTimeout(function () {
              const currentTimestamp = Math.floor(Date.now() / 1000);
              if (newNodes.length) {
                if (last_speaker != speaker) {
                  script.push(speaker + " : " + newNodes["0"].innerText);
                  last_speaker = speaker;
                  lastStreamedTimestamp = currentTimestamp;
                  streamMeetingContext();
                } else {
                  var lastText = script.pop();
                  lastText = lastText.slice(0, -2);
                  lastText = lastText + newNodes["0"].innerText;
                  script.push(lastText);
                  if (currentTimestamp - lastStreamedTimestamp >= INTERVAL) {
                    streamMeetingContext();
                    lastStreamedTimestamp = currentTimestamp;
                  }
                }
              }
            }, 3000);
          }
        }
      }
    });
  });

  if (!observerMap.has(subtitleDiv)) {
    // Start observing subtitle div
    subtitleObserver.observe(subtitleDiv, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });
    observerMap.set(subtitleDiv, subtitleObserver);
  }
}

async function streamMeetingContext() {
  console.log("going to stream ");
  postTranscript(script);
}

async function postTranscript(transcript) {
  console.log("Going to manage transcript: ", transcript);
  // Example of sending data to popup.js
  const data = { key: "transcript", value: transcript };

  // Send message to background or popup script
  chrome.runtime.sendMessage({ type: "TRANSCRIPT", payload: data });
}

async function callEnds() {
  await streamMeetingContext();
  endMeeting();
}

async function endMeeting() {
  console.log("meeting ended");
  const doc = new jsPDF();

  // Title
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("Meeting Report", 105, 20, { align: "center" });

  // Date
  const date = new Date();
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(date.toLocaleDateString(), 105, 30, { align: "center" });

  // Summary Section
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Summary", 20, 50);

  const summary = await summarizeTranscript(script);
  if (summary) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    const summaryText = doc.splitTextToSize(summary, 170);
    doc.text(summaryText, 20, 60);
  }

  // Transcript Section
  const transcriptY = summary
    ? 60 + doc.splitTextToSize(summary, 170).length * 7
    : 60;
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Full Transcript", 20, transcriptY);

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  const chunks = chunkTranscript(script);
  const promises = chunks.map(async (chunk, index) => {
    let cleanedChunk = chunk;
    try {
      cleanedChunk = await cleanupChunk(chunk, index);
    } catch (error) {
      console.error(`Error cleaning up chunk ${index}:`, error);
    }
    return cleanedChunk;
  });

  var cleanedTranscript = await Promise.all(promises);
  cleanedTranscript = cleanedTranscript.map((chunk, index) =>
    chunk === "ERROR" ? chunks[index] : chunk
  );

  // Format transcript with line breaks between dialogues
  const formattedTranscript = cleanedTranscript
    .map((chunk) => chunk.split(/(?<=[.!?])\s+/)) // Split into sentences
    .flat()
    .filter((line) => line.trim()) // Remove empty lines
    .join("\n\n"); // Add double line breaks

  const transcriptText = doc.splitTextToSize(formattedTranscript, 170);
  doc.text(transcriptText, 20, transcriptY + 10);

  // Save PDF
  const filename = `meeting-report-${date.toISOString().split("T")[0]}.pdf`;
  console.log("Saving transcript and summary to PDF");
  doc.save(filename);

  console.log("Meeting summary:", summary);
}

const summarizeTranscript = async (script) => {
  const currentTranscript = script;
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

const cleanUpPrompt = `
  Here is a part of the transcript which is in English but is worded poorly due to poor transcription. It will have errors such as spelling mistakes, missing punctuations, mixed words etc.:

  {chunk}
  
  I want you to rephrase the transcript in proper English and output it back in English. Output only the corrected transcript, no need to provide any explanations.
  
  `;

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
